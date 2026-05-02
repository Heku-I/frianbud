import { describe, it, expect, vi } from "vitest";
import { searchTendersTool } from "../../src/tools/search-tenders.js";

function makeCtx(searchImpl: () => Promise<{ tenders: unknown[]; warnings: unknown[] }>) {
  return {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    search: { search: vi.fn(searchImpl) },
  } as unknown as Parameters<typeof searchTendersTool.handler>[1];
}

describe("search_tenders tool", () => {
  it("forwards query/filters/limit to the search service", async () => {
    const ctx = makeCtx(async () => ({ tenders: [], warnings: [] }));
    await searchTendersTool.handler(
      {
        query: "renhold",
        cpvCodes: ["90910000-9"],
        regions: ["NO081"],
        limit: 10,
      },
      ctx
    );
    expect(ctx.search.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "renhold", cpvCodes: ["90910000-9"], limit: 10 })
    );
  });

  it("strips `raw` field from response", async () => {
    const ctx = makeCtx(async () => ({
      tenders: [
        {
          id: "ted:1",
          source: "ted",
          sourceUrl: "u",
          title: "t",
          buyer: { name: "B", country: "NO" },
          cpvCodes: [],
          description: "",
          publishedAt: "2026-04-01T00:00:00Z",
          regions: [],
          languages: [],
          status: "open",
          raw: { secret: "data" },
          score: 50,
          reasons: [],
        },
      ],
      warnings: [],
    }));
    const result = (await searchTendersTool.handler({}, ctx)) as {
      tenders: Array<Record<string, unknown>>;
    };
    expect("raw" in result.tenders[0]!).toBe(false);
  });

  it("includes warnings in the response", async () => {
    const ctx = makeCtx(async () => ({
      tenders: [],
      warnings: [{ source: "doffin", reason: "disabled" }],
    }));
    const result = (await searchTendersTool.handler({}, ctx)) as {
      warnings: unknown[];
    };
    expect(result.warnings).toHaveLength(1);
  });
});
