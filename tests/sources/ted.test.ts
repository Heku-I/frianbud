import { describe, it, expect, vi } from "vitest";
import { createTedClient } from "../../src/sources/ted.js";

function fakeFetchOk(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

const sampleNotice = {
  "publication-number": "123-2026",
  "notice-type": "cn-standard",
  "notice-title": { eng: "Cleaning" },
  "classification-cpv": ["90910000"],
  "buyer-name": { eng: ["Oslo K"] },
  "buyer-country": ["NOR"],
  "place-of-performance": ["NOR"],
  "publication-date": "2026-04-01+02:00",
  links: { html: { ENG: "https://ted.europa.eu/en/notice/-/detail/123-2026" } },
};

describe("TedClient.search", () => {
  it("calls TED v3 search endpoint and returns Tenders", async () => {
    const fetch = fakeFetchOk({ notices: [sampleNotice], totalNoticeCount: 1 });
    const client = createTedClient({ fetch });
    const results = await client.search({ country: "NOR", limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("ted:123-2026");
  });

  it("dedupes identical queries via cache", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch, cacheTtlMs: 60_000 });
    await client.search({ country: "NOR", limit: 10 });
    await client.search({ country: "NOR", limit: 10 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not dedupe different queries", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch, cacheTtlMs: 60_000 });
    await client.search({ country: "NOR", limit: 10 });
    await client.search({ country: "NOR", limit: 20 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clamps limit to TED's max of 250 per page", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({ limit: 500 });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.limit).toBeLessThanOrEqual(250);
  });
});

describe("TedClient.getNotice", () => {
  it("fetches notice by publication-number via search-with-id query", async () => {
    const fetch = fakeFetchOk({ notices: [sampleNotice], totalNoticeCount: 1 });
    const client = createTedClient({ fetch });
    const tender = await client.getNotice("123-2026");
    expect(tender.id).toBe("ted:123-2026");
  });

  it("throws when notice not found", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await expect(client.getNotice("nonexistent")).rejects.toThrow(/not found/);
  });
});
