import { describe, it, expect } from "vitest";
import { setupProfileTool } from "../../src/tools/setup-profile.js";
import { createProfileService } from "../../src/domain/profile.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function ctx() {
  const dir = mkdtempSync(join(tmpdir(), "frianbud-tool-"));
  const path = join(dir, "profile.json");
  return {
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    ctx: {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      profile: createProfileService(path, {
        suggestCpvCodes: (text) => (text.includes("clean") ? ["90910000-9"] : []),
      }),
    } as unknown as Parameters<typeof setupProfileTool.handler>[1],
  };
}

describe("setup_profile tool", () => {
  it("returns missing fields for empty draft", async () => {
    const { ctx: c, cleanup } = ctx();
    try {
      const result = (await setupProfileTool.handler({ partial: {} }, c)) as {
        saved: boolean;
        missing: string[];
      };
      expect(result.saved).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("returns suggestedCpvs when whatWeDo is set without cpvCodes", async () => {
    const { ctx: c, cleanup } = ctx();
    try {
      const result = (await setupProfileTool.handler(
        { partial: { whatWeDo: "office cleaning" } },
        c
      )) as { saved: boolean; suggestedCpvs?: string[] };
      expect(result.suggestedCpvs).toEqual(["90910000-9"]);
    } finally {
      cleanup();
    }
  });

  it("persists complete profile and returns saved=true", async () => {
    const { ctx: c, cleanup } = ctx();
    try {
      const result = (await setupProfileTool.handler(
        {
          partial: {
            companyName: "X",
            whatWeDo: "Y",
            regions: ["NO081"],
            valueRange: { min: 0, max: 1, currency: "NOK" },
            languages: ["no"],
            cpvCodes: ["90910000-9"],
            minLeadTimeDays: 0,
          },
        },
        c
      )) as { saved: boolean };
      expect(result.saved).toBe(true);
    } finally {
      cleanup();
    }
  });
});
