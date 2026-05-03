import { describe, it, expect, vi } from "vitest";
import { createDoffinPublicClient } from "../../src/sources/doffin-public.js";

const sampleHit = {
  id: "2026-104376",
  buyer: [
    {
      id: "297dd5d932e5ea9b601b7794d9ecd5ad",
      organizationId: "874789542",
      name: "UNIVERSITETET I BERGEN",
    },
  ],
  heading: "Rammeavtale for gulvbehandling",
  description: "UiB ønsker å inngå en rammeavtale for gulvbehandling.",
  locationId: ["NO0A2"],
  estimatedValue: { currencyCode: "NOK", amount: 8_000_000 },
  type: "ANNOUNCEMENT_OF_COMPETITION",
  allTypes: ["ANNOUNCEMENT_OF_COMPETITION", "COMPETITION"],
  status: "AWARDED",
  issueDate: "2026-03-04T07:51:08Z",
  deadline: "2026-04-10T10:00:58Z",
  publicationDate: "2026-03-05",
  cpvCodes: ["50800000", "90900000", "90910000"],
  lots: [
    {
      heading: "Rammeavtale for gulvbehandling",
      description: "...",
      winner: [
        { id: "x1", organizationId: "917719993", name: "4SERVICE EIR RENHOLD AS" },
        { id: "x2", organizationId: "984684037", name: "TOMA FACILITY NORGE AS" },
      ],
    },
  ],
};

function mockOk(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

describe("createDoffinPublicClient", () => {
  it("requires an API key", () => {
    expect(() => createDoffinPublicClient({ apiKey: "" })).toThrow(
      /apiKey/,
    );
  });

  it("sends Ocp-Apim-Subscription-Key on every request", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinPublicClient({ fetch, apiKey: "test-key-123" });
    await client.search({});
    const callArg = fetch.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(callArg.headers["Ocp-Apim-Subscription-Key"]).toBe("test-key-123");
  });

  it("forwards CPV codes as repeated cpvCode query params (8-digit, no check)", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinPublicClient({ fetch, apiKey: "k" });
    await client.search({ cpvCodes: ["90910000-9", "90911000-6"] });
    const url = fetch.mock.calls[0]![0] as string;
    expect(url).toContain("cpvCode=90910000");
    expect(url).toContain("cpvCode=90911000");
    expect(url).not.toContain("90910000-9");
  });

  it("uses type=RESULT (not status=AWARDED) for award queries", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinPublicClient({ fetch, apiKey: "k" });
    await client.search({ status: "awarded" });
    const url = fetch.mock.calls[0]![0] as string;
    // Doffin's status and type filters are mutually exclusive — combining
    // them returns zero. Type filters give us notices with structured
    // lots[].winner[] populated; status=AWARDED alone gives notices that
    // reached the awarded state but no winner data.
    expect(url).toContain("type=ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT");
    expect(url).toContain("type=RESULT");
    expect(url).not.toContain("status=AWARDED");
  });

  it("uses status=ACTIVE for open-tender queries", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinPublicClient({ fetch, apiKey: "k" });
    await client.search({ status: "open" });
    const url = fetch.mock.calls[0]![0] as string;
    expect(url).toContain("status=ACTIVE");
    expect(url).not.toContain("type=RESULT");
  });

  it("forwards regions as repeated location query params", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinPublicClient({ fetch, apiKey: "k" });
    await client.search({ regions: ["NO081", "NO082"] });
    const url = fetch.mock.calls[0]![0] as string;
    expect(url).toContain("location=NO081");
    expect(url).toContain("location=NO082");
  });

  it("normalizes a search hit with full lot-level winners", async () => {
    const fetch = mockOk({
      hits: [sampleHit],
      numHitsTotal: 1,
      numHitsAccessible: 1,
    });
    const client = createDoffinPublicClient({ fetch, apiKey: "k" });
    const tenders = await client.search({ status: "awarded" });
    expect(tenders).toHaveLength(1);
    const t = tenders[0]!;
    expect(t.id).toBe("doffin:2026-104376");
    expect(t.cpvCodes).toContain("90910000");
    expect(t.regions).toEqual(["NO0A2"]);
    expect(t.status).toBe("awarded");
    expect(t.award?.winners).toHaveLength(2);
    expect(t.award?.winners[0]).toEqual({
      name: "4SERVICE EIR RENHOLD AS",
      orgNumber: "917719993",
    });
    expect(t.award?.winners[1]).toEqual({
      name: "TOMA FACILITY NORGE AS",
      orgNumber: "984684037",
    });
    expect(t.award?.totalValue).toBe(8_000_000);
    expect(t.award?.currency).toBe("NOK");
  });

  it("clamps numHitsPerPage to 100 (official API max)", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinPublicClient({ fetch, apiKey: "k" });
    await client.search({ limit: 500 });
    const url = fetch.mock.calls[0]![0] as string;
    expect(url).toContain("numHitsPerPage=100");
  });

  it("healthCheck returns ok on 200", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinPublicClient({ fetch, apiKey: "k" });
    expect(await client.healthCheck()).toEqual({ ok: true });
  });

  it("healthCheck returns failure on 401 (bad key)", async () => {
    const fetch = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    );
    const client = createDoffinPublicClient({ fetch, apiKey: "bad" });
    const result = await client.healthCheck();
    expect(result.ok).toBe(false);
  });
});
