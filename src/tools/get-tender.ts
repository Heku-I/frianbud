import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({ id: z.string().min(1) });

export const getTenderTool: ToolDefinition<typeof inputSchema> = {
  name: "get_tender",
  description:
    "Return full detail for a single tender by its ID (e.g. 'ted:123-2026' or 'doffin:abc-789'). Includes the source-specific raw payload for debugging or for fields not present in the unified type.",
  inputSchema,
  async handler({ id }, ctx) {
    const colon = id.indexOf(":");
    if (colon < 0) {
      return { error: { kind: "user_input", message: "id must be of the form 'source:id'", field: "id" } };
    }
    const source = id.slice(0, colon);
    const rest = id.slice(colon + 1);
    try {
      if (source === "ted") return { tender: await ctx.ted.getNotice(rest) };
      if (source === "doffin") return { tender: await ctx.doffin.getNotice(rest) };
      return { error: { kind: "user_input", message: `unknown source '${source}'`, field: "id" } };
    } catch (err) {
      return {
        error: {
          kind: "upstream",
          source,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  },
};
