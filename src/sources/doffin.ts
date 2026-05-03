import { httpJson } from "../infra/http.js";
import { createLru } from "../infra/lru.js";
import {
  normalizeDoffinSearchHit,
  normalizeDoffinDetail,
} from "./doffin-normalizer.js";
import type { Tender } from "../types.js";

const SEARCH_URL = "https://api.doffin.no/webclient/api/v2/search-api/search";
const DETAIL_URL = (id: string) =>
  `https://api.doffin.no/webclient/api/v2/notices-api/notices/${encodeURIComponent(id)}`;

const COMMON_HEADERS = { Origin: "https://doffin.no" };

// Doffin's search response intentionally omits CPV codes per hit; CPVs only
// appear on the detail endpoint. Without them the scorer's CPV signal scores
// every Doffin tender at zero, which makes ranking nearly useless. Set to
// false in batch contexts where the extra fetches matter more than ranking.
const DEFAULT_ENRICH_CPVS = true;
const ENRICH_CONCURRENCY = 5;

export type DoffinSearchOptions = {
  query?: string;
  cpvCodes?: string[];
  regions?: string[];
  deadlineBefore?: string;
  limit?: number;
  enrichCpvs?: boolean;
  // Status hint. Doffin's API has no status filter, but when status=awarded
  // and the caller hasn't supplied a query, we bias searchString toward
  // award notices using the Norwegian "tildelt" keyword. Verified: this
  // narrows from ~153k corpus to ~50 award-typed hits.
  status?: "open" | "closed" | "awarded";
};

export type DoffinClient = {
  search: (opts: DoffinSearchOptions) => Promise<Tender[]>;
  getNotice: (id: string) => Promise<Tender>;
  healthCheck: () => Promise<{ ok: boolean; reason?: string }>;
};

export function createDoffinClient(deps: {
  fetch?: typeof fetch;
  detailCacheMax?: number;
  detailCacheTtlMs?: number;
} = {}): DoffinClient {
  const f = deps.fetch ?? fetch;
  const detailCache = createLru<string, Tender>({
    max: deps.detailCacheMax ?? 200,
    ttlMs: deps.detailCacheTtlMs ?? 10 * 60_000,
  });

  async function fetchDetail(id: string): Promise<Tender> {
    const cached = detailCache.get(id);
    if (cached) return cached;
    const res = await httpJson<unknown>(DETAIL_URL(id), {
      headers: COMMON_HEADERS,
      retries: 1,
      retryDelayMs: 300,
      timeoutMs: 15_000,
      fetch: f,
    });
    const tender = normalizeDoffinDetail(res);
    detailCache.set(id, tender);
    return tender;
  }

  async function enrichWithCpvs(hits: Tender[]): Promise<Tender[]> {
    const out = [...hits];
    const indices: number[] = [];
    for (let i = 0; i < out.length; i++) {
      const hit = out[i]!;
      if (hit.cpvCodes.length === 0) indices.push(i);
    }
    if (indices.length === 0) return out;

    let next = 0;
    async function worker() {
      while (next < indices.length) {
        const idx = indices[next++]!;
        const hit = out[idx]!;
        const idOnly = hit.id.replace(/^doffin:/, "");
        try {
          const detail = await fetchDetail(idOnly);
          if (detail.cpvCodes.length > 0) {
            out[idx] = { ...hit, cpvCodes: detail.cpvCodes };
          }
        } catch {
          // leave hit unenriched on detail-fetch failure
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(ENRICH_CONCURRENCY, indices.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return out;
  }

  function postFilter(tenders: Tender[], opts: DoffinSearchOptions): Tender[] {
    let out = tenders;
    if (opts.cpvCodes && opts.cpvCodes.length > 0) {
      // Doffin API silently ignores cpvCodes in the request body, so filter
      // client-side. Match by 8-digit numeric prefix to ignore check digit.
      const wanted = new Set(opts.cpvCodes.map((c) => c.split("-")[0]!));
      out = out.filter((t) =>
        t.cpvCodes.some((c) => wanted.has(c.split("-")[0]!)),
      );
    }
    if (opts.regions && opts.regions.length > 0) {
      const wanted = new Set(opts.regions);
      out = out.filter((t) => t.regions.some((r) => wanted.has(r)));
    }
    return out;
  }

  return {
    async search(opts) {
      // Doffin's body schema accepts `searchString` for free-text and ignores
      // structured filters like `cpvCodes` (verified). Pass `searchString`
      // through and apply structured filters client-side after enrichment.
      // For award queries, bias the page size up — most of the latest 50
      // hits are open competitions, so awards get pushed off the first
      // page. 200 hits gives enough room for awards to surface even
      // without an explicit searchString.
      const defaultSize = opts.status === "awarded" ? 200 : 50;
      const body: Record<string, unknown> = {
        size: Math.min(opts.limit ?? defaultSize, 1000),
        page: 1,
      };
      const explicitQuery = opts.query && opts.query.length > 0 ? opts.query : undefined;
      const awardHint =
        opts.status === "awarded" && !explicitQuery ? "tildelt" : undefined;
      const searchString = explicitQuery ?? awardHint;
      if (searchString) {
        body["searchString"] = searchString;
      }
      const res = await httpJson<{ hits?: unknown[] }>(SEARCH_URL, {
        method: "POST",
        body,
        headers: COMMON_HEADERS,
        retries: 1,
        retryDelayMs: 300,
        timeoutMs: 15_000,
        fetch: f,
      });
      const hits = Array.isArray(res.hits) ? res.hits : [];
      const tenders = hits.map(normalizeDoffinSearchHit);
      const shouldEnrich = opts.enrichCpvs ?? DEFAULT_ENRICH_CPVS;
      const enriched = shouldEnrich ? await enrichWithCpvs(tenders) : tenders;
      return postFilter(enriched, opts);
    },

    async getNotice(id) {
      return fetchDetail(id);
    },

    async healthCheck() {
      try {
        await httpJson<unknown>(SEARCH_URL, {
          method: "POST",
          body: { size: 1, page: 1 },
          headers: COMMON_HEADERS,
          timeoutMs: 5_000,
          fetch: f,
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
