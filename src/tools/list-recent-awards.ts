import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import type { SearchOptions } from "../domain/search.js";

const inputSchema = z.object({
  sinceDays: z.number().int().positive().max(365).optional(),
  buyer: z.string().optional(),
  cpvCodes: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const listRecentAwardsTool: ToolDefinition<typeof inputSchema> = {
  name: "list_recent_awards",
  description:
    "List contracts that were awarded in the last N days (default 30). Filter by buyer name or CPV code. Useful for prompts like 'who won the last 5 IT contracts from Oslo Kommune?' or 'recent awards for cleaning services'.",
  inputSchema,
  async handler({ sinceDays = 30, buyer, cpvCodes, limit }, ctx) {
    const opts: SearchOptions = { status: "awarded" };
    if (cpvCodes !== undefined) opts.cpvCodes = cpvCodes;
    if (buyer !== undefined) opts.query = buyer;
    if (limit !== undefined) opts.limit = limit;
    // sinceDays could be applied as a publishedSince filter via a future TED
    // search option; for now we post-filter on the award timestamp.
    const { tenders, warnings } = await ctx.search.search(opts);
    const stripped = tenders
      .filter((t) => {
        if (!t.award) return false;
        if (sinceDays) {
          const awarded = new Date(t.award.awardedAt).getTime();
          return Date.now() - awarded <= sinceDays * 86_400_000;
        }
        return true;
      })
      .map(({ raw: _raw, ...rest }) => rest);
    return { tenders: stripped, warnings };
  },
};
