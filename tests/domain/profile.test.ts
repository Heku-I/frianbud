import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProfileService } from "../../src/domain/profile.js";
import type { Profile } from "../../src/types.js";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
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
    ...overrides,
  };
}

describe("ProfileService load/save", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "frianbud-test-"));
    path = join(dir, "profile.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("load returns null when file does not exist", async () => {
    const svc = createProfileService(path);
    expect(await svc.load()).toBeNull();
  });

  it("save then load round-trips", async () => {
    const svc = createProfileService(path);
    const profile = makeProfile();
    await svc.save(profile);
    expect(existsSync(path)).toBe(true);
    const loaded = await svc.load();
    expect(loaded).toEqual(profile);
  });

  it("load throws structured error on corrupted file", async () => {
    writeFileSync(path, "{ this is not valid json", "utf8");
    const svc = createProfileService(path);
    await expect(svc.load()).rejects.toThrow(/profile file is corrupted/i);
  });

  it("load throws structured error on schema mismatch", async () => {
    writeFileSync(path, JSON.stringify({ schemaVersion: 999 }), "utf8");
    const svc = createProfileService(path);
    await expect(svc.load()).rejects.toThrow(/schema/i);
  });
});

describe("ProfileService.advanceDraft (incomplete)", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "frianbud-test-"));
    path = join(dir, "profile.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("empty draft reports all required fields missing", async () => {
    const svc = createProfileService(path);
    const result = await svc.advanceDraft({});
    expect(result.saved).toBe(false);
    if (!result.saved) {
      expect(result.missing).toEqual(
        expect.arrayContaining([
          "companyName",
          "whatWeDo",
          "regions",
          "valueRange",
          "languages",
          "cpvCodes",
          "minLeadTimeDays",
        ]),
      );
    }
  });

  it("partial draft reports only the still-missing fields", async () => {
    const svc = createProfileService(path);
    const result = await svc.advanceDraft({
      companyName: "X",
      whatWeDo: "Y",
      regions: ["NO081"],
    });
    expect(result.saved).toBe(false);
    if (!result.saved) {
      expect(result.missing).not.toContain("companyName");
      expect(result.missing).not.toContain("whatWeDo");
      expect(result.missing).not.toContain("regions");
      expect(result.missing).toContain("valueRange");
    }
  });

  it("does not write file when draft is incomplete", async () => {
    const svc = createProfileService(path);
    await svc.advanceDraft({ companyName: "X" });
    expect(existsSync(path)).toBe(false);
  });

  it("returns suggested CPVs when whatWeDo is set and cpvCodes is not", async () => {
    const svc = createProfileService(path, {
      suggestCpvCodes: (text) =>
        text.includes("clean") ? ["90910000-9"] : [],
    });
    const result = await svc.advanceDraft({ whatWeDo: "We do cleaning." });
    expect(result.saved).toBe(false);
    if (!result.saved) {
      expect(result.suggestedCpvs).toEqual(["90910000-9"]);
    }
  });

  it("does not call suggester when cpvCodes already set", async () => {
    let called = false;
    const svc = createProfileService(path, {
      suggestCpvCodes: () => {
        called = true;
        return ["x"];
      },
    });
    await svc.advanceDraft({ whatWeDo: "anything", cpvCodes: ["72000000-5"] });
    expect(called).toBe(false);
  });
});
