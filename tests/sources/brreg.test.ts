import { describe, it, expect, vi } from "vitest";
import { createBrregClient } from "../../src/sources/brreg.js";

const samplePayload = {
  organisasjonsnummer: "917719993",
  navn: "4SERVICE EIR RENHOLD AS",
  organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
  naeringskode1: { kode: "81.210", beskrivelse: "Rengjøring av bygninger" },
  antallAnsatte: 3744,
  konkurs: false,
  underAvvikling: false,
  registreringsdatoEnhetsregisteret: "2016-09-14",
  forretningsadresse: {
    adresse: ["Brynsalléen 4"],
    postnummer: "0667",
    poststed: "OSLO",
    kommune: "OSLO",
    kommunenummer: "0301",
    landkode: "NO",
  },
  hjemmeside: "www.4service.no",
};

describe("BrregClient.lookup", () => {
  it("returns normalized organization for a known org number", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(samplePayload), { status: 200 }),
    );
    const client = createBrregClient({ fetch });
    const org = await client.lookup("917719993");
    expect(org).not.toBeNull();
    expect(org!.name).toBe("4SERVICE EIR RENHOLD AS");
    expect(org!.orgNumber).toBe("917719993");
    expect(org!.industryCode).toBe("81.210");
    expect(org!.employeeCount).toBe(3744);
    expect(org!.active).toBe(true);
    expect(org!.address.municipality).toBe("OSLO");
    expect(org!.address.municipalityCode).toBe("0301");
  });

  it("strips NO...MVA wrapping from the input org number", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(samplePayload), { status: 200 }),
    );
    const client = createBrregClient({ fetch });
    await client.lookup("NO917719993MVA");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/enheter/917719993"),
      expect.anything(),
    );
  });

  it("strips whitespace from the input org number", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(samplePayload), { status: 200 }),
    );
    const client = createBrregClient({ fetch });
    await client.lookup("917 719 993");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/enheter/917719993"),
      expect.anything(),
    );
  });

  it("rejects malformed org numbers without hitting the API", async () => {
    const fetch = vi.fn();
    const client = createBrregClient({ fetch });
    await expect(client.lookup("12345")).rejects.toThrow(
      /9 digits/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null for unknown org numbers (404 on both /enheter and /underenheter)", async () => {
    const fetch = vi.fn(
      async () => new Response("not found", { status: 404 }),
    );
    const client = createBrregClient({ fetch });
    expect(await client.lookup("000000000")).toBeNull();
  });

  it("falls back to /underenheter when /enheter returns 404", async () => {
    let calls = 0;
    const fetch = vi.fn(async (url: string) => {
      calls++;
      if (url.includes("/enheter/") && !url.includes("/underenheter/")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(
        JSON.stringify({ ...samplePayload, navn: "Sub-unit Branch" }),
        { status: 200 },
      );
    });
    const client = createBrregClient({ fetch: fetch as unknown as typeof globalThis.fetch });
    const org = await client.lookup("917719993");
    expect(org?.name).toBe("Sub-unit Branch");
    expect(calls).toBe(2);
  });

  it("flags bankrupt and winding-down organizations", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...samplePayload,
            konkurs: true,
            underAvvikling: true,
          }),
          { status: 200 },
        ),
    );
    const client = createBrregClient({ fetch });
    const org = await client.lookup("917719993");
    expect(org!.bankrupt).toBe(true);
    expect(org!.underWinding).toBe(true);
    expect(org!.active).toBe(false);
  });

  it("caches lookups (second call hits the LRU)", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(samplePayload), { status: 200 }),
    );
    const client = createBrregClient({ fetch });
    await client.lookup("917719993");
    await client.lookup("917719993");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
