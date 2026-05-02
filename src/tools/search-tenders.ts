import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import type { ScoredTender } from "../types.js";
import type { SearchOptions } from "../domain/search.js";

const inputSchema = z.object({
  query: z.string().optional(),
  cpvCodes: z.array(z.string()).optional(),
  regions: z.array(z.string()).optional(),
  valueMin: z.number().nonnegative().optional(),
  valueMax: z.number().positive().optional(),
  deadlineBefore: z.string().optional(),
  status: z.enum(["open", "closed", "awarded"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

function strip(t: ScoredTender) {
  const { raw, ...rest } = t;
  void raw;
  return rest;
}

function toSearchOptions(input: z.infer<typeof inputSchema>): SearchOptions {
  // exactOptionalPropertyTypes: only assign keys whose values are defined,
  // so we don't accidentally widen optionals to `T | undefined`.
  const opts: SearchOptions = {};
  if (input.query !== undefined) opts.query = input.query;
  if (input.cpvCodes !== undefined) opts.cpvCodes = input.cpvCodes;
  if (input.regions !== undefined) opts.regions = input.regions;
  if (input.valueMin !== undefined) opts.valueMin = input.valueMin;
  if (input.valueMax !== undefined) opts.valueMax = input.valueMax;
  if (input.deadlineBefore !== undefined) opts.deadlineBefore = input.deadlineBefore;
  if (input.status !== undefined) opts.status = input.status;
  if (input.limit !== undefined) opts.limit = input.limit;
  return opts;
}

export const searchTendersTool: ToolDefinition<typeof inputSchema> = {
  name: "search_tenders",
  description:
    "Search Norwegian public tenders from TED and Doffin. Results are deduped, scored against the user's profile (if set up), and sorted with the most relevant first. Pass `query` for free-text search, `cpvCodes` for procurement category filtering, or `regions` (NUTS codes) for geographic filtering. With no arguments, returns the highest-scoring tenders matching the profile right now. Each result includes `score` (0-100) and `reasons` explaining the match. Examples: 'cleaning contracts in Oslo closing in two weeks', 'IT consulting tenders that match my company'.",
  inputSchema,
  async handler(input, ctx) {
    const { tenders, warnings } = await ctx.search.search(toSearchOptions(input));
    return {
      tenders: tenders.map(strip),
      warnings,
    };
  },
};
