import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTedNotice } from "../../src/sources/ted-normalizer.js";
import { TenderSchema } from "../../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/ted-notice-sample.json"), "utf8"),
);

describe("normalizeTedNotice", () => {
  it("produces a valid Tender from real TED response", () => {
    const t = normalizeTedNotice(sample);
    expect(() => TenderSchema.parse(t)).not.toThrow();
  });

  it("prefixes id with 'ted:' followed by publication-number", () => {
    const t = normalizeTedNotice(sample);
    expect(t.id).toMatch(/^ted:[\d-]+$/);
  });

  it("sets source to 'ted'", () => {
    expect(normalizeTedNotice(sample).source).toBe("ted");
  });

  it("preserves the original payload in raw", () => {
    const t = normalizeTedNotice(sample);
    expect(t.raw).toBe(sample);
  });

  it("converts 3-letter buyer country to 2-letter", () => {
    const danish = normalizeTedNotice({
      ...sample,
      "buyer-country": ["DNK"],
    });
    expect(danish.buyer.country).toBe("DK");
  });

  it("normalizes publication-date to ISO 8601 datetime", () => {
    const t = normalizeTedNotice(sample);
    expect(t.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("uses links.html.ENG as sourceUrl when available", () => {
    const t = normalizeTedNotice(sample);
    expect(t.sourceUrl).toContain("ted.europa.eu");
  });

  it("falls back to constructed URL when links.html.ENG absent", () => {
    const noLinks = { ...sample };
    delete (noLinks as { links?: unknown }).links;
    const t = normalizeTedNotice(noLinks);
    expect(t.sourceUrl).toMatch(/^https:\/\/ted\.europa\.eu\/en\/notice\/-\/detail\//);
  });

  it("throws on payload missing publication-number", () => {
    expect(() => normalizeTedNotice({})).toThrow(/publication-number/);
  });

  it("derives status 'awarded' from notice-type prefix 'can-'", () => {
    const t = normalizeTedNotice({ ...sample, "notice-type": "can-standard" });
    expect(t.status).toBe("awarded");
  });
});
