import type { DoffinClient, DoffinSearchOptions } from "./doffin.js";
import type { Tender, SourceWarning } from "../types.js";

export type DoffinGate = {
  isEnabled: () => boolean;
  search: DoffinClient["search"];
  getNotice: DoffinClient["getNotice"];
  searchSafe: (
    opts: DoffinSearchOptions,
  ) => Promise<{ tenders: Tender[]; warning?: SourceWarning }>;
};

export async function createDoffinHealthGate(
  client: DoffinClient,
  opts: { now?: () => Date } = {},
): Promise<DoffinGate> {
  const now = opts.now ?? (() => new Date());
  const envOverride = process.env.FRIANBUD_DOFFIN;
  let enabled = envOverride !== "off";
  let lastError: string | undefined;
  let disabledSince: string | undefined;

  if (envOverride !== "force" && enabled) {
    const health = await client.healthCheck();
    if (!health.ok) {
      enabled = false;
      lastError = health.reason ?? "health check failed";
      disabledSince = now().toISOString();
    }
  }

  function trip(reason: string) {
    enabled = false;
    lastError = reason;
    disabledSince = now().toISOString();
  }

  return {
    isEnabled: () => enabled,

    async search(o) {
      if (!enabled) throw new Error("Doffin disabled");
      try {
        return await client.search(o);
      } catch (err) {
        trip(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },

    async getNotice(id) {
      if (!enabled) throw new Error("Doffin disabled");
      try {
        return await client.getNotice(id);
      } catch (err) {
        trip(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },

    async searchSafe(o) {
      if (!enabled) {
        const warning: SourceWarning = {
          source: "doffin",
          reason: lastError ?? "disabled",
        };
        if (disabledSince) warning.since = disabledSince;
        return { tenders: [], warning };
      }
      try {
        const tenders = await client.search(o);
        return { tenders };
      } catch (err) {
        trip(err instanceof Error ? err.message : String(err));
        const warning: SourceWarning = {
          source: "doffin",
          reason: lastError ?? "search failed",
        };
        if (disabledSince) warning.since = disabledSince;
        return { tenders: [], warning };
      }
    },
  };
}
