import { httpJson } from "../infra/http.js";
import { createLru } from "../infra/lru.js";
import { normalizeDoffinPublicHit } from "./doffin-public-normalizer.js";
import type { Tender } from "../types.js";
import type { DoffinClient, DoffinSearchOptions } from "./doffin.js";

const BASE = "https://api.doffin.no/public";

// Map our internal Tender.status enum to Doffin's notice-status filter.
// Doffin's status enum includes ACTIVE, EXPIRED, AWARDED, CANCELLED.
const STATUS_MAP: Record<"open" | "closed" | "awarded", string> = {
  open: "ACTIVE",
  closed: "EXPIRED",
  awarded: "AWARDED",
};

function toDoffinDate(iso: string): string {
  // Official API expects YYYY-MM-DD. Strip any time-of-day portion.
  return iso.slice(0, 10);
}

function buildQuery(opts: DoffinSearchOptions): URLSearchParams {
  const qs = new URLSearchParams();
  // Server-side filters supported by /public/v2/search:
  if (opts.query && opts.query.length > 0) qs.set("searchString", opts.query);
  if (opts.cpvCodes && opts.cpvCodes.length > 0) {
    for (const code of opts.cpvCodes) {
      // Doffin's cpvCode field expects the bare 8-digit prefix
      // (without check digit); strip any trailing -X.
      const stripped = code.split("-")[0]!;
      qs.append("cpvCode", stripped);
    }
  }
  if (opts.regions && opts.regions.length > 0) {
    for (const r of opts.regions) qs.append("location", r);
  }
  if (opts.deadlineBefore) {
    qs.set("issueDateTo", toDoffinDate(opts.deadlineBefore));
  }
  // Doffin's status and type filters are surprisingly mutually exclusive —
  // probed empirically: status=AWARDED alone returns competition notices
  // that reached the awarded state but lack lots[].winner[]; type=RESULT
  // alone returns the actual award notices with structured winners.
  // Combining them returns zero. So when the caller asks for awards, we
  // route to the type filter (which gives us winner data) and skip status.
  // For other states, status is the right filter.
  if (opts.status === "awarded") {
    qs.append("type", "ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT");
    qs.append("type", "RESULT");
  } else if (opts.status && opts.status !== "closed") {
    const mapped = STATUS_MAP[opts.status];
    if (mapped) qs.set("status", mapped);
  }
  // sortBy default is PUBLICATION_DATE_DESC (newest first); explicit so the
  // ordering is stable and documented.
  qs.set("sortBy", "PUBLICATION_DATE_DESC");
  // Page size: official API caps at 100 per page (vs unofficial's 1000).
  // We default to whatever the caller asked for, capped to 100.
  qs.set("numHitsPerPage", String(Math.min(opts.limit ?? 50, 100)));
  qs.set("page", "1");
  return qs;
}

export function createDoffinPublicClient(deps: {
  fetch?: typeof fetch;
  apiKey: string;
  cacheTtlMs?: number;
  cacheMax?: number;
} = { apiKey: "" }): DoffinClient {
  if (!deps.apiKey) {
    throw new Error(
      "createDoffinPublicClient requires apiKey (subscription key from developer.doffin.no)",
    );
  }
  const f = deps.fetch ?? fetch;
  const headers = { "Ocp-Apim-Subscription-Key": deps.apiKey };
  const detailCache = createLru<string, Tender>({
    max: deps.cacheMax ?? 200,
    ttlMs: deps.cacheTtlMs ?? 10 * 60_000,
  });

  async function fetchById(id: string): Promise<Tender | null> {
    // The official API has no per-id detail endpoint that returns the
    // structured PublicNoticeHitDto — only a binary download. Best path
    // for "get one notice" is a search keyed on the id.
    const qs = new URLSearchParams();
    qs.set("searchString", id);
    qs.set("numHitsPerPage", "20");
    qs.set("page", "1");
    const res = await httpJson<{ hits?: unknown[] | unknown }>(
      `${BASE}/v2/search?${qs.toString()}`,
      {
        method: "GET",
        headers,
        retries: 1,
        retryDelayMs: 300,
        timeoutMs: 10_000,
        fetch: f,
      },
    );
    const hits = Array.isArray(res.hits)
      ? res.hits
      : res.hits
        ? [res.hits]
        : [];
    for (const h of hits) {
      const tender = normalizeDoffinPublicHit(h);
      if (tender.id === `doffin:${id}`) return tender;
    }
    return null;
  }

  return {
    async search(opts) {
      const qs = buildQuery(opts);
      const res = await httpJson<{ hits?: unknown[] | unknown }>(
        `${BASE}/v2/search?${qs.toString()}`,
        {
          method: "GET",
          headers,
          retries: 1,
          retryDelayMs: 300,
          timeoutMs: 15_000,
          fetch: f,
        },
      );
      // The OpenAPI spec types `hits` ambiguously — sometimes the response
      // returns an array, sometimes a single object when there is exactly
      // one match. Normalize both.
      const hits = Array.isArray(res.hits)
        ? res.hits
        : res.hits
          ? [res.hits]
          : [];
      return hits.map(normalizeDoffinPublicHit);
    },

    async getNotice(id) {
      const cached = detailCache.get(id);
      if (cached) return cached;
      const tender = await fetchById(id);
      if (!tender) {
        throw new Error(`Doffin notice not found: ${id}`);
      }
      detailCache.set(id, tender);
      return tender;
    },

    async healthCheck() {
      try {
        await httpJson<unknown>(`${BASE}/v2/search?numHitsPerPage=20&page=1`, {
          method: "GET",
          headers,
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
