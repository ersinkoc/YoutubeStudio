import { LocalizedError, msg, type Capability } from "@ys/core";
import { HttpError, PollTimeoutError, pollUntil, requestBytes, requestJson } from "../http.ts";
import { ContentRejectedError, afterSubmit } from "../types.ts";
import type {
  GenerateContext,
  PriceSource,
  GenerationRequest,
  GenerationResult,
  PriceRule,
  ProviderAdapter,
  ProviderLimits,
} from "../types.ts";

export interface FalModelSpec {
  id: string;
  /** fal model yolu, örn. "fal-ai/flux/dev". */
  endpoint: string;
  capabilities: readonly Capability[];
  limits: ProviderLimits;
  qualityPrior: number;
  price: PriceRule;
  priceSource?: PriceSource;
  /**
   * false: endpoint adı veya girdi alanları fal model sayfasından henüz doğrulanmadı.
   * Bu modeller sadece FAL_ENABLE_UNVERIFIED=1 iken açılır.
   */
  verified: boolean;
  buildInput(req: GenerationRequest): Record<string, unknown>;
  outputUrls(response: Record<string, unknown>): string[];
}

interface QueueSubmit {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url?: string;
}

/**
 * Başarısız iş de COMPLETED'e ulaşır; o zaman `error` (okunur mesaj) ve `error_type` dolu gelir.
 * Kaynak: https://fal.ai/docs/model-apis/model-endpoints/queue (31 Eki 2026).
 */
interface QueueStatus {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  queue_position?: number;
  error?: string;
  error_type?: string;
}

/** fal'ın içerik/güvenlik reddi hata türleri (ör. "content_policy_violation"). */
const CONTENT_ERROR = /content_policy|nsfw|safety/i;

/** Kuyruktan dönen hata gövdesi içerik reddi mi? (ör. 422 {"detail":[{"type":"content_policy_violation"}]}) */
const isContentHttpError = (e: unknown): boolean => e instanceof HttpError && e.status === 422 && CONTENT_ERROR.test(e.body);

const QUEUE_BASE = "https://queue.fal.run";

/** fal kuyruk API'si (submit → status → response) üzerinden çalışan genel adapter. */
export class FalAdapter implements ProviderAdapter {
  readonly local = false;
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly limits: ProviderLimits;
  readonly qualityPrior: number;
  readonly price: PriceRule;
  readonly priceSource?: PriceSource;

  constructor(
    private readonly spec: FalModelSpec,
    private readonly apiKey: string,
  ) {
    this.id = spec.id;
    this.capabilities = spec.capabilities;
    this.limits = spec.limits;
    this.qualityPrior = spec.qualityPrior;
    this.price = spec.price;
    this.priceSource = spec.priceSource;
  }

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const headers = { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json" };
    const input = { ...this.spec.buildInput(req), ...req.params };

    const submit = await requestJson<QueueSubmit>(ctx.fetch, `${QUEUE_BASE}/${this.spec.endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: ctx.signal,
    });
    ctx.onProgress?.(`kuyrukta (${submit.request_id})`);

    // Gönderildi: bundan sonraki hata ücretlendirilmiş bir işin hatasıdır.
    return afterSubmit(submit.request_id, async () => {
      try {
        const done = await pollUntil(
          async () => {
            const s = await requestJson<QueueStatus>(ctx.fetch, submit.status_url, { headers, signal: ctx.signal });
            if (s.status === "IN_QUEUE" && s.queue_position !== undefined) ctx.onProgress?.(`sıra: ${s.queue_position}`);
            return s.status === "COMPLETED" ? s : undefined;
          },
          { signal: ctx.signal },
        );
        // Başarısız iş: sonucu indirmeye çalışmadan nedeni bildir.
        if (done.error !== undefined || done.error_type !== undefined) {
          const reason = msg("gw.fal.failed", {
            type: done.error_type ?? msg("gw.fal.errorType"),
            error: done.error ?? msg("gw.noDetails"),
          });
          if (CONTENT_ERROR.test(done.error_type ?? "")) throw new ContentRejectedError(reason);
          throw new LocalizedError(reason);
        }
      } catch (e) {
        // İptal ya da bekleme süresi doldu: iş fal'da sürmesin (ücretlenmeye devam etmesin). En iyi çaba.
        if (ctx.signal?.aborted || e instanceof PollTimeoutError) await this.cancel(ctx, submit, headers);
        throw e;
      }

      const response = await requestJson<Record<string, unknown>>(ctx.fetch, submit.response_url, {
        headers,
        signal: ctx.signal,
      }).catch((e: unknown) => {
        if (isContentHttpError(e)) throw new ContentRejectedError(msg("gw.fal.contentRejected", { body: (e as HttpError).body.slice(0, 300) }));
        throw e;
      });
      const files = await Promise.all(
        this.spec.outputUrls(response).map((url) => requestBytes(ctx.fetch, url, { signal: ctx.signal })),
      );
      return { files, providerMeta: { requestId: submit.request_id, seed: response.seed } };
    });
  }

  /** Kuyruktaki/süren işi iptal eder (PUT cancel_url). Hata yutulur: asıl hata yukarı çıkmalı. */
  private async cancel(ctx: GenerateContext, submit: QueueSubmit, headers: Record<string, string>): Promise<void> {
    if (!submit.cancel_url) return;
    try {
      // Çağıranın sinyali zaten iptal edilmiş olabilir; iptal isteği kendi kısa süre sınırıyla gider.
      await ctx.fetch(submit.cancel_url, { method: "PUT", headers, signal: AbortSignal.timeout(10_000) });
      ctx.onProgress?.(`iptal istendi (${submit.request_id})`);
    } catch {
      // En iyi çaba: iptal edilemese de iş sonunda zaman aşımına uğrar.
    }
  }
}
