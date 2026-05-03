#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { createLogger } from "./infra/logger.js";
import { resolveProfilePath } from "./infra/paths.js";
import { loadBundledCpv } from "./domain/cpv.js";
import { createProfileService } from "./domain/profile.js";
import { createSearchService } from "./domain/search.js";
import { createTedClient } from "./sources/ted.js";
import { createDoffinClient } from "./sources/doffin.js";
import { createDoffinHealthGate } from "./sources/doffin-health-gate.js";
import { tools as toolList } from "./tools/index.js";
import type { AnyToolDefinition, ToolContext } from "./tools/types.js";

// Minimal zod -> JSON Schema converter. Covers the constructs used by our
// tool input schemas: object (with optional/required), string, number, boolean,
// literal, enum, array, union, discriminatedUnion, optional, nullable, default,
// effects (refine/transform), and unknown. For anything we don't know, we emit
// `{}` so the schema still parses on the client side.
type JsonSchema = Record<string, unknown>;

function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = (schema as unknown as { _def: { typeName: string } })._def;
  const typeName = def.typeName;

  switch (typeName) {
    case "ZodString": {
      const out: JsonSchema = { type: "string" };
      const checks = (def as unknown as { checks?: Array<Record<string, unknown>> }).checks ?? [];
      for (const c of checks) {
        if (c.kind === "min") out.minLength = c.value as number;
        if (c.kind === "max") out.maxLength = c.value as number;
        if (c.kind === "url") out.format = "uri";
        if (c.kind === "uuid") out.format = "uuid";
        if (c.kind === "length") {
          out.minLength = c.value as number;
          out.maxLength = c.value as number;
        }
      }
      return out;
    }
    case "ZodNumber": {
      const out: JsonSchema = { type: "number" };
      const checks = (def as unknown as { checks?: Array<Record<string, unknown>> }).checks ?? [];
      for (const c of checks) {
        if (c.kind === "int") out.type = "integer";
        if (c.kind === "min") {
          out.minimum = c.value as number;
          if (c.inclusive === false) out.exclusiveMinimum = true;
        }
        if (c.kind === "max") {
          out.maximum = c.value as number;
          if (c.inclusive === false) out.exclusiveMaximum = true;
        }
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral": {
      const value = (def as unknown as { value: unknown }).value;
      return { const: value };
    }
    case "ZodEnum": {
      const values = (def as unknown as { values: readonly string[] }).values;
      return { type: "string", enum: [...values] };
    }
    case "ZodNativeEnum": {
      const values = Object.values(
        (def as unknown as { values: Record<string, string | number> }).values,
      );
      return { enum: values };
    }
    case "ZodArray": {
      const inner = (def as unknown as { type: z.ZodTypeAny }).type;
      return { type: "array", items: zodToJsonSchema(inner) };
    }
    case "ZodObject": {
      const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const key of Object.keys(shape)) {
        const child = shape[key]!;
        properties[key] = zodToJsonSchema(child);
        if (!isOptional(child)) required.push(key);
      }
      const out: JsonSchema = { type: "object", properties };
      if (required.length > 0) out.required = required;
      return out;
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodEffects": {
      const inner =
        (def as unknown as { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny }).innerType ??
        (def as unknown as { schema?: z.ZodTypeAny }).schema;
      if (!inner) return {};
      return zodToJsonSchema(inner);
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options =
        (def as unknown as { options?: z.ZodTypeAny[] }).options ??
        Array.from(
          ((def as unknown as { optionsMap?: Map<string, z.ZodTypeAny> }).optionsMap ?? new Map()).values(),
        );
      return { anyOf: options.map(zodToJsonSchema) };
    }
    case "ZodRecord": {
      const value = (def as unknown as { valueType: z.ZodTypeAny }).valueType;
      return { type: "object", additionalProperties: zodToJsonSchema(value) };
    }
    case "ZodTuple": {
      const items = (def as unknown as { items: z.ZodTypeAny[] }).items;
      return { type: "array", items: items.map(zodToJsonSchema) };
    }
    case "ZodAny":
    case "ZodUnknown":
      return {};
    default:
      return {};
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const def = (schema as unknown as { _def: { typeName: string; innerType?: z.ZodTypeAny } })._def;
  if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") return true;
  if (def.typeName === "ZodEffects" && def.innerType) return isOptional(def.innerType);
  return false;
}

async function readPackageVersion(): Promise<string> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const raw = await readFile(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string") return parsed.version;
  } catch {
    // fall through
  }
  return "0.1.0";
}

async function main(): Promise<void> {
  const logger = createLogger();
  const version = await readPackageVersion();
  logger.info("startup", { version });

  const cpv = await loadBundledCpv();
  logger.info("cpv_loaded", { entries: cpv.all().length });

  const ted = createTedClient();
  const doffinClient = createDoffinClient();
  const doffin = await createDoffinHealthGate(doffinClient);
  logger.info("doffin_health", { enabled: doffin.isEnabled() });

  const profilePath = resolveProfilePath();
  const profile = createProfileService(profilePath, {
    suggestCpvCodes: (text) => cpv.search(text, 10).map((e) => e.code),
  });

  // Initial profile load + search service. The search service holds a snapshot
  // of the profile, so we rebind it on every tool call (see the tools/call
  // handler) — `setup_profile` may have just persisted a new profile.
  const initialProfile = await profile.load();
  let search = createSearchService({ ted, doffin, profile: initialProfile });

  const baseCtx: Omit<ToolContext, "search"> = {
    logger,
    profile,
    cpv,
    ted,
    doffin,
  };

  const toolsByName = new Map<string, AnyToolDefinition>();
  for (const t of toolList) toolsByName.set(t.name, t);

  const server = new Server(
    { name: "frianbud", version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolList.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.inputSchema),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const started = Date.now();
    const tool = toolsByName.get(name);

    if (!tool) {
      const error = {
        kind: "user_input" as const,
        message: `unknown tool '${name}'`,
      };
      logger.warn("tool_error", {
        tool: name,
        ms: Date.now() - started,
        message: error.message,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error }) }],
        isError: true,
      };
    }

    const parsed = tool.inputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      const error = {
        kind: "user_input" as const,
        message: parsed.error.message,
      };
      logger.warn("tool_error", {
        tool: name,
        ms: Date.now() - started,
        message: error.message,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error }) }],
        isError: true,
      };
    }

    // Reload profile and rebind the search service so a freshly persisted
    // profile from `setup_profile` takes effect on the very next call.
    const latestProfile = await profile.load();
    search = createSearchService({ ted, doffin, profile: latestProfile });
    const ctx: ToolContext = { ...baseCtx, search };

    try {
      const result = await tool.handler(parsed.data, ctx);
      logger.info("tool_call", { tool: name, ms: Date.now() - started });
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("tool_error", {
        tool: name,
        ms: Date.now() - started,
        message,
      });
      const error = { kind: "internal" as const, message };
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("ready");
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "fatal",
      message,
    }) + "\n",
  );
  process.exit(1);
});
