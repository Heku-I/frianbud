import { describe, it, expect, vi } from "vitest";
import { httpJson, HttpError } from "../../src/infra/http.js";

function mockFetch(impls: Array<() => Promise<Response>>) {
  let i = 0;
  return vi.fn(async () => impls[i++]!());
}

describe("httpJson", () => {
  it("returns parsed JSON on 200", async () => {
    const fetch = mockFetch([
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ]);
    const result = await httpJson("https://example.com", { fetch });
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx and succeeds on second attempt", async () => {
    const fetch = mockFetch([
      async () => new Response("err", { status: 503 }),
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ]);
    const result = await httpJson("https://example.com", { fetch, retries: 2, retryDelayMs: 1 });
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws HttpError after exhausting retries on 5xx", async () => {
    const fetch = mockFetch([
      async () => new Response("err", { status: 503 }),
      async () => new Response("err", { status: 503 }),
      async () => new Response("err", { status: 503 }),
    ]);
    await expect(
      httpJson("https://example.com", { fetch, retries: 2, retryDelayMs: 1 })
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("does not retry on 4xx", async () => {
    const fetch = mockFetch([
      async () => new Response("nope", { status: 404 }),
    ]);
    await expect(
      httpJson("https://example.com", { fetch, retries: 3 })
    ).rejects.toBeInstanceOf(HttpError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("auto-sets Content-Type when sending a JSON body", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await httpJson("https://example.com", {
      method: "POST",
      body: { hello: "world" },
      fetch,
    });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    const ct = Object.entries(headers).find(
      ([k]) => k.toLowerCase() === "content-type",
    );
    expect(ct).toBeDefined();
    expect(ct![1]).toBe("application/json");
  });

  it("does not override caller-supplied Content-Type", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await httpJson("https://example.com", {
      method: "POST",
      body: { x: 1 },
      headers: { "Content-Type": "application/x-ndjson" },
      fetch,
    });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    const ct = Object.entries(headers).find(
      ([k]) => k.toLowerCase() === "content-type",
    );
    expect(ct![1]).toBe("application/x-ndjson");
  });

  it("does not set Content-Type on GET requests with no body", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await httpJson("https://example.com", { fetch });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    const ct = Object.entries(headers).find(
      ([k]) => k.toLowerCase() === "content-type",
    );
    expect(ct).toBeUndefined();
  });
});
