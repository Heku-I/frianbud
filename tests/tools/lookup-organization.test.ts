import { describe, it, expect, vi } from "vitest";
import { lookupOrganizationTool } from "../../src/tools/lookup-organization.js";

function makeCtx(brregLookup: ReturnType<typeof vi.fn>) {
  return {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    brreg: { lookup: brregLookup },
  } as unknown as Parameters<typeof lookupOrganizationTool.handler>[1];
}

describe("lookup_organization tool", () => {
  it("returns { exists: true, organization } for known orgs", async () => {
    const lookup = vi.fn(async () => ({
      orgNumber: "917719993",
      name: "4SERVICE EIR RENHOLD AS",
      organizationForm: "AS",
      active: true,
      bankrupt: false,
      underWinding: false,
      address: { municipality: "OSLO", municipalityCode: "0301" },
      raw: {},
    }));
    const ctx = makeCtx(lookup);
    const result = (await lookupOrganizationTool.handler(
      { orgNumber: "917719993" },
      ctx,
    )) as { exists: boolean; organization?: { name: string } };
    expect(result.exists).toBe(true);
    expect(result.organization?.name).toBe("4SERVICE EIR RENHOLD AS");
  });

  it("returns { exists: false } for unknown orgs", async () => {
    const lookup = vi.fn(async () => null);
    const ctx = makeCtx(lookup);
    const result = await lookupOrganizationTool.handler(
      { orgNumber: "000000000" },
      ctx,
    );
    expect(result).toEqual({ exists: false });
  });

  it("returns user_input error for malformed org numbers", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("invalid Norwegian org number: 'bad' (expected 9 digits)");
    });
    const ctx = makeCtx(lookup);
    const result = (await lookupOrganizationTool.handler(
      { orgNumber: "bad" },
      ctx,
    )) as { error?: { kind: string; field?: string } };
    expect(result.error?.kind).toBe("user_input");
    expect(result.error?.field).toBe("orgNumber");
  });
});
