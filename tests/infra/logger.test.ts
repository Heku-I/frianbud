import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../../src/infra/logger.js";

describe("logger", () => {
  let writes: string[];
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    writes = [];
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  it("writes JSON line to stderr with level and event", () => {
    const log = createLogger();
    log.info("startup", { version: "0.1.0" });

    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!.trim());
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("startup");
    expect(parsed.version).toBe("0.1.0");
    expect(typeof parsed.ts).toBe("string");
  });

  it("supports warn and error levels", () => {
    const log = createLogger();
    log.warn("doffin_disabled", { reason: "5xx" });
    log.error("crash", { message: "boom" });

    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[0]!).level).toBe("warn");
    expect(JSON.parse(writes[1]!).level).toBe("error");
  });

  it("never writes to stdout", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    const log = createLogger();
    log.info("test");
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});
