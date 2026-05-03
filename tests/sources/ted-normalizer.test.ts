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

  it("dedupes repeated CPV codes", () => {
    const t = normalizeTedNotice({
      ...sample,
      "classification-cpv": ["90910000", "45000000", "90910000", "45000000", "90910000"],
    });
    expect(t.cpvCodes).toEqual(["90910000", "45000000"]);
  });

  it("dedupes regions and maps 3-letter countries to 2-letter", () => {
    const t = normalizeTedNotice({
      ...sample,
      "place-of-performance": ["NO081", "NOR", "NO081", "NOR"],
    });
    expect(t.regions).toEqual(["NO081", "NO"]);
  });

  it("normalizes 'YYYY-MM-DDZ' date strings to full ISO 8601 datetime", () => {
    const t = normalizeTedNotice({
      ...sample,
      "deadline-receipt-tender-date-lot": ["2026-06-01Z"],
    });
    expect(t.deadlineAt).toBe("2026-06-01T00:00:00Z");
  });

  it("normalizes 'YYYY-MM-DD+HH:MM' publication-date to ISO 8601 datetime", () => {
    const t = normalizeTedNotice({
      ...sample,
      "publication-date": "2026-04-30+02:00",
    });
    expect(t.publishedAt).toBe("2026-04-30T00:00:00Z");
  });

  it("preserves time-of-day in full ISO 8601 datetime inputs", () => {
    const t = normalizeTedNotice({
      ...sample,
      "publication-date": "2026-04-30T15:33:48Z",
    });
    expect(t.publishedAt).toBe("2026-04-30T15:33:48Z");
  });

  it("uses description-lot as primary description source", () => {
    const t = normalizeTedNotice({
      ...sample,
      "notice-title": { eng: "Title only" },
      "description-lot": { eng: ["Real lot scope text here"] },
    });
    expect(t.description).toBe("Real lot scope text here");
  });

  it("falls back through description-part, -proc, -glo when -lot is absent", () => {
    const partOnly = normalizeTedNotice({
      ...sample,
      "notice-title": { eng: "Title" },
      "description-part": { eng: ["Part-level scope"] },
    });
    expect(partOnly.description).toBe("Part-level scope");

    const procOnly = normalizeTedNotice({
      ...sample,
      "notice-title": { eng: "Title" },
      "description-proc": { eng: ["Procedure-level scope"] },
    });
    expect(procOnly.description).toBe("Procedure-level scope");

    const gloOnly = normalizeTedNotice({
      ...sample,
      "notice-title": { eng: "Title" },
      "description-glo": { eng: ["Global scope"] },
    });
    expect(gloOnly.description).toBe("Global scope");
  });

  it("falls back to title when no description field is populated", () => {
    const t = normalizeTedNotice({
      ...sample,
      "notice-title": { eng: "Just a title" },
    });
    expect(t.description).toBe("Just a title");
  });

  it("extracts a single winner with org number and value from a CAN notice", () => {
    const t = normalizeTedNotice({
      ...sample,
      "notice-type": "can-standard",
      "winner-name": { eng: ["Acme AS"] },
      "winner-identifier": ["111111111"],
      "winner-decision-date": ["2025-05-09Z"],
      "tender-value": ["6780500"],
      "tender-value-cur": ["NOK"],
      "total-value": 40000000,
      "total-value-cur": ["NOK"],
    });
    expect(t.status).toBe("awarded");
    expect(t.award?.winners).toHaveLength(1);
    expect(t.award?.winners[0]).toEqual({
      name: "Acme AS",
      orgNumber: "111111111",
      value: 6780500,
    });
    expect(t.award?.awardedAt).toBe("2025-05-09T00:00:00Z");
    expect(t.award?.totalValue).toBe(40000000);
    expect(t.award?.currency).toBe("NOK");
  });

  it("extracts multi-lot framework winners with parallel arrays", () => {
    const t = normalizeTedNotice({
      ...sample,
      "notice-type": "can-standard",
      "winner-name": { eng: ["A AS", "B AS", "C AS", "D AS"] },
      "winner-identifier": ["111", "222", "333", "444"],
      "tender-value": ["100", "200", "300", "400"],
      "total-value": 1000,
      "total-value-cur": ["NOK"],
    });
    expect(t.award?.winners).toHaveLength(4);
    expect(t.award?.winners.map((w) => w.name)).toEqual([
      "A AS",
      "B AS",
      "C AS",
      "D AS",
    ]);
    expect(t.award?.winners.map((w) => w.orgNumber)).toEqual([
      "111",
      "222",
      "333",
      "444",
    ]);
    expect(t.award?.winners.map((w) => w.value)).toEqual([100, 200, 300, 400]);
  });

  it("populates total-value alone when winner names are absent", () => {
    const t = normalizeTedNotice({
      ...sample,
      "notice-type": "can-standard",
      "total-value": 70000000,
      "total-value-cur": ["NOK"],
    });
    expect(t.status).toBe("awarded");
    expect(t.award?.winners).toEqual([]);
    expect(t.award?.totalValue).toBe(70000000);
    expect(t.award?.currency).toBe("NOK");
  });

  it("does not set award block on non-awarded notices", () => {
    const t = normalizeTedNotice({
      ...sample,
      "notice-type": "cn-standard",
      "winner-name": { eng: ["Should not appear"] },
    });
    expect(t.status).toBe("open");
    expect(t.award).toBeUndefined();
  });
});
