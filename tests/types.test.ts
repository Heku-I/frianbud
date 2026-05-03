import { describe, it, expect } from "vitest";
import {
  TenderSchema,
  ProfileSchema,
  ProfileDraftSchema,
  type Tender,
  type Profile,
} from "../src/types.js";

describe("TenderSchema", () => {
  const valid: Tender = {
    id: "ted:123-2025",
    source: "ted",
    sourceUrl: "https://ted.europa.eu/notice/123",
    title: "Cleaning services",
    buyer: { name: "Oslo Kommune", country: "NO" },
    cpvCodes: ["90910000-9"],
    description: "Daily cleaning of municipal offices",
    publishedAt: "2025-04-01T00:00:00Z",
    regions: ["NO081"],
    languages: ["no"],
    status: "open",
    raw: { anything: true },
  };

  it("accepts a minimal valid tender", () => {
    expect(() => TenderSchema.parse(valid)).not.toThrow();
  });

  it("rejects unknown source", () => {
    expect(() =>
      TenderSchema.parse({ ...valid, source: "wikipedia" })
    ).toThrow();
  });

  it("rejects non-ISO publishedAt", () => {
    expect(() =>
      TenderSchema.parse({ ...valid, publishedAt: "yesterday" })
    ).toThrow();
  });

  it("accepts an awarded tender with award block (single winner)", () => {
    expect(() =>
      TenderSchema.parse({
        ...valid,
        status: "awarded",
        award: {
          winners: [{ name: "Acme AS" }],
          awardedAt: "2025-04-30T00:00:00Z",
        },
      })
    ).not.toThrow();
  });

  it("accepts a multi-winner award with per-winner values and total", () => {
    expect(() =>
      TenderSchema.parse({
        ...valid,
        status: "awarded",
        award: {
          winners: [
            { name: "Acme AS", orgNumber: "111111111", value: 1_000_000 },
            { name: "Beta AS", orgNumber: "222222222", value: 2_000_000 },
          ],
          awardedAt: "2025-04-30T00:00:00Z",
          totalValue: 5_000_000,
          currency: "NOK",
        },
      })
    ).not.toThrow();
  });
});

describe("ProfileSchema", () => {
  const valid: Profile = {
    schemaVersion: 1,
    companyName: "Test AS",
    whatWeDo: "We clean offices.",
    regions: ["NO081"],
    valueRange: { min: 100_000, max: 5_000_000, currency: "NOK" },
    languages: ["no", "en"],
    cpvCodes: ["90910000-9"],
    certifications: [],
    exclusions: { keywords: [], cpvCodes: [] },
    preferredBuyers: [],
    minLeadTimeDays: 7,
  };

  it("accepts a complete profile", () => {
    expect(() => ProfileSchema.parse(valid)).not.toThrow();
  });

  it("rejects negative valueRange", () => {
    expect(() =>
      ProfileSchema.parse({ ...valid, valueRange: { ...valid.valueRange, min: -1 } })
    ).toThrow();
  });

  it("requires schemaVersion to be 1", () => {
    expect(() => ProfileSchema.parse({ ...valid, schemaVersion: 2 })).toThrow();
  });
});

describe("ProfileDraftSchema", () => {
  it("accepts an empty draft", () => {
    expect(() => ProfileDraftSchema.parse({})).not.toThrow();
  });

  it("accepts a partial draft", () => {
    expect(() =>
      ProfileDraftSchema.parse({ companyName: "X", regions: ["NO081"] })
    ).not.toThrow();
  });
});
