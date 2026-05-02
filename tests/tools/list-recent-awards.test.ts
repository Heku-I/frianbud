import { describe, it, expect, vi } from "vitest";
import { listRecentAwardsTool } from "../../src/tools/list-recent-awards.js";

describe("list_recent_awards tool", () => {
  it("filters to awarded status and forwards buyer/cpv filters", async () => {
    const search = {
      search: vi.fn(async () => ({ tenders: [], warnings: [] })),
    };
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      search,
    } as unknown as Parameters<typeof listRecentAwardsTool.handler>[1];

    await listRecentAwardsTool.handler(
      { sinceDays: 30, buyer: "Oslo Kommune", cpvCodes: ["72000000-5"] },
      ctx
    );
    expect(search.search).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awarded",
        cpvCodes: ["72000000-5"],
      })
    );
  });
});
