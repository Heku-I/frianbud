type Level = "info" | "warn" | "error";

export type Logger = {
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
};

export function createLogger(): Logger {
  function write(level: Level, event: string, fields?: Record<string, unknown>) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...fields,
    });
    process.stderr.write(line + "\n");
  }
  return {
    info: (e, f) => write("info", e, f),
    warn: (e, f) => write("warn", e, f),
    error: (e, f) => write("error", e, f),
  };
}
