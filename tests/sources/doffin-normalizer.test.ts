import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeDoffinSearchHit,
  normalizeDoffinDetail,
} from "../../src/sources/doffin-normalizer.js";
import { TenderSchema } from "../../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const search = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/doffin-search-sample.json"), "utf8"),
);
const detail = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/doffin-detail-sample.json"), "utf8"),
);

describe("normalizeDoffinSearchHit", () => {
  it("produces a valid Tender", () => {
    const t = normalizeDoffinSearchHit(search);
    expect(() => TenderSchema.parse(t)).not.toThrow();
  });

  it("prefixes id with 'doffin:'", () => {
    expect(normalizeDoffinSearchHit(search).id.startsWith("doffin:")).toBe(true);
  });

  it("sets source to 'doffin'", () => {
    expect(normalizeDoffinSearchHit(search).source).toBe("doffin");
  });

  it("buyer.country is 'NO'", () => {
    expect(normalizeDoffinSearchHit(search).buyer.country).toBe("NO");
  });

  it("captures organizationId as orgNumber", () => {
    const t = normalizeDoffinSearchHit(search);
    expect(t.buyer.orgNumber).toBeDefined();
    expect(typeof t.buyer.orgNumber).toBe("string");
  });

  it("regions are NUTS codes (no mapping needed)", () => {
    const t = normalizeDoffinSearchHit(search);
    for (const r of t.regions) expect(r).toMatch(/^NO/);
  });

  it("search hits have empty cpvCodes (CPVs only on detail)", () => {
    const t = normalizeDoffinSearchHit(search);
    expect(t.cpvCodes).toEqual([]);
  });

  it("derives status 'open' from ACTIVE", () => {
    const t = normalizeDoffinSearchHit({ ...search, status: "ACTIVE" });
    expect(t.status).toBe("open");
  });

  it("derives status 'closed' from EXPIRED", () => {
    const t = normalizeDoffinSearchHit({ ...search, status: "EXPIRED" });
    expect(t.status).toBe("closed");
  });

  it("derives status 'awarded' from allTypes RESULT (status null on award notices)", () => {
    const t = normalizeDoffinSearchHit({
      ...search,
      status: null,
      allTypes: ["ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT", "RESULT"],
    });
    expect(t.status).toBe("awarded");
  });

  it("derives status 'cancelled' from allTypes CANCELLATION", () => {
    const t = normalizeDoffinSearchHit({
      ...search,
      status: null,
      allTypes: ["CANCELLATION"],
    });
    expect(t.status).toBe("cancelled");
  });

  it("preserves the original payload in raw", () => {
    const t = normalizeDoffinSearchHit(search);
    expect(t.raw).toBe(search);
  });

  it("throws on payload missing id", () => {
    expect(() => normalizeDoffinSearchHit({})).toThrow(/id/);
  });
});

describe("normalizeDoffinDetail", () => {
  it("populates cpvCodes from directCpvCodes", () => {
    const t = normalizeDoffinDetail(detail);
    expect(t.cpvCodes.length).toBeGreaterThan(0);
  });

  it("produces a valid Tender", () => {
    const t = normalizeDoffinDetail(detail);
    expect(() => TenderSchema.parse(t)).not.toThrow();
  });
});
