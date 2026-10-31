import { LocalizedError, msg } from "@ys/core";

export class HttpError extends LocalizedError {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(msg("gw.http", { status, url, body: body.slice(0, 500) }));
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
// 503 "aşırı yük / hizmet yok": istek işlenmedi, tekrar göndermek güvenli.
const NOT_PROCESSED = new Set([408, 425, 429, 503]);

/** Tek bir isteğin (başlıklar + gövde) varsayılan süre sınırı. Gerçek veride bir fetch 7,6 saat asılı kaldı (31 Eki). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
/** Retry-After başlığına uyulurken beklenecek en uzun süre. */
const MAX_RETRY_AFTER_MS = 60_000;

/** request() seçenekleri: fetch'in RequestInit'i + istek başına süre sınırı. */
export type RequestOptions = RequestInit & { timeoutMs?: number };

/** İstek, süre sınırı içinde tamamlanmadı (çağıranın iptali değil). */
export class RequestTimeoutError extends LocalizedError {
  constructor(
    readonly url: string,
    readonly timeoutMs: number,
  ) {
    super(msg("gw.timeout.request", { ms: timeoutMs, url }));
  }
}

/** Retry-After: saniye ya da HTTP tarihi. Yoksa/bozuksa undefined; değer 0..60 sn'ye sıkıştırılır. */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const sec = Number(header);
  const ms = Number.isFinite(sec) ? sec * 1000 : Date.parse(header) - now;
  if (Number.isNaN(ms)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

/**
 * 429 ve 5xx'te üstel bekleme ile yeniden dener (429/503'te Retry-After varsa ona uyar). Her deneme
 * `timeoutMs` ile sınırlıdır. Ağ hataları (ECONNRESET, DNS, zaman aşımı) yalnız GET/HEAD'de yeniden denenir.
 */
export async function request(
  fetchFn: typeof fetch,
  url: string,
  options: RequestOptions = {},
  retries = 3,
): Promise<Response> {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...init } = options;
  const callerSignal = init.signal ?? undefined;
  // GET dışı istek (iş gönderme, TTS) sunucu hatasında tekrar gönderilmez: ilk istek işlenmiş olabilir ve iki kez
  // ücretlendirilir. Yalnız "işlenmedi" anlamına gelen 408/425/429/503 tekrarlanır.
  const idempotent = !init.method || /^(GET|HEAD)$/i.test(init.method);
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    let res: Response;
    let body: string;
    try {
      res = await fetchFn(url, { ...init, signal });
      if (res.ok) return res;
      body = await res.text();
    } catch (e) {
      // Çağıran iptal ettiyse olduğu gibi yukarı çıkar, tekrar denenmez.
      if (callerSignal?.aborted) throw e;
      const error = timeout.aborted ? new RequestTimeoutError(url, timeoutMs) : e;
      // Ağ hatası: istek sunucuya ulaşmış olabilir; yalnız idempotent istek tekrarlanır.
      if (idempotent && attempt < retries) {
        await sleep(1000 * 2 ** attempt, callerSignal);
        continue;
      }
      throw error;
    }
    if (attempt < retries && (idempotent ? RETRYABLE : NOT_PROCESSED).has(res.status)) {
      const hinted = res.status === 429 || res.status === 503 ? retryAfterMs(res.headers.get("retry-after")) : undefined;
      await sleep(hinted ?? 1000 * 2 ** attempt, callerSignal);
      continue;
    }
    throw new HttpError(res.status, url, body);
  }
}

export async function requestJson<T>(
  fetchFn: typeof fetch,
  url: string,
  init: RequestOptions = {},
): Promise<T> {
  const res = await request(fetchFn, url, init);
  return (await res.json()) as T;
}

export async function requestBytes(
  fetchFn: typeof fetch,
  url: string,
  init: RequestOptions = {},
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
  throw new PollTimeoutError(timeoutMs);
}

/** pollUntil süresi doldu: iş sağlayıcıda hâlâ sürüyor olabilir (iptal edilmeli). */
export class PollTimeoutError extends LocalizedError {
  constructor(readonly timeoutMs: number) {
    super(msg("gw.timeout.poll", { ms: timeoutMs }));
  }
}

export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

export const fromBase64 = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, "base64"));

export const toDataUri = (bytes: Uint8Array, mimeType: string): string =>
  `data:${mimeType};base64,${toBase64(bytes)}`;
