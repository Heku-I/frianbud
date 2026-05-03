import { describe, it, expect } from "vitest";
import { createTedClient } from "../../src/sources/ted.js";
import { TenderSchema } from "../../src/types.js";

describe.skipIf(process.env.FRIANBUD_RUN_LIVE !== "1")("TED live shape", () => {
  it("a basic search returns at least one notice that parses to Tender", async () => {
    const client = createTedClient();
    const tenders = await client.search({ country: "NOR", limit: 5 });
    expect(tenders.length).toBeGreaterThan(0);
    for (const t of tenders) {
      expect(() => TenderSchema.parse(t)).not.toThrow();
    }
  }, 30_000);
});
