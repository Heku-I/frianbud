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

  it("maps 2-letter country code to TED's 3-letter form", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({ country: "NO" });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.query).toContain("place-of-performance=NOR");
    expect(sentBody.query).not.toContain("place-of-performance=NO ");
    expect(sentBody.query).not.toMatch(/place-of-performance=NO$/);
  });

  it("passes through 3-letter country codes unchanged", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({ country: "DNK" });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.query).toContain("place-of-performance=DNK");
  });

  it("defaults scope to LATEST so callers see current notices", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({});
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.scope).toBe("LATEST");
  });

  it("respects an explicit scope override", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({ scope: "ALL" });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.scope).toBe("ALL");
  });

  it("converts ISO 8601 dates to TED's YYYYMMDD format", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({
      publishedSince: "2026-04-01",
      deadlineBefore: "2026-06-30",
    });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.query).toContain("publication-date>=20260401");
    expect(sentBody.query).toContain("deadline-receipt-tender-date-lot<=20260630");
  });

  it("passes through TED-native today(N) date format", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({ publishedSince: "today(-30)" });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.query).toContain("publication-date>=today(-30)");
  });

  it("CPV filter: single code uses equality (TED rejects IN on classification-cpv)", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({ cpvCodes: ["90910000-9"] });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    // Strips check digit, no IN operator
    expect(sentBody.query).toContain("classification-cpv=90910000");
    expect(sentBody.query).not.toContain("90910000-9");
    expect(sentBody.query).not.toContain(" IN ");
  });

  it("CPV filter: multiple codes use OR expansion", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({ cpvCodes: ["90910000-9", "90911000-6"] });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.query).toContain("classification-cpv=90910000");
    expect(sentBody.query).toContain("classification-cpv=90911000");
    expect(sentBody.query).toContain(" OR ");
  });

  it("status=awarded adds notice-type filter and forces scope ALL", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({ status: "awarded" });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.query).toContain("notice-type=can-standard");
    expect(sentBody.scope).toBe("ALL");
  });

  it("status=open keeps default LATEST scope and adds no notice-type filter", async () => {
    const fetch = fakeFetchOk({ notices: [], totalNoticeCount: 0 });
    const client = createTedClient({ fetch });
    await client.search({ status: "open" });
    const callArg = fetch.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArg.body);
    expect(sentBody.scope).toBe("LATEST");
    expect(sentBody.query).not.toContain("notice-type=");
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
