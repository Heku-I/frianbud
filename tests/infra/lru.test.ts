import { describe, it, expect } from "vitest";
import { createLru } from "../../src/infra/lru.js";

describe("createLru", () => {
  it("get returns undefined for missing key", () => {
    const c = createLru<string, number>({ max: 3, ttlMs: 1000 });
    expect(c.get("a")).toBeUndefined();
  });

  it("set then get returns the value", () => {
    const c = createLru<string, number>({ max: 3, ttlMs: 1000 });
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
  });

  it("evicts the least-recently-used when at capacity", () => {
    const c = createLru<string, number>({ max: 2, ttlMs: 1000 });
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a is now MRU
    c.set("c", 3); // evicts b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });

  it("expires entries after ttl", () => {
    let now = 0;
    const c = createLru<string, number>({ max: 3, ttlMs: 100, now: () => now });
    now = 0;
    c.set("a", 1);
    now = 50;
    expect(c.get("a")).toBe(1);
    now = 200;
    expect(c.get("a")).toBeUndefined();
  });
});
