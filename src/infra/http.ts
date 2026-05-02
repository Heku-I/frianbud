export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

type Options = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function httpJson<T = unknown>(
  url: string,
  opts: Options = {},
): Promise<T> {
  const f = opts.fetch ?? fetch;
  const retries = opts.retries ?? 0;
  const retryDelayMs = opts.retryDelayMs ?? 250;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
    try {
      const init: RequestInit = {
        method: opts.method ?? "GET",
        headers: { accept: "application/json", ...(opts.headers ?? {}) },
        signal: ctrl.signal,
      };
      if (opts.body !== undefined) {
        init.body = JSON.stringify(opts.body);
      }
      const res = await f(url, init);
      if (res.status >= 200 && res.status < 300) {
        return (await res.json()) as T;
      }
      if (res.status >= 500 && attempt < retries) {
        lastErr = new HttpError(res.status, `${res.status} ${res.statusText}`);
        await delay(retryDelayMs * (attempt + 1));
        continue;
      }
      throw new HttpError(res.status, `${res.status} ${res.statusText}`);
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) throw err;
      if (attempt >= retries) throw err;
      lastErr = err;
      await delay(retryDelayMs * (attempt + 1));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("unreachable");
}
