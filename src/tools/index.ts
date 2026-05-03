import type { AnyToolDefinition } from "./types.js";
import { setupProfileTool } from "./setup-profile.js";
import { getProfileTool } from "./get-profile.js";
import { searchTendersTool } from "./search-tenders.js";
import { getTenderTool } from "./get-tender.js";
import { listUpcomingDeadlinesTool } from "./list-upcoming-deadlines.js";
import { listRecentAwardsTool } from "./list-recent-awards.js";
import { lookupCpvTool } from "./lookup-cpv.js";
import { lookupOrganizationTool } from "./lookup-organization.js";

export const tools: AnyToolDefinition[] = [
  setupProfileTool as AnyToolDefinition,
  getProfileTool as AnyToolDefinition,
  searchTendersTool as AnyToolDefinition,
  getTenderTool as AnyToolDefinition,
  listUpcomingDeadlinesTool as AnyToolDefinition,
  listRecentAwardsTool as AnyToolDefinition,
  lookupCpvTool as AnyToolDefinition,
  lookupOrganizationTool as AnyToolDefinition,
];
