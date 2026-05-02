import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  text: z.string().optional(),
  code: z.string().optional(),
});

export const lookupCpvTool: ToolDefinition<typeof inputSchema> = {
  name: "lookup_cpv",
  description:
    "Bidirectional CPV (procurement category) lookup. Pass `text` for human-language to suggested codes (e.g. 'office cleaning' returns 90910000-9). Pass `code` for code to label plus the chain of ancestor and descendant categories. Provide exactly one of `text` or `code`.",
  inputSchema,
  async handler({ text, code }, ctx) {
    if ((text === undefined) === (code === undefined)) {
      return {
        error: {
          kind: "user_input",
          message: "provide exactly one of `text` or `code`",
        },
      };
    }
    if (text !== undefined) {
      const suggestions = ctx.cpv.search(text, 10);
      return { suggestions };
    }
    const entry = ctx.cpv.lookup(code!);
    if (!entry) {
      return { error: { kind: "user_input", message: `unknown CPV code: ${code}`, field: "code" } };
    }
    const { ancestors, descendants } = ctx.cpv.expand(code!);
    return { entry, ancestors, descendants };
  },
};
