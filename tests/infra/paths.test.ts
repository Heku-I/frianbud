import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProfilePath } from "../../src/infra/paths.js";

describe("resolveProfilePath", () => {
  const original = process.env.FRIANBUD_PROFILE_PATH;

  beforeEach(() => {
    delete process.env.FRIANBUD_PROFILE_PATH;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.FRIANBUD_PROFILE_PATH;
    else process.env.FRIANBUD_PROFILE_PATH = original;
  });

  it("returns env var value when set", () => {
    process.env.FRIANBUD_PROFILE_PATH = "/tmp/custom-profile.json";
    expect(resolveProfilePath()).toBe("/tmp/custom-profile.json");
  });

  it("falls back to OS config dir + profile.json when env var unset", () => {
    const result = resolveProfilePath();
    expect(result).toMatch(/profile\.json$/);
    expect(result).toMatch(/frianbud/);
  });
});
