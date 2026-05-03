import type { z } from "zod";
import type { Logger } from "../infra/logger.js";
import type { ProfileService } from "../domain/profile.js";
import type { SearchService } from "../domain/search.js";
import type { CpvService } from "../domain/cpv.js";
import type { TedClient } from "../sources/ted.js";
import type { DoffinGate } from "../sources/doffin-health-gate.js";
import type { BrregClient } from "../sources/brreg.js";

export type ToolContext = {
  logger: Logger;
  profile: ProfileService;
  search: SearchService;
  cpv: CpvService;
  ted: TedClient;
  doffin: DoffinGate;
  brreg: BrregClient;
};

export type ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  inputSchema: S;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
};

// Erased shape used for collections of heterogeneous tools. The registry can't
// preserve each tool's specific input schema generic, so we describe the
// loosest contract callers need: the schema is a zod type, the handler takes
// the parsed value and a context.
export type AnyToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown>;
};
