import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import type { SearchOptions } from "../domain/search.js";

const inputSchema = z.object({
  sinceDays: z.number().int().positive().max(365).optional(),
  buyer: z.string().optional(),
  cpvCodes: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

function isoDateNDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export const listRecentAwardsTool: ToolDefinition<typeof inputSchema> = {
  name: "list_recent_awards",
  description:
    "List contracts awarded in the last N days (default 30). Filter by buyer name or CPV code. " +
    "TED coverage is excellent for above-threshold contracts (1.4M NOK+) and returns full winner names, " +
    "org numbers, per-winner values, and total contract value. " +
    "Doffin coverage of awards is weaker because Doffin's API has no server-side CPV or status filter — " +
    "for incumbent rankings on a specific category, also pass a Norwegian keyword via search_tenders' " +
    "query field (e.g., 'renhold tildelt' for cleaning awards) to surface sub-threshold kommune contracts " +
    "Doffin holds exclusively. Useful for prompts like 'who won the last 5 IT contracts from Oslo Kommune?' " +
    "or 'recent awards for cleaning services'.",
  inputSchema,
  async handler({ sinceDays = 30, buyer, cpvCodes, limit }, ctx) {
    const opts: SearchOptions = {
      status: "awarded",
      publishedSince: isoDateNDaysAgo(sinceDays),
    };
    if (cpvCodes !== undefined) opts.cpvCodes = cpvCodes;
    if (buyer !== undefined) opts.query = buyer;
    if (limit !== undefined) opts.limit = limit;
    const { tenders, warnings } = await ctx.search.search(opts);
    // Status==awarded is the authoritative signal (set by source normalizers
    // from TED notice-type=can-* and Doffin allTypes contains "RESULT"). The
    // award block is populated by detail enrichment when winner names are
    // available, but we don't require it — many awards land with status set
    // before the winner field is wired up downstream.
    const stripped = tenders
      .filter((t) => t.status === "awarded")
      .map(({ raw: _raw, ...rest }) => rest);
    return { tenders: stripped, warnings };
  },
};
