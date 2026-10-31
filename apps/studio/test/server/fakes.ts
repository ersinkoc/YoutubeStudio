import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { ProviderAdapter, Quota } from "@ys/media-gateway";

/**
 * Stüdyo sunucu testlerinin ortak sahteleri. Gerçek süreç açılmaz, ağa çıkılmaz, kullanıcının .data/ klasörüne
 * dokunulmaz: her test dosyası kendi geçici kökünü (YS_ROOT) kurar.
 */

/** Geçici Stüdyo kökü: depo .data/assets altında, defter .data/ledger.jsonl. */
export function tempRoot(prefix = "ys-studio-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
  return dir;
}

/** Gerçek alt sürecin yerine: stdout/stderr olay yayıcıları ve kill. */
export class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn(() => true);
  constructor(
    readonly command: string,
    readonly args: string[],
    readonly options: Record<string, unknown>,
  ) {
    super();
  }
}

export const children: FakeChild[] = [];

export const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
  const child = new FakeChild(command, args, options);
  children.push(child);
  return child;
});

export const lastChild = (): FakeChild => {
  const c = children.at(-1);
  if (!c) throw new Error("alt süreç başlatılmadı");
  return c;
};

/** Sahte sağlayıcılar: kota sorgusu ağa çıkmaz, üretim çağrılırsa test düşer. */
export const quotaCalls: string[] = [];

export function fakeProvider(over: Partial<ProviderAdapter> & { id: string; quotaValue?: Quota | Error | null }): ProviderAdapter {
  const { quotaValue, ...rest } = over;
  const base: ProviderAdapter = {
    local: false,
    capabilities: ["tts_timestamps"],
    limits: {},
    qualityPrior: 0.8,
    price: { unit: "per_1k_chars", usd: 0.1 },
    generate: async () => {
      throw new Error("testte üretim yapılmaz");
    },
    ...rest,
  };
  if (quotaValue !== undefined && quotaValue !== null) {
    return {
      ...base,
      quota: async () => {
        quotaCalls.push(base.id);
        if (quotaValue instanceof Error) throw quotaValue;
        return quotaValue;
      },
    };
  }
  return base;
}

export const registry: { providers: ProviderAdapter[]; skipped: string[] } = { providers: [], skipped: [] };

export const createProvidersFromEnv = () => ({ providers: registry.providers, skipped: registry.skipped });

/** @ys/db: Postgres'e bağlanmayan sahte defter. */
export const dbCalls: string[] = [];
export class FakeDbLedger {
  constructor(readonly db: unknown) {
    dbCalls.push(String((db as { url: string }).url));
  }
  async list() {
    return [];
  }
  async spent() {
    return 7_000_000;
  }
  async record() {}
}
export const createDb = (url: string) => ({ url });

/** Stüdyo'nun globalThis önbelleğini sıfırlar (her testte temiz Studio). */
export function resetStudio(): void {
  const g = globalThis as { __ys?: unknown; __ysUpdate?: unknown; __ysUpdateFlight?: unknown };
  delete g.__ys;
  delete g.__ysUpdate;
  delete g.__ysUpdateFlight;
  children.length = 0;
  quotaCalls.length = 0;
  spawn.mockClear();
}
