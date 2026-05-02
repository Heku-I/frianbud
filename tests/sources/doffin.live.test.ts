import { describe, it, expect } from "vitest";
import { createDoffinClient } from "../../src/sources/doffin.js";

describe.skipIf(process.env.FRIANBUD_RUN_LIVE !== "1")("Doffin live", () => {
  it("returns at least one result for a basic search", async () => {
    const client = createDoffinClient();
    const results = await client.search({ query: "renhold", limit: 5 });
    expect(results.length).toBeGreaterThan(0);
  });
});
