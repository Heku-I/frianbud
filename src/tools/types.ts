import type { z } from "zod";
import type { Logger } from "../infra/logger.js";
import type { ProfileService } from "../domain/profile.js";
import type { SearchService } from "../domain/search.js";
import type { CpvService } from "../domain/cpv.js";
import type { TedClient } from "../sources/ted.js";
import type { DoffinGate } from "../sources/doffin-health-gate.js";

export type ToolContext = {
  logger: Logger;
  profile: ProfileService;
  search: SearchService;
  cpv: CpvService;
  ted: TedClient;
  doffin: DoffinGate;
};

export type ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  inputSchema: S;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
};
