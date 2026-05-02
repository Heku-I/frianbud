import { z } from "zod";
import { ProfileDraftSchema } from "../types.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  partial: ProfileDraftSchema,
});

export const setupProfileTool: ToolDefinition<typeof inputSchema> = {
  name: "setup_profile",
  description:
    "Advance the company profile draft. Pass any subset of profile fields in `partial`; the tool returns what's still missing and may suggest relevant CPV codes based on the company's description. Repeat the call with growing drafts until the response sets `saved: true`. The profile is persisted only when complete. Example: a user describing a cleaning company in Oslo would call this with `{ partial: { companyName: 'Acme', whatWeDo: 'Office cleaning', regions: ['NO081'] } }`.",
  inputSchema,
  async handler({ partial }, ctx) {
    const result = await ctx.profile.advanceDraft(partial);
    return result;
  },
};
