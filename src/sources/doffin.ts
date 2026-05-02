import { httpJson } from "../infra/http.js";
import {
  normalizeDoffinSearchHit,
  normalizeDoffinDetail,
} from "./doffin-normalizer.js";
import type { Tender } from "../types.js";

const SEARCH_URL = "https://api.doffin.no/webclient/api/v2/search-api/search";
const DETAIL_URL = (id: string) =>
  `https://api.doffin.no/webclient/api/v2/notices-api/notices/${encodeURIComponent(id)}`;

const COMMON_HEADERS = { Origin: "https://doffin.no" };

export type DoffinSearchOptions = {
  query?: string;
  cpvCodes?: string[];
  regions?: string[];
  deadlineBefore?: string;
  limit?: number;
};

export type DoffinClient = {
  search: (opts: DoffinSearchOptions) => Promise<Tender[]>;
  getNotice: (id: string) => Promise<Tender>;
  healthCheck: () => Promise<{ ok: boolean; reason?: string }>;
};

export function createDoffinClient(deps: { fetch?: typeof fetch } = {}): DoffinClient {
  const f = deps.fetch ?? fetch;

  return {
    async search(opts) {
      const body = {
        size: Math.min(opts.limit ?? 50, 1000),
        page: 1,
      };
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
      return hits.map(normalizeDoffinSearchHit);
    },

    async getNotice(id) {
      const res = await httpJson<unknown>(DETAIL_URL(id), {
        headers: COMMON_HEADERS,
        retries: 1,
        retryDelayMs: 300,
        timeoutMs: 15_000,
        fetch: f,
      });
      return normalizeDoffinDetail(res);
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
