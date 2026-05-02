import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCpvService, type CpvEntry } from "../../src/domain/cpv.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/cpv-mini.json"), "utf8"),
) as CpvEntry[];

describe("CpvService.lookup", () => {
  const cpv = createCpvService(fixture);

  it("returns the entry for a known code", () => {
    const entry = cpv.lookup("72000000-5");
    expect(entry?.label_en).toBe("IT services");
    expect(entry?.label_no).toBe("IT-tjenester");
  });

  it("returns undefined for unknown code", () => {
    expect(cpv.lookup("99999999-9")).toBeUndefined();
  });
});

describe("CpvService.search", () => {
  const cpv = createCpvService(fixture);

  it("finds codes by English label substring", () => {
    const results = cpv.search("cleaning");
    expect(results.map((r) => r.code)).toContain("90910000-9");
  });

  it("finds codes by Norwegian label substring", () => {
    const results = cpv.search("rengjøring");
    expect(results.map((r) => r.code)).toContain("90910000-9");
  });

  it("is case-insensitive", () => {
    expect(cpv.search("IT").length).toBeGreaterThan(0);
    expect(cpv.search("it").length).toBeGreaterThan(0);
  });

  it("ranks more-specific matches above less-specific", () => {
    const results = cpv.search("software programming");
    expect(results[0]?.code).toBe("72200000-7");
  });

  it("respects limit", () => {
    expect(cpv.search("services", 2)).toHaveLength(2);
  });

  it("returns empty array for no matches", () => {
    expect(cpv.search("xyz_does_not_exist")).toEqual([]);
  });
});

describe("CpvService.expand", () => {
  const cpv = createCpvService(fixture);

  it("returns ancestors of a leaf code", () => {
    const { ancestors } = cpv.expand("45110000-1");
    expect(ancestors.map((a) => a.code)).toEqual(["45100000-8", "45000000-7"]);
  });

  it("returns descendants of a parent code", () => {
    const { descendants } = cpv.expand("45000000-7");
    expect(descendants.map((d) => d.code).sort()).toEqual([
      "45100000-8",
      "45110000-1",
    ]);
  });

  it("returns empty arrays for unknown code", () => {
    const { ancestors, descendants } = cpv.expand("99999999-9");
    expect(ancestors).toEqual([]);
    expect(descendants).toEqual([]);
  });
});

describe("loadBundledCpv", () => {
  it("loads the real bundled JSON and returns >1000 entries", async () => {
    const { loadBundledCpv } = await import("../../src/domain/cpv.js");
    const cpv = await loadBundledCpv();
    expect(cpv.all().length).toBeGreaterThan(1000);
  });

  it("includes Norwegian labels for common codes", async () => {
    const { loadBundledCpv } = await import("../../src/domain/cpv.js");
    const cpv = await loadBundledCpv();
    expect(cpv.lookup("90910000-9")?.label_no).toBeDefined();
    expect(cpv.lookup("72000000-5")?.label_no).toBeDefined();
  });
});
