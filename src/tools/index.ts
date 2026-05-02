import type { AnyToolDefinition } from "./types.js";
import { setupProfileTool } from "./setup-profile.js";

export const tools: AnyToolDefinition[] = [setupProfileTool as AnyToolDefinition];
