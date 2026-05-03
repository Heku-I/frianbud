import { describe, it, expect, vi } from "vitest";
import { listRecentAwardsTool } from "../../src/tools/list-recent-awards.js";

function makeCtx(opts: {
  searchResult?: { tenders: unknown[]; warnings: unknown[] };
  cpvLookups?: Record<string, { code: string; label_en: string; label_no?: string; parent: string | null }>;
}) {
  const searchResult = opts.searchResult ?? { tenders: [], warnings: [] };
  const cpvLookups = opts.cpvLookups ?? {};
  const search = {
    search: vi.fn(async () => searchResult),
  };
  const cpv = {
    lookup: (code: string) => cpvLookups[code],
    search: vi.fn(),
    expand: vi.fn(),
    all: vi.fn(),
  };
  return { ctx: { logger: { info: () => {}, warn: () => {}, error: () => {} }, search, cpv } as unknown as Parameters<typeof listRecentAwardsTool.handler>[1], search, cpv };
}

describe("list_recent_awards tool", () => {
  it("filters to awarded status and forwards buyer/cpv filters", async () => {
    const { ctx, search } = makeCtx({});
    await listRecentAwardsTool.handler(
      { sinceDays: 30, buyer: "Oslo Kommune", cpvCodes: ["72000000-5"] },
      ctx,
    );
    expect(search.search).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "awarded",
        cpvCodes: ["72000000-5"],
      }),
    );
  });

  it("computes publishedSince from sinceDays", async () => {
    const { ctx, search } = makeCtx({});
    await listRecentAwardsTool.handler({ sinceDays: 7 }, ctx);
    const call = (search.search as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      publishedSince?: string;
    };
    expect(call.publishedSince).toBeDefined();
    // The handler truncates to YYYY-MM-DD (date-only, no time-of-day).
    // Parsing it back gives midnight UTC of that day, so the diff from
    // Date.now() is in [days, days + 1) depending on the current time of
    // day in UTC. Loose bounds avoid time-of-day flake.
    expect(call.publishedSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const parsed = new Date(call.publishedSince!);
    const diffDays = (Date.now() - parsed.getTime()) / 86_400_000;
    expect(diffDays).toBeGreaterThanOrEqual(7);
    expect(diffDays).toBeLessThan(8);
  });

  it("auto-derives Doffin keywords from CPV labels when no buyer specified", async () => {
    const { ctx, search } = makeCtx({
      cpvLookups: {
        "90910000-9": { code: "90910000-9", label_en: "Cleaning services", label_no: "Rengjøring", parent: null },
        "90911000-6": { code: "90911000-6", label_en: "Accommodation cleaning", label_no: "Rengjøring av bolig", parent: null },
      },
    });
    await listRecentAwardsTool.handler(
      { cpvCodes: ["90910000-9", "90911000-6"] },
      ctx,
    );
    const call = (search.search as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      doffinQuery?: string;
      query?: string;
    };
    expect(call.doffinQuery).toContain("Rengjøring");
    expect(call.doffinQuery).toContain("tildelt");
    // Critical: keyword goes to doffinQuery only, not the shared query field
    // (TED's expert DSL would 400 on free text).
    expect(call.query).toBeUndefined();
  });

  it("buyer takes precedence over CPV-derived keywords", async () => {
    const { ctx, search } = makeCtx({
      cpvLookups: {
        "90910000-9": { code: "90910000-9", label_en: "Cleaning", label_no: "Rengjøring", parent: null },
      },
    });
    await listRecentAwardsTool.handler(
      { buyer: "Oslo Kommune", cpvCodes: ["90910000-9"] },
      ctx,
    );
    const call = (search.search as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      doffinQuery?: string;
      query?: string;
    };
    expect(call.query).toBe("Oslo Kommune");
    expect(call.doffinQuery).toBeUndefined();
  });

  it("filters out tenders where requested CPV is not in primary 3 positions", async () => {
    const { ctx } = makeCtx({
      searchResult: {
        tenders: [
          {
            // Construction contract with cleaning CPV in 5th position — should be filtered out
            id: "ted:construction",
            source: "ted",
            sourceUrl: "https://x",
            title: "Construction with cleaning component",
            buyer: { name: "X", country: "NO" },
            cpvCodes: ["45000000", "45100000", "45200000", "45300000", "90910000"],
            description: "Mostly construction",
            publishedAt: "2025-01-01T00:00:00Z",
            regions: [],
            languages: [],
            status: "awarded",
            raw: {},
          },
          {
            // Real cleaning award — primary CPV match
            id: "ted:cleaning",
            source: "ted",
            sourceUrl: "https://x",
            title: "Cleaning services",
            buyer: { name: "X", country: "NO" },
            cpvCodes: ["90910000", "90919200"],
            description: "Cleaning",
            publishedAt: "2025-01-01T00:00:00Z",
            regions: [],
            languages: [],
            status: "awarded",
            raw: {},
          },
        ],
        warnings: [],
      },
    });
    const result = (await listRecentAwardsTool.handler(
      { cpvCodes: ["90910000-9"] },
      ctx,
    )) as { tenders: Array<{ id: string }> };
    expect(result.tenders).toHaveLength(1);
    expect(result.tenders[0]?.id).toBe("ted:cleaning");
  });

  it("includes mixed-scope contracts when requireCpvPrimary is false", async () => {
    const { ctx } = makeCtx({
      searchResult: {
        tenders: [
          {
            id: "ted:construction",
            source: "ted",
            sourceUrl: "https://x",
            title: "Construction with cleaning",
            buyer: { name: "X", country: "NO" },
            cpvCodes: ["45000000", "45100000", "45200000", "45300000", "90910000"],
            description: "",
            publishedAt: "2025-01-01T00:00:00Z",
            regions: [],
            languages: [],
            status: "awarded",
            raw: {},
          },
        ],
        warnings: [],
      },
    });
    const result = (await listRecentAwardsTool.handler(
      { cpvCodes: ["90910000-9"], requireCpvPrimary: false },
      ctx,
    )) as { tenders: Array<{ id: string }> };
    expect(result.tenders).toHaveLength(1);
  });
});
