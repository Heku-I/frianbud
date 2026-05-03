import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import type { SearchOptions } from "../domain/search.js";

const inputSchema = z.object({
  sinceDays: z.number().int().positive().max(365).optional(),
  buyer: z.string().optional(),
  cpvCodes: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).optional(),
  // When true (default), filter result to tenders where the requested CPV
  // appears in the first 3 entries of the contract's CPV array. Eliminates
  // false positives like 'construction contract with cleaning as one of 20
  // CPVs'. Set false to include any contract that mentions the CPV at all.
  requireCpvPrimary: z.boolean().optional(),
});

const PRIMARY_WINDOW = 3;

function isoDateNDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function stripCheckDigit(code: string): string {
  return code.split("-")[0]!;
}

export const listRecentAwardsTool: ToolDefinition<typeof inputSchema> = {
  name: "list_recent_awards",
  description:
    "List contracts awarded in the last N days (default 30). Filter by buyer name or CPV code. " +
    "TED returns full winner names, org numbers, per-winner values, and total contract value for " +
    "above-threshold contracts (1.4M NOK+). When `cpvCodes` is provided without an explicit `buyer`, " +
    "the tool auto-derives Norwegian keywords from the CPV labels to bias Doffin's search toward " +
    "matching awards (Doffin's API has no server-side CPV filter, so keyword search is the only way " +
    "to surface sub-threshold kommune contracts there). Default behaviour requires the requested CPV " +
    "to be among the contract's primary CPVs (first 3) to suppress mixed-scope false positives like " +
    "'construction contract with one cleaning CPV among 20'. Disable with requireCpvPrimary: false. " +
    "Useful for prompts like 'who won the last 5 IT contracts from Oslo Kommune?' or 'recent awards " +
    "for cleaning services'.",
  inputSchema,
  async handler({ sinceDays = 30, buyer, cpvCodes, limit, requireCpvPrimary = true }, ctx) {
    const opts: SearchOptions = {
      status: "awarded",
      publishedSince: isoDateNDaysAgo(sinceDays),
    };
    if (cpvCodes !== undefined) opts.cpvCodes = cpvCodes;

    if (buyer !== undefined) {
      opts.query = buyer;
    } else if (cpvCodes && cpvCodes.length > 0) {
      // Auto-derive a Norwegian keyword query from CPV labels so Doffin's
      // free-text search returns relevant award notices. Routed through
      // `doffinQuery` to avoid corrupting TED's structured expert query.
      const labels = cpvCodes
        .map((c) => ctx.cpv.lookup(c))
        .filter((e): e is NonNullable<ReturnType<typeof ctx.cpv.lookup>> => Boolean(e?.label_no))
        .map((e) => e.label_no!)
        .slice(0, 3)
        .join(" ");
      if (labels.length > 0) opts.doffinQuery = `${labels} tildelt`;
    }
    if (limit !== undefined) opts.limit = limit;

    const { tenders, warnings } = await ctx.search.search(opts);

    const requestedPrefixes =
      requireCpvPrimary && cpvCodes && cpvCodes.length > 0
        ? new Set(cpvCodes.map(stripCheckDigit))
        : null;

    const stripped = tenders
      .filter((t) => t.status === "awarded")
      .filter((t) => {
        if (!requestedPrefixes) return true;
        const primary = t.cpvCodes
          .slice(0, PRIMARY_WINDOW)
          .map(stripCheckDigit);
        return primary.some((c) => requestedPrefixes.has(c));
      })
      .map(({ raw: _raw, ...rest }) => rest);
    return { tenders: stripped, warnings };
  },
};
