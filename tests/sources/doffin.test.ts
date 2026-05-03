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
    const results = await client.search({ query: "renhold", enrichCpvs: false });
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
    await client.search({ limit: 5000, enrichCpvs: false });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.size).toBeLessThanOrEqual(1000);
  });

  it("sends Origin header for CORS", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinClient({ fetch });
    await client.search({ enrichCpvs: false });
    const callArg = fetch.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(callArg.headers["Origin"]).toBe("https://doffin.no");
  });
});

describe("DoffinClient.search CPV enrichment", () => {
  function routedFetch(searchHits: unknown[], detailById: Record<string, unknown>) {
    return vi.fn(async (url: string) => {
      if (url.includes("/search-api/search")) {
        return new Response(
          JSON.stringify({ hits: searchHits, numHitsTotal: searchHits.length, numHitsAccessible: searchHits.length }),
          { status: 200 },
        );
      }
      const idMatch = url.match(/notices\/([^/?]+)$/);
      const id = idMatch ? decodeURIComponent(idMatch[1]!) : "";
      const detail = detailById[id];
      if (!detail) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(detail), { status: 200 });
    });
  }

  it("enriches search hits with CPVs from detail by default", async () => {
    const fetch = routedFetch(
      [sampleHit],
      {
        "2026-107918": {
          ...sampleHit,
          directCpvCodes: ["45000000", "45200000"],
        },
      },
    );
    const client = createDoffinClient({ fetch });
    const results = await client.search({ query: "x" });
    expect(results[0]?.cpvCodes).toEqual(["45000000", "45200000"]);
  });

  it("skips enrichment when enrichCpvs is false", async () => {
    const fetch = routedFetch([sampleHit], {});
    const client = createDoffinClient({ fetch });
    const results = await client.search({ query: "x", enrichCpvs: false });
    expect(results[0]?.cpvCodes).toEqual([]);
    // search call only — no detail fetch
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to no CPVs when detail fetch fails", async () => {
    const fetch = routedFetch([sampleHit], {}); // no detail registered → 404
    const client = createDoffinClient({ fetch });
    const results = await client.search({ query: "x" });
    expect(results[0]?.cpvCodes).toEqual([]);
  });

  it("hits the detail cache on repeated lookups", async () => {
    const fetch = routedFetch(
      [sampleHit],
      {
        "2026-107918": { ...sampleHit, directCpvCodes: ["45000000"] },
      },
    );
    const client = createDoffinClient({ fetch });
    await client.search({ query: "x" }); // 1 search + 1 detail
    await client.search({ query: "x" }); // 1 search + cache hit
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("DoffinClient.search query forwarding and post-filtering", () => {
  it("forwards query to body as searchString", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinClient({ fetch });
    await client.search({ query: "renhold", enrichCpvs: false });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.searchString).toBe("renhold");
  });

  it("does not include searchString when query is empty", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinClient({ fetch });
    await client.search({ enrichCpvs: false });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect("searchString" in sentBody).toBe(false);
  });

  it("post-filters hits by cpvCodes (prefix-match, ignores check digit)", async () => {
    const cleaningHit = {
      ...sampleHit,
      id: "doffin-cleaning",
    };
    const constructionHit = {
      ...sampleHit,
      id: "doffin-construction",
    };
    function fetch(url: string) {
      if (typeof url === "string" && url.includes("/search-api/search")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ hits: [cleaningHit, constructionHit], numHitsTotal: 2, numHitsAccessible: 2 }),
            { status: 200 },
          ),
        );
      }
      const id = decodeURIComponent(url.split("/").pop() ?? "");
      const cpvs = id === "doffin-cleaning" ? ["90910000"] : ["45000000"];
      return Promise.resolve(
        new Response(
          JSON.stringify({ ...sampleHit, id, directCpvCodes: cpvs }),
          { status: 200 },
        ),
      );
    }
    const client = createDoffinClient({ fetch: fetch as unknown as typeof globalThis.fetch });
    const results = await client.search({ cpvCodes: ["90910000-9"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("doffin:doffin-cleaning");
  });

  it("biases searchString to 'tildelt' when status=awarded and no query", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinClient({ fetch });
    await client.search({ status: "awarded", enrichCpvs: false });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.searchString).toBe("tildelt");
    expect(sentBody.size).toBeGreaterThanOrEqual(200);
  });

  it("respects explicit query over the awarded hint", async () => {
    const fetch = mockOk({ hits: [], numHitsTotal: 0, numHitsAccessible: 0 });
    const client = createDoffinClient({ fetch });
    await client.search({ status: "awarded", query: "renhold", enrichCpvs: false });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.searchString).toBe("renhold");
  });

  it("post-filters hits by regions", async () => {
    const oslo = { ...sampleHit, id: "oslo-tender" };
    const bergen = { ...sampleHit, id: "bergen-tender", locationId: ["NO0A1"] };
    function fetch() {
      return Promise.resolve(
        new Response(
          JSON.stringify({ hits: [oslo, bergen], numHitsTotal: 2, numHitsAccessible: 2 }),
          { status: 200 },
        ),
      );
    }
    const client = createDoffinClient({ fetch: fetch as unknown as typeof globalThis.fetch });
    const results = await client.search({ regions: ["NO081"], enrichCpvs: false });
    expect(results).toHaveLength(1);
    expect(results[0]?.regions).toContain("NO081");
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
