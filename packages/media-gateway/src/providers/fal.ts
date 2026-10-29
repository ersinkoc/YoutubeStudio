import type { Capability } from "@ys/core";
import { pollUntil, requestBytes, requestJson } from "../http.ts";
import type {
  GenerateContext,
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
}

interface QueueStatus {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  queue_position?: number;
}

const QUEUE_BASE = "https://queue.fal.run";

/** fal kuyruk API'si (submit → status → response) üzerinden çalışan genel adapter. */
export class FalAdapter implements ProviderAdapter {
  readonly local = false;
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly limits: ProviderLimits;
  readonly qualityPrior: number;
  readonly price: PriceRule;

  constructor(
    private readonly spec: FalModelSpec,
    private readonly apiKey: string,
  ) {
    this.id = spec.id;
    this.capabilities = spec.capabilities;
    this.limits = spec.limits;
    this.qualityPrior = spec.qualityPrior;
    this.price = spec.price;
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

    await pollUntil(
      async () => {
        const s = await requestJson<QueueStatus>(ctx.fetch, submit.status_url, { headers, signal: ctx.signal });
        if (s.status === "IN_QUEUE" && s.queue_position !== undefined) ctx.onProgress?.(`sıra: ${s.queue_position}`);
        return s.status === "COMPLETED" ? true : undefined;
      },
      { signal: ctx.signal },
    );

    const response = await requestJson<Record<string, unknown>>(ctx.fetch, submit.response_url, {
      headers,
      signal: ctx.signal,
    });
    const files = await Promise.all(
      this.spec.outputUrls(response).map((url) => requestBytes(ctx.fetch, url, { signal: ctx.signal })),
    );
    return { files, providerMeta: { requestId: submit.request_id, seed: response.seed } };
  }
}
