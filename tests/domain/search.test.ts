import { describe, it, expect, vi } from "vitest";
import { createSearchService } from "../../src/domain/search.js";
import type { Profile, Tender } from "../../src/types.js";
import type { TedClient } from "../../src/sources/ted.js";
import type { DoffinGate } from "../../src/sources/doffin-health-gate.js";

function fakeProfile(): Profile {
  return {
    schemaVersion: 1,
    companyName: "T",
    whatWeDo: "Cleaning",
    regions: ["NO081"],
    valueRange: { min: 0, max: 10_000_000, currency: "NOK" },
    languages: ["no"],
    cpvCodes: ["90910000-9"],
    certifications: [],
    exclusions: { keywords: [], cpvCodes: [] },
    preferredBuyers: [],
    minLeadTimeDays: 0,
  };
}

function tedTender(id: string, score = 0): Tender {
  return {
    id: `ted:${id}`,
    source: "ted",
    sourceUrl: "https://x",
    title: "T",
    buyer: { name: "B", country: "NO", orgNumber: id },
    cpvCodes: ["90910000-9"],
    description: "",
    publishedAt: "2026-04-01T00:00:00Z",
    regions: ["NO081"],
    languages: ["no"],
    status: "open",
    raw: { score },
  };
}

function fakeTed(tenders: Tender[]): TedClient {
  return {
    search: vi.fn(async () => tenders),
    getNotice: vi.fn(),
  };
}

function fakeDoffin(tenders: Tender[], opts: { ok?: boolean; reason?: string } = { ok: true }): DoffinGate {
  return {
    isEnabled: () => opts.ok !== false,
    search: vi.fn(async () => tenders),
    getNotice: vi.fn(),
    searchSafe: vi.fn(async () =>
      opts.ok === false
        ? { tenders: [], warning: { source: "doffin", reason: opts.reason ?? "disabled" } }
        : { tenders }
    ),
  } as unknown as DoffinGate;
}

describe("SearchService.search", () => {
  it("returns scored, sorted tenders from both sources", async () => {
    const svc = createSearchService({
      ted: fakeTed([tedTender("a"), tedTender("b")]),
      doffin: fakeDoffin([]),
      profile: fakeProfile(),
    });
    const result = await svc.search({});
    expect(result.tenders.length).toBe(2);
    // Each result has score and reasons
    expect(result.tenders[0]?.score).toBeGreaterThanOrEqual(0);
    expect(result.tenders[0]?.reasons).toBeDefined();
    // Sorted by score desc
    expect(result.tenders[0]!.score).toBeGreaterThanOrEqual(result.tenders[1]!.score);
  });

  it("emits a warning when Doffin is disabled", async () => {
    const svc = createSearchService({
      ted: fakeTed([tedTender("a")]),
      doffin: fakeDoffin([], { ok: false, reason: "5xx" }),
      profile: fakeProfile(),
    });
    const result = await svc.search({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.source).toBe("doffin");
  });

  it("respects limit", async () => {
    const many = Array.from({ length: 50 }, (_, i) => tedTender(String(i)));
    const svc = createSearchService({
      ted: fakeTed(many),
      doffin: fakeDoffin([]),
      profile: fakeProfile(),
    });
    const result = await svc.search({ limit: 5 });
    expect(result.tenders).toHaveLength(5);
  });

  it("forwards filters to both sources", async () => {
    const ted = fakeTed([]);
    const doffin = fakeDoffin([]);
    const svc = createSearchService({
      ted,
      doffin,
      profile: fakeProfile(),
    });
    await svc.search({
      cpvCodes: ["72000000-5"],
      regions: ["NO081"],
      deadlineBefore: "2026-06-01T00:00:00Z",
      limit: 10,
    });
    expect(ted.search).toHaveBeenCalledWith(
      expect.objectContaining({ cpvCodes: ["72000000-5"] })
    );
    expect(doffin.searchSafe).toHaveBeenCalledWith(
      expect.objectContaining({ cpvCodes: ["72000000-5"] })
    );
  });

  it("does not throw when TED throws — returns Doffin results + warning", async () => {
    const ted: TedClient = {
      search: vi.fn(async () => {
        throw new Error("TED down");
      }),
      getNotice: vi.fn(),
    };
    const svc = createSearchService({
      ted,
      doffin: fakeDoffin([tedTender("d1")]),
      profile: fakeProfile(),
    });
    const result = await svc.search({});
    expect(result.tenders.length).toBe(1);
    expect(result.warnings.some((w) => w.source === "ted")).toBe(true);
  });
});
