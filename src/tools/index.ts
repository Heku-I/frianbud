import type { AnyToolDefinition } from "./types.js";
import { setupProfileTool } from "./setup-profile.js";
import { getProfileTool } from "./get-profile.js";
import { searchTendersTool } from "./search-tenders.js";
import { getTenderTool } from "./get-tender.js";

export const tools: AnyToolDefinition[] = [
  setupProfileTool as AnyToolDefinition,
  getProfileTool as AnyToolDefinition,
  searchTendersTool as AnyToolDefinition,
  getTenderTool as AnyToolDefinition,
];
