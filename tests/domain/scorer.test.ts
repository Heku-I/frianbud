import { describe, it, expect } from "vitest";
import type { Tender, Profile } from "../../src/types.js";
import {
  cpvOverlapSignal,
  regionMatchSignal,
  valueInRangeSignal,
} from "../../src/domain/scorer-signals.js";

const baseProfile: Profile = {
  schemaVersion: 1,
  companyName: "Test AS",
  whatWeDo: "Cleaning",
  regions: ["NO081"],
  valueRange: { min: 100_000, max: 5_000_000, currency: "NOK" },
  languages: ["no", "en"],
  cpvCodes: ["90910000-9"],
  certifications: [],
  exclusions: { keywords: [], cpvCodes: [] },
  preferredBuyers: [],
  minLeadTimeDays: 7,
};

const baseTender: Tender = {
  id: "ted:1",
  source: "ted",
  sourceUrl: "https://ted.europa.eu/notice/1",
  title: "Cleaning tender",
  buyer: { name: "Oslo Kommune", country: "NO" },
  cpvCodes: ["90910000-9"],
  description: "...",
  publishedAt: "2026-04-01T00:00:00Z",
  deadlineAt: "2026-05-30T00:00:00Z",
  estimatedValue: { amount: 1_000_000, currency: "NOK" },
  regions: ["NO081"],
  languages: ["no"],
  status: "open",
  raw: {},
};

describe("cpvOverlapSignal", () => {
  it("scores 35 when all tender CPVs are in profile", () => {
    const result = cpvOverlapSignal(
      { ...baseTender, cpvCodes: ["90910000-9"] },
      { ...baseProfile, cpvCodes: ["90910000-9"] }
    );
    expect(result.contribution).toBe(35);
    expect(result.detail).toMatch(/100%/);
  });

  it("scores 0 when no overlap", () => {
    const result = cpvOverlapSignal(
      { ...baseTender, cpvCodes: ["72000000-5"] },
      { ...baseProfile, cpvCodes: ["90910000-9"] }
    );
    expect(result.contribution).toBe(0);
  });

  it("scores half-credit for parent-code fuzzy match", () => {
    // Tender uses 90910000-9; profile has the parent 90900000-?
    // Implementation: a tender CPV whose 4-digit prefix matches a profile CPV's 4-digit prefix counts as half a hit.
    const result = cpvOverlapSignal(
      { ...baseTender, cpvCodes: ["90919000-2"] }, // sibling under 9091 prefix
      { ...baseProfile, cpvCodes: ["90910000-9"] }
    );
    expect(result.contribution).toBeGreaterThan(0);
    expect(result.contribution).toBeLessThan(35);
  });

  it("primary CPV (first) is weighted more than secondary", () => {
    const tenderPrimary = {
      ...baseTender,
      cpvCodes: ["90910000-9", "72000000-5"],
    };
    const tenderSecondary = {
      ...baseTender,
      cpvCodes: ["72000000-5", "90910000-9"],
    };
    const profile = { ...baseProfile, cpvCodes: ["90910000-9"] };
    const a = cpvOverlapSignal(tenderPrimary, profile);
    const b = cpvOverlapSignal(tenderSecondary, profile);
    expect(a.contribution).toBeGreaterThan(b.contribution);
  });
});

describe("regionMatchSignal", () => {
  it("scores 20 when regions intersect", () => {
    const r = regionMatchSignal(
      { ...baseTender, regions: ["NO081"] },
      { ...baseProfile, regions: ["NO081", "NO091"] }
    );
    expect(r.contribution).toBe(20);
  });

  it("scores 0 with no intersection", () => {
    const r = regionMatchSignal(
      { ...baseTender, regions: ["NO091"] },
      { ...baseProfile, regions: ["NO081"] }
    );
    expect(r.contribution).toBe(0);
  });

  it("scores 0 when tender has no regions", () => {
    const r = regionMatchSignal(
      { ...baseTender, regions: [] },
      baseProfile
    );
    expect(r.contribution).toBe(0);
  });
});

describe("valueInRangeSignal", () => {
  it("scores 15 when value is well inside the band", () => {
    const r = valueInRangeSignal(
      { ...baseTender, estimatedValue: { amount: 1_000_000, currency: "NOK" } },
      { ...baseProfile, valueRange: { min: 100_000, max: 5_000_000, currency: "NOK" } }
    );
    expect(r.contribution).toBe(15);
  });

  it("scores 0 when far below range", () => {
    const r = valueInRangeSignal(
      { ...baseTender, estimatedValue: { amount: 1_000, currency: "NOK" } },
      baseProfile
    );
    expect(r.contribution).toBe(0);
  });

  it("scores 0 when far above range", () => {
    const r = valueInRangeSignal(
      { ...baseTender, estimatedValue: { amount: 100_000_000, currency: "NOK" } },
      baseProfile
    );
    expect(r.contribution).toBe(0);
  });

  it("scores 0 when value is missing on tender", () => {
    const t = { ...baseTender };
    delete (t as { estimatedValue?: unknown }).estimatedValue;
    const r = valueInRangeSignal(t as Tender, baseProfile);
    expect(r.contribution).toBe(0);
  });

  it("currency mismatch scores 0", () => {
    const r = valueInRangeSignal(
      { ...baseTender, estimatedValue: { amount: 1_000_000, currency: "EUR" } },
      baseProfile
    );
    expect(r.contribution).toBe(0);
  });
});
