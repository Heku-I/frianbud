import { describe, it, expect, vi } from "vitest";
import { getTenderTool } from "../../src/tools/get-tender.js";

describe("get_tender tool", () => {
  it("dispatches to TED for ted: ids", async () => {
    const ted = {
      getNotice: vi.fn(async () => ({ id: "ted:1", source: "ted" })),
      search: vi.fn(),
    };
    const doffin = { getNotice: vi.fn(), search: vi.fn(), isEnabled: () => true, searchSafe: vi.fn() };
    const ctx = { logger: { info: () => {}, warn: () => {}, error: () => {} }, ted, doffin } as unknown as Parameters<typeof getTenderTool.handler>[1];
    await getTenderTool.handler({ id: "ted:abc" }, ctx);
    expect(ted.getNotice).toHaveBeenCalledWith("abc");
    expect(doffin.getNotice).not.toHaveBeenCalled();
  });

  it("dispatches to Doffin for doffin: ids", async () => {
    const ted = { getNotice: vi.fn(), search: vi.fn() };
    const doffin = {
      getNotice: vi.fn(async () => ({ id: "doffin:1", source: "doffin" })),
      search: vi.fn(),
      isEnabled: () => true,
      searchSafe: vi.fn(),
    };
    const ctx = { logger: { info: () => {}, warn: () => {}, error: () => {} }, ted, doffin } as unknown as Parameters<typeof getTenderTool.handler>[1];
    await getTenderTool.handler({ id: "doffin:abc" }, ctx);
    expect(doffin.getNotice).toHaveBeenCalledWith("abc");
  });

  it("returns user_input error for unknown source prefix", async () => {
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      ted: { getNotice: vi.fn(), search: vi.fn() },
      doffin: { getNotice: vi.fn(), search: vi.fn(), isEnabled: () => true, searchSafe: vi.fn() },
    } as unknown as Parameters<typeof getTenderTool.handler>[1];
    const result = (await getTenderTool.handler({ id: "wikipedia:1" }, ctx)) as {
      error?: { kind: string };
    };
    expect(result.error?.kind).toBe("user_input");
  });
});
