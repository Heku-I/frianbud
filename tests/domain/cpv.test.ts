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
