import { describe, it, expect, vi } from "vitest";
import { createDoffinHealthGate } from "../../src/sources/doffin-health-gate.js";
import type { DoffinClient } from "../../src/sources/doffin.js";

function mockClient(behaviors: Array<"ok" | "fail">): DoffinClient {
  let i = 0;
  return {
    search: vi.fn(async () => {
      const b = behaviors[i++] ?? "ok";
      if (b === "fail") throw new Error("upstream");
      return [];
    }),
    getNotice: vi.fn(),
    healthCheck: vi.fn(async () => {
      const b = behaviors[i++] ?? "ok";
      return b === "fail" ? { ok: false, reason: "down" } : { ok: true };
    }),
  } as unknown as DoffinClient;
}

describe("DoffinHealthGate", () => {
  it("starts enabled when initial health check passes", async () => {
    const client = mockClient(["ok"]);
    const gate = await createDoffinHealthGate(client);
    expect(gate.isEnabled()).toBe(true);
  });

  it("starts disabled when initial health check fails", async () => {
    const client = mockClient(["fail"]);
    const gate = await createDoffinHealthGate(client);
    expect(gate.isEnabled()).toBe(false);
  });

  it("trips on a failed real call", async () => {
    const client = mockClient(["ok", "fail"]);
    const gate = await createDoffinHealthGate(client);
    expect(gate.isEnabled()).toBe(true);
    await expect(gate.search({ query: "x" })).rejects.toThrow();
    expect(gate.isEnabled()).toBe(false);
  });

  it("FRIANBUD_DOFFIN=off forces disabled regardless of health", async () => {
    process.env.FRIANBUD_DOFFIN = "off";
    try {
      const client = mockClient(["ok"]);
      const gate = await createDoffinHealthGate(client);
      expect(gate.isEnabled()).toBe(false);
    } finally {
      delete process.env.FRIANBUD_DOFFIN;
    }
  });

  it("returns empty results and disables when search throws", async () => {
    const client = mockClient(["ok", "fail"]);
    const gate = await createDoffinHealthGate(client);
    const result = await gate.searchSafe({ query: "x" });
    expect(result.tenders).toEqual([]);
    expect(result.warning).toBeDefined();
    expect(gate.isEnabled()).toBe(false);
  });
});
