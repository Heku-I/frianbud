import { describe, it, expect } from "vitest";
import { getProfileTool } from "../../src/tools/get-profile.js";
import { createProfileService } from "../../src/domain/profile.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("get_profile tool", () => {
  it("returns { exists: false } when no profile saved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fb-"));
    try {
      const ctx = {
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        profile: createProfileService(join(dir, "p.json")),
      } as Parameters<typeof getProfileTool.handler>[1];
      const result = await getProfileTool.handler({}, ctx);
      expect(result).toEqual({ exists: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the saved profile when one exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fb-"));
    try {
      const path = join(dir, "p.json");
      const svc = createProfileService(path);
      await svc.save({
        schemaVersion: 1,
        companyName: "X",
        whatWeDo: "Y",
        regions: ["NO081"],
        valueRange: { min: 0, max: 1, currency: "NOK" },
        languages: ["no"],
        cpvCodes: ["90910000-9"],
        certifications: [],
        exclusions: { keywords: [], cpvCodes: [] },
        preferredBuyers: [],
        minLeadTimeDays: 0,
      });
      const ctx = {
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        profile: svc,
      } as Parameters<typeof getProfileTool.handler>[1];
      const result = (await getProfileTool.handler({}, ctx)) as { exists: boolean };
      expect(result.exists).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
