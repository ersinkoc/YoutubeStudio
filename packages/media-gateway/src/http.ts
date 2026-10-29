export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 500)}`);
  }
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/** 429 ve 5xx'te üstel bekleme ile yeniden dener. */
export async function request(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit = {},
  retries = 3,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, init);
    if (res.ok) return res;
    const body = await res.text();
    if (attempt < retries && RETRYABLE.has(res.status)) {
      await sleep(1000 * 2 ** attempt, init.signal ?? undefined);
      continue;
    }
    throw new HttpError(res.status, url, body);
  }
}

export async function requestJson<T>(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await request(fetchFn, url, init);
  return (await res.json()) as T;
}

export async function requestBytes(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await request(fetchFn, url, init);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mimeType: res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
  };
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** check() undefined döndükçe bekler; değer dönünce onu döndürür. */
export async function pollUntil<T>(
  check: () => Promise<T | undefined>,
  { intervalMs = 3000, timeoutMs = 20 * 60_000, signal }: PollOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await sleep(intervalMs, signal);
  }
  throw new Error(`Zaman aşımı (${timeoutMs} ms)`);
}

export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

export const fromBase64 = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));

export const toDataUri = (bytes: Uint8Array, mimeType: string): string =>
  `data:${mimeType};base64,${toBase64(bytes)}`;
