import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import type { SearchOptions } from "../domain/search.js";

const inputSchema = z.object({
  withinDays: z.number().int().positive().max(365).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const listUpcomingDeadlinesTool: ToolDefinition<typeof inputSchema> = {
  name: "list_upcoming_deadlines",
  description:
    "Return tenders matching the user's profile that are closing within the next N days, sorted by urgency (nearest deadline first). Default `withinDays` is 14. Powers prompts like 'show me everything closing in the next two weeks'.",
  inputSchema,
  async handler({ withinDays = 14, limit }, ctx) {
    const deadline = new Date(Date.now() + withinDays * 86_400_000).toISOString();
    const opts: SearchOptions = {
      deadlineBefore: deadline,
      status: "open",
    };
    if (limit !== undefined) opts.limit = limit;
    const { tenders, warnings } = await ctx.search.search(opts);
    const stripped = tenders.map(({ raw: _raw, ...rest }) => rest);
    return { tenders: stripped, warnings };
  },
};
