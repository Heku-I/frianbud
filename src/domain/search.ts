import type { Profile, ScoredTender, SourceWarning, Tender } from "../types.js";
import type { TedClient, TedSearchOptions } from "../sources/ted.js";
import type { DoffinGate } from "../sources/doffin-health-gate.js";
import type { DoffinSearchOptions } from "../sources/doffin.js";
import { dedupeMerge } from "./dedupe-merge.js";
import { scoreTender } from "./scorer.js";

export type SearchOptions = {
  query?: string;
  cpvCodes?: string[];
  regions?: string[];
  valueMin?: number;
  valueMax?: number;
  deadlineBefore?: string;
  publishedSince?: string;
  status?: "open" | "closed" | "awarded";
  limit?: number;
};

export type SearchResult = {
  tenders: ScoredTender[];
  warnings: SourceWarning[];
};

export type SearchService = {
  search: (opts: SearchOptions) => Promise<SearchResult>;
};

export function createSearchService(deps: {
  ted: TedClient;
  doffin: DoffinGate;
  profile: Profile | null;
  now?: () => Date;
}): SearchService {
  return {
    async search(opts) {
      const warnings: SourceWarning[] = [];

      const tedFilters: TedSearchOptions = {
        country: "NO",
        ...(opts.cpvCodes ? { cpvCodes: opts.cpvCodes } : {}),
        ...(opts.deadlineBefore ? { deadlineBefore: opts.deadlineBefore } : {}),
        ...(opts.publishedSince ? { publishedSince: opts.publishedSince } : {}),
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.query ? { query: opts.query } : {}),
        ...(opts.limit ? { limit: opts.limit } : {}),
      };
      const doffinFilters: DoffinSearchOptions = {
        ...(opts.cpvCodes ? { cpvCodes: opts.cpvCodes } : {}),
        ...(opts.regions ? { regions: opts.regions } : {}),
        ...(opts.deadlineBefore ? { deadlineBefore: opts.deadlineBefore } : {}),
        ...(opts.query ? { query: opts.query } : {}),
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.limit ? { limit: opts.limit } : {}),
      };

      const [tedResult, doffinResult] = await Promise.all([
        deps.ted.search(tedFilters).then(
          (tenders) => ({ tenders, error: null as Error | null }),
          (error: Error) => ({ tenders: [] as Tender[], error })
        ),
        deps.doffin.searchSafe(doffinFilters),
      ]);

      if (tedResult.error) {
        warnings.push({ source: "ted", reason: tedResult.error.message });
      }
      if (doffinResult.warning) warnings.push(doffinResult.warning);

      const merged = dedupeMerge(tedResult.tenders, doffinResult.tenders);

      // Apply post-merge filters that sources may not enforce uniformly
      const filtered = merged.filter((t) => {
        if (opts.regions && opts.regions.length > 0) {
          const set = new Set(opts.regions);
          if (!t.regions.some((r) => set.has(r))) return false;
        }
        if (opts.valueMin !== undefined && (t.estimatedValue?.amount ?? 0) < opts.valueMin) return false;
        if (opts.valueMax !== undefined && (t.estimatedValue?.amount ?? Infinity) > opts.valueMax) return false;
        if (opts.status && t.status !== opts.status) return false;
        return true;
      });

      const profile = deps.profile;
      const scored: ScoredTender[] = filtered.map((t) => {
        if (!profile) return { ...t, score: 0, reasons: [] };
        const { score, reasons } = scoreTender(t, profile, { now: deps.now?.() ?? new Date() });
        return { ...t, score, reasons };
      });

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // tiebreak: nearer deadline first
        const aD = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Infinity;
        const bD = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Infinity;
        return aD - bD;
      });

      const limit = opts.limit ?? 20;
      return { tenders: scored.slice(0, limit), warnings };
    },
  };
}
