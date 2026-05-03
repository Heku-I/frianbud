import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  orgNumber: z.string().min(1),
});

export const lookupOrganizationTool: ToolDefinition<typeof inputSchema> = {
  name: "lookup_organization",
  description:
    "Look up a Norwegian organization by its 9-digit organisasjonsnummer (org number) " +
    "via Brønnøysund Register Centre's public API. Accepts the bare number ('917719993'), " +
    "the VAT-suffixed form ('NO917719993MVA'), or whitespace-separated digits ('917 719 993'). " +
    "Returns canonical company name, business address (street, municipality with kommunenummer), " +
    "industry code (NACE/næringskode), employee count, and active status (bankrupt/winding-down flags). " +
    "Indispensable for incumbent ranking and competitive analysis: validate winners against canonical " +
    "names, identify bankrupt or winding-down competitors, gauge company size by headcount, and " +
    "determine the actual registered region (better than buyer-tagged NUTS from procurement notices). " +
    "Returns { exists: false } for unknown org numbers.",
  inputSchema,
  async handler({ orgNumber }, ctx) {
    try {
      const org = await ctx.brreg.lookup(orgNumber);
      if (!org) return { exists: false };
      return { exists: true, organization: org };
    } catch (err) {
      return {
        error: {
          kind: "user_input",
          message: err instanceof Error ? err.message : String(err),
          field: "orgNumber",
        },
      };
    }
  },
};
