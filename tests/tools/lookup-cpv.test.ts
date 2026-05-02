import { describe, it, expect } from "vitest";
import { lookupCpvTool } from "../../src/tools/lookup-cpv.js";
import { createCpvService } from "../../src/domain/cpv.js";

const cpv = createCpvService([
  { code: "90910000-9", label_en: "Cleaning services", parent: null },
  { code: "72000000-5", label_en: "IT services", parent: null },
  { code: "72200000-7", label_en: "Software programming and consultancy services", parent: "72000000-5" },
]);

describe("lookup_cpv tool", () => {
  const ctx = { logger: { info: () => {}, warn: () => {}, error: () => {} }, cpv } as Parameters<typeof lookupCpvTool.handler>[1];

  it("returns suggestions for a text query", async () => {
    const result = (await lookupCpvTool.handler({ text: "cleaning" }, ctx)) as { suggestions: Array<{ code: string }> };
    expect(result.suggestions[0]?.code).toBe("90910000-9");
  });

  it("returns label + parents/children for a code", async () => {
    const result = (await lookupCpvTool.handler({ code: "72200000-7" }, ctx)) as {
      entry: { code: string };
      ancestors: Array<{ code: string }>;
    };
    expect(result.entry.code).toBe("72200000-7");
    expect(result.ancestors[0]?.code).toBe("72000000-5");
  });

  it("returns user_input error if neither text nor code provided", async () => {
    const result = (await lookupCpvTool.handler({}, ctx)) as { error?: { kind: string } };
    expect(result.error?.kind).toBe("user_input");
  });

  it("returns user_input error if both text and code provided", async () => {
    const result = (await lookupCpvTool.handler({ text: "x", code: "1" }, ctx)) as { error?: { kind: string } };
    expect(result.error?.kind).toBe("user_input");
  });
});
