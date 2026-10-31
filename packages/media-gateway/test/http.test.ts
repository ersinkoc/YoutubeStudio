import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HttpError,
  afterSubmit,
  ContentRejectedError,
  fromBase64,
  pollUntil,
  request,
  requestBytes,
  requestJson,
  sleep,
  SubmittedJobError,
  toBase64,
  toDataUri,
} from "../src/index.ts";

/** Sırayla verilen yanıtları döndüren sahte fetch; her çağrıyı kaydeder. */
function seqFetch(responses: (() => Response)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("beklenmeyen istek");
    return next();
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const status = (code: number, body = `hata ${code}`) => () => new Response(body, { status: code });
const ok = (body = "{}") => () => new Response(body, { status: 200 });

describe("sleep", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("süre dolunca çözülür", async () => {
    let done = false;
    const p = sleep(500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it("zaten iptal edilmiş sinyalde hemen reddeder", async () => {
    const ac = new AbortController();
    ac.abort(new Error("iptal"));
    await expect(sleep(1000, ac.signal)).rejects.toThrow("iptal");
  });

  it("beklerken iptal edilince zamanlayıcıyı temizleyip reddeder", async () => {
    const ac = new AbortController();
    const p = sleep(10_000, ac.signal);
    ac.abort(new Error("vazgeçildi"));
    await expect(p).rejects.toThrow("vazgeçildi");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("request", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("GET isteğini 500'de üstel beklemeyle yeniden dener", async () => {
    const { fetch, calls } = seqFetch([status(500), status(502), ok("tamam")]);
    const p = request(fetch, "https://x/a");
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    // İkinci bekleme 2000 ms.
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await (await p).text()).toBe("tamam");
    expect(calls).toHaveLength(3);
  });

  it("POST isteğini 500'de tekrar göndermez (çift ücret riski)", async () => {
    const { fetch, calls } = seqFetch([status(500, "sunucu")]);
    const err = await request(fetch, "https://x/job", { method: "POST" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 500, url: "https://x/job", body: "sunucu" });
    expect((err as Error).message).toBe("HTTP 500 https://x/job: sunucu");
    expect(calls).toHaveLength(1);
  });

  it("POST isteğini işlenmedi anlamına gelen 429'da yeniden dener", async () => {
    const { fetch, calls } = seqFetch([status(429), ok()]);
    const p = request(fetch, "https://x/job", { method: "post" });
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(200);
    expect(calls.map((c) => c.init?.method)).toEqual(["post", "post"]);
  });

  it("HEAD idempotent sayılır; yeniden deneme hakkı bitince HttpError verir", async () => {
    const { fetch, calls } = seqFetch([status(503), status(503), status(503)]);
    const p = request(fetch, "https://x/h", { method: "HEAD" }, 2).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await p).toMatchObject({ status: 503 });
    expect(calls).toHaveLength(3);
  });

  it("yeniden denenmeyen durumda (404) hemen hata verir; gövde mesajda 500 karakterle kırpılır", async () => {
    const long = "x".repeat(800);
    const { fetch } = seqFetch([status(404, long)]);
    const err = (await request(fetch, "https://x/yok").catch((e: unknown) => e)) as HttpError;
    expect(err.status).toBe(404);
    expect(err.body).toHaveLength(800);
    expect(err.message).toBe(`HTTP 404 https://x/yok: ${"x".repeat(500)}`);
  });

  it("beklerken istek sinyali iptal edilirse yeniden denemez", async () => {
    const ac = new AbortController();
    const { fetch, calls } = seqFetch([status(429), ok()]);
    const p = request(fetch, "https://x/a", { signal: ac.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    ac.abort(new Error("iptal"));
    expect(await p).toMatchObject({ message: "iptal" });
    expect(calls).toHaveLength(1);
  });
});

describe("requestJson / requestBytes", () => {
  it("JSON gövdesini çözer ve init'i fetch'e iletir", async () => {
    const { fetch, calls } = seqFetch([ok('{"a":1}')]);
    expect(await requestJson<{ a: number }>(fetch, "https://x/j", { headers: { k: "v" } })).toEqual({ a: 1 });
    expect(calls[0]?.init).toEqual({ headers: { k: "v" } });
  });

  it("baytları ve parametresiz içerik türünü döndürür", async () => {
    const { fetch } = seqFetch([
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav; rate=24000" } }),
    ]);
    expect(await requestBytes(fetch, "https://x/b")).toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" });
  });

  it("içerik türü yoksa application/octet-stream kabul eder", async () => {
    const { fetch } = seqFetch([
      () => {
        const res = new Response(new Uint8Array([7]));
        res.headers.delete("content-type");
        return res;
      },
    ]);
    expect((await requestBytes(fetch, "https://x/b")).mimeType).toBe("application/octet-stream");
  });
});

describe("pollUntil", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("değer dönene kadar aralıkla sorar", async () => {
    let n = 0;
    const p = pollUntil(async () => (++n === 3 ? "bitti" : undefined), { intervalMs: 100 });
    await vi.runAllTimersAsync();
    expect(await p).toBe("bitti");
    expect(n).toBe(3);
  });

  it("varsayılan ayarlarla ilk denemede dönen değeri hemen verir", async () => {
    expect(await pollUntil(async () => 0)).toBe(0);
  });

  it("süre dolunca zaman aşımı hatası verir", async () => {
    let n = 0;
    const p = pollUntil(
      async () => {
        n++;
        return undefined;
      },
      { intervalMs: 10, timeoutMs: 35 },
    ).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await p).toMatchObject({ message: "Zaman aşımı (35 ms)" });
    expect(n).toBe(4);
  });
});

describe("base64 yardımcıları", () => {
  it("gidiş-dönüş ve data URI", () => {
    const bytes = new Uint8Array([0, 255, 16]);
    expect(toBase64(bytes)).toBe("AP8Q");
    expect(fromBase64("AP8Q")).toEqual(bytes);
    expect(toDataUri(bytes, "image/png")).toBe("data:image/png;base64,AP8Q");
  });
});

describe("afterSubmit", () => {
  it("başarılı sonucu olduğu gibi döndürür", async () => {
    expect(await afterSubmit("j1", async () => 5)).toBe(5);
  });

  it("içerik reddini ve SubmittedJobError'ı sarmadan geçirir", async () => {
    const rej = new ContentRejectedError("filtre");
    await expect(afterSubmit("j1", async () => Promise.reject(rej))).rejects.toBe(rej);
    const sub = new SubmittedJobError("zaten", "j0");
    await expect(afterSubmit("j1", async () => Promise.reject(sub))).rejects.toBe(sub);
  });

  it("diğer hataları iş kimliğiyle SubmittedJobError'a çevirir", async () => {
    const err = await afterSubmit("j9", async () => Promise.reject(new Error("indirme"))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SubmittedJobError);
    expect(err).toMatchObject({ jobId: "j9", message: "gönderilmiş iş başarısız (j9): indirme" });
    const err2 = await afterSubmit(undefined, async () => Promise.reject("düz")).catch((e: unknown) => e);
    expect(err2).toMatchObject({ jobId: undefined, message: "gönderilmiş iş başarısız (?): düz" });
  });
});
