import type { AnyToolDefinition } from "./types.js";
import { setupProfileTool } from "./setup-profile.js";
import { getProfileTool } from "./get-profile.js";

export const tools: AnyToolDefinition[] = [
  setupProfileTool as AnyToolDefinition,
  getProfileTool as AnyToolDefinition,
];
