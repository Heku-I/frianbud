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

// TED's Search API requires an explicit `fields` whitelist. Sending a field name
// that isn't in the OpenAPI enum returns 400. This list is the minimum we need
// to populate the unified Tender type. Adding fields here should be matched by
// updates in the normalizer.
const SEARCH_FIELDS = [
  "publication-number",
  "notice-type",
  "notice-title",
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
      parts.push(`classification-cpv IN (${opts.cpvCodes.join(",")})`);
    }
    if (opts.publishedSince) parts.push(`publication-date>=${opts.publishedSince}`);
    if (opts.deadlineBefore) {
      parts.push(`deadline-receipt-tender-date-lot<=${opts.deadlineBefore}`);
    }
    if (opts.query) parts.push(opts.query);
    return parts.length > 0 ? parts.join(" AND ") : "*";
  }

  return {
    async search(opts) {
      const key = JSON.stringify(opts);
      const cached = cache.get(key);
      if (cached) return cached;

      const body = {
        query: buildExpertQuery(opts),
        fields: SEARCH_FIELDS,
        limit: Math.min(opts.limit ?? 50, 250),
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
      const tenders = notices.map(normalizeTedNotice);
      cache.set(key, tenders);
      return tenders;
    },

    async getNotice(id) {
      const body = {
        query: `publication-number="${id}"`,
        fields: SEARCH_FIELDS,
        limit: 1,
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
