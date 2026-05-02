import { describe, it, expect, vi } from "vitest";
import { createDoffinClient } from "../../src/sources/doffin.js";

function mockOk(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

const sampleHit = {
  id: "2026-107918",
  buyer: [{ id: "x", organizationId: "924599545", name: "Oslo kommune" }],
  heading: "Totalentreprise Bryn skole",
  description: "Bryn skole...",
  locationId: ["NO081"],
  estimatedValue: null,
  type: "ANNOUNCEMENT_OF_COMPETITION",
  status: "ACTIVE",
  issueDate: "2026-05-01T15:33:10Z",
  deadline: "2026-05-28T10:00:00Z",
  publicationDate: "2026-05-01",
};

describe("DoffinClient.search", () => {
  it("calls the discovered XHR endpoint and returns Tenders", async () => {
    const fetch = mockOk({ hits: [sampleHit], numHitsTotal: 1, numHitsAccessible: 1 });
    const client = createDoffinClient({ fetch });
    const results = await client.search({ query: "renhold" });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("doffin:2026-107918");
  });

  it("propagates HttpError on 5xx", async () => {
    const fetch = vi.fn(async () => new Response("err", { status: 503 }));
    const client = createDoffinClient({ fetch });
    await expect(client.search({ query: "x" })).rejects.toThrow();
  });

  it("clamps limit to 1000 (Doffin's accessibility cap)", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinClient({ fetch });
    await client.search({ limit: 5000 });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.size).toBeLessThanOrEqual(1000);
  });

  it("sends Origin header for CORS", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinClient({ fetch });
    await client.search({});
    const callArg = fetch.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(callArg.headers["Origin"]).toBe("https://doffin.no");
  });
});

const sampleDetail = {
  ...sampleHit,
  directCpvCodes: ["45000000", "45200000"],
  parentCpvCodes: [],
  allCpvCodes: ["45000000", "45200000"],
  awardedNames: [],
  noticeStatus: "ACTIVE",
  noticeType: "ANNOUNCEMENT_OF_COMPETITION",
};

describe("DoffinClient.getNotice", () => {
  it("fetches detail by id and includes CPV codes", async () => {
    const fetch = mockOk(sampleDetail);
    const client = createDoffinClient({ fetch });
    const tender = await client.getNotice("2026-107918");
    expect(tender.id).toBe("doffin:2026-107918");
    expect(tender.cpvCodes).toContain("45000000");
  });
});

describe("DoffinClient.healthCheck", () => {
  it("returns ok on 200", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinClient({ fetch });
    expect(await client.healthCheck()).toEqual({ ok: true });
  });

  it("returns failure on non-2xx", async () => {
    const fetch = vi.fn(async () => new Response("nope", { status: 502 }));
    const client = createDoffinClient({ fetch });
    const r = await client.healthCheck();
    expect(r.ok).toBe(false);
  });
});
