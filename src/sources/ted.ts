import { httpJson } from "../infra/http.js";
import { createLru } from "../infra/lru.js";
import { normalizeTedNotice } from "./ted-normalizer.js";
import type { Tender } from "../types.js";

const BASE = "https://api.ted.europa.eu/v3";

// TED's expert query DSL accepts only ISO 3166-1 alpha-3 country codes (NOR,
// DNK, ...). Our internal Tender type carries 2-letter alpha-2 codes (NO, DK).
// Map at the boundary so callers stay in 2-letter land.
const COUNTRY_2_TO_3: Record<string, string> = {
  AT: "AUT", BE: "BEL", BG: "BGR", CH: "CHE", CY: "CYP", CZ: "CZE",
  DE: "DEU", DK: "DNK", EE: "EST", ES: "ESP", FI: "FIN", FR: "FRA",
  GB: "GBR", GR: "GRC", HR: "HRV", HU: "HUN", IE: "IRL", IS: "ISL",
  IT: "ITA", LI: "LIE", LT: "LTU", LU: "LUX", LV: "LVA", MT: "MLT",
  NL: "NLD", NO: "NOR", PL: "POL", PT: "PRT", RO: "ROU", SE: "SWE",
  SI: "SVN", SK: "SVK",
};

function toTedCountry(code: string): string {
  if (code.length === 3) return code;
  return COUNTRY_2_TO_3[code.toUpperCase()] ?? code;
}

// TED's expert search rejects ISO 8601 date strings (YYYY-MM-DD); it expects
// either YYYYMMDD or today(±N). Accept ISO from callers and convert.
function toTedDate(input: string): string {
  if (/^today\([+-]?\d+\)$/i.test(input) || /^\d{8}$/.test(input)) return input;
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]!}${m[2]!}${m[3]!}`;
  return input;
}

// TED's Search API requires an explicit `fields` whitelist. Sending a field name
// that isn't in the OpenAPI enum returns 400. This list is the minimum we need
// to populate the unified Tender type. Adding fields here should be matched by
// updates in the normalizer.
const SEARCH_FIELDS = [
  "publication-number",
  "notice-type",
  "notice-title",
  "description-lot",
  "description-part",
  "description-proc",
  "description-glo",
  "classification-cpv",
  "buyer-name",
  "buyer-country",
  "place-of-performance",
  "publication-date",
  "deadline-receipt-tender-date-lot",
  "estimated-value-glo",
  "estimated-value-cur-glo",
  "links",
];

export type TedSearchOptions = {
  country?: string;
  cpvCodes?: string[];
  publishedSince?: string;
  deadlineBefore?: string;
  status?: "open" | "closed" | "awarded";
  query?: string;
  limit?: number;
  // TED scope. Default LATEST returns the current OJ S release; ACTIVE and ALL
  // both default-sort the entire archive (oldest first), which surfaces stale
  // 10+ year-old notices. Override only for historical research.
  scope?: "LATEST" | "ACTIVE" | "ALL";
};

export type TedClient = {
  search: (opts: TedSearchOptions) => Promise<Tender[]>;
  getNotice: (id: string) => Promise<Tender>;
};

export function createTedClient(
  deps: {
    fetch?: typeof fetch;
    cacheTtlMs?: number;
    cacheMax?: number;
  } = {},
): TedClient {
  const cache = createLru<string, Tender[]>({
    max: deps.cacheMax ?? 50,
    ttlMs: deps.cacheTtlMs ?? 5 * 60_000,
  });
  const f = deps.fetch ?? fetch;

  function buildExpertQuery(opts: TedSearchOptions): string {
    const parts: string[] = [];
    if (opts.country) parts.push(`place-of-performance=${toTedCountry(opts.country)}`);
    if (opts.cpvCodes && opts.cpvCodes.length > 0) {
      // TED's classification-cpv field rejects:
      //   - the IN(...) operator (works on other fields, not this one)
      //   - the trailing check digit ('90910000-9' → must be '90910000')
      // Strip check digits and OR-expand.
      const codes = opts.cpvCodes
        .map((c) => c.split("-")[0]!)
        .filter((c) => /^\d{8}$/.test(c));
      if (codes.length === 1) {
        parts.push(`classification-cpv=${codes[0]!}`);
      } else if (codes.length > 1) {
        const ored = codes.map((c) => `classification-cpv=${c}`).join(" OR ");
        parts.push(`(${ored})`);
      }
    }
    if (opts.publishedSince) parts.push(`publication-date>=${toTedDate(opts.publishedSince)}`);
    if (opts.deadlineBefore) {
      parts.push(
        `deadline-receipt-tender-date-lot<=${toTedDate(opts.deadlineBefore)}`,
      );
    }
    // Map our internal status to TED's notice-type filter. Awards are
    // overwhelmingly "can-standard"; rarer variants (can-modif, can-social,
    // can-tran, can-desg) are not exposed here in v0.1.
    if (opts.status === "awarded") {
      parts.push("notice-type=can-standard");
    }
    if (opts.query) parts.push(opts.query);
    return parts.length > 0 ? parts.join(" AND ") : "*";
  }

  return {
    async search(opts) {
      const key = JSON.stringify(opts);
      const cached = cache.get(key);
      if (cached) return cached;

      // LATEST is just today's OJ S release. For award queries we need a
      // wider window because awards aren't published every day.
      const defaultScope = opts.status === "awarded" ? "ALL" : "LATEST";
      const body = {
        query: buildExpertQuery(opts),
        fields: SEARCH_FIELDS,
        limit: Math.min(opts.limit ?? 50, 250),
        scope: opts.scope ?? defaultScope,
      };
      const res = await httpJson<{ notices?: unknown[] }>(
        `${BASE}/notices/search`,
        {
          method: "POST",
          body,
          retries: 2,
          retryDelayMs: 300,
          timeoutMs: 15_000,
          fetch: f,
        },
      );
      const notices = Array.isArray(res.notices) ? res.notices : [];
      const tenders = notices.map(normalizeTedNotice);
      cache.set(key, tenders);
      return tenders;
    },

    async getNotice(id) {
      const body = {
        query: `publication-number="${id}"`,
        fields: SEARCH_FIELDS,
        limit: 1,
        // ALL because we want to find a specific notice regardless of when
        // it was published.
        scope: "ALL",
      };
      const res = await httpJson<{ notices?: unknown[] }>(
        `${BASE}/notices/search`,
        {
          method: "POST",
          body,
          retries: 2,
          retryDelayMs: 300,
          timeoutMs: 15_000,
          fetch: f,
        },
      );
      const notices = Array.isArray(res.notices) ? res.notices : [];
      if (notices.length === 0) {
        throw new Error(`TED notice not found: ${id}`);
      }
      return normalizeTedNotice(notices[0]);
    },
  };
}
