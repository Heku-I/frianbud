import { z } from "zod";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({});

export const getProfileTool: ToolDefinition<typeof inputSchema> = {
  name: "get_profile",
  description:
    "Return the saved company profile, or `{ exists: false }` if no profile has been set up yet. Useful before calling search tools to know whether scoring will be informed by a profile.",
  inputSchema,
  async handler(_input, ctx) {
    const profile = await ctx.profile.load();
    return profile ? { exists: true, profile } : { exists: false };
  },
};
