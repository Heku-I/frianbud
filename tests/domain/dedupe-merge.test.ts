import { describe, it, expect } from "vitest";
import { dedupeMerge } from "../../src/domain/dedupe-merge.js";
import type { Tender } from "../../src/types.js";

function t(over: Partial<Tender> = {}): Tender {
  return {
    id: over.id ?? "ted:1",
    source: over.source ?? "ted",
    sourceUrl: "https://x",
    title: "T",
    buyer: over.buyer ?? { name: "B", country: "NO", orgNumber: "111" },
    cpvCodes: over.cpvCodes ?? ["90910000-9"],
    description: "",
    publishedAt: over.publishedAt ?? "2026-04-01T00:00:00Z",
    regions: [],
    languages: [],
    status: "open",
    raw: {},
    ...over,
  };
}

describe("dedupeMerge", () => {
  it("returns the union when no overlap", () => {
    const out = dedupeMerge(
      [t({ id: "ted:1" })],
      [
        t({
          id: "doffin:2",
          source: "doffin",
          buyer: { name: "Other", country: "NO", orgNumber: "222" },
        }),
      ],
    );
    expect(out).toHaveLength(2);
  });

  it("dedupes a tender appearing in both, TED wins", () => {
    const tedT = t({ id: "ted:1" });
    const doffinT = t({
      id: "doffin:dup",
      source: "doffin",
      // same buyer org + same primary CPV + same week → considered duplicate
    });
    const out = dedupeMerge([tedT], [doffinT]);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe("ted");
  });

  it("does not dedupe when buyer differs", () => {
    const a = t({ id: "ted:1" });
    const b = t({
      id: "doffin:2",
      source: "doffin",
      buyer: { name: "Other", country: "NO", orgNumber: "222" },
    });
    expect(dedupeMerge([a], [b])).toHaveLength(2);
  });

  it("does not dedupe when published in different weeks", () => {
    const a = t({ id: "ted:1", publishedAt: "2026-04-01T00:00:00Z" });
    const b = t({
      id: "doffin:2",
      source: "doffin",
      publishedAt: "2026-05-01T00:00:00Z",
    });
    expect(dedupeMerge([a], [b])).toHaveLength(2);
  });
});
