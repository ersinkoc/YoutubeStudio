import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareVersions } from "@ys/core";
import { ROOT } from "./server";

/** Güncelleme uyarısının baktığı depo (herkese açık; istek kimlik bilgisi taşımaz). */
const REPO = "ersinkoc/AI-Video-Factory";
const TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;

export interface UpdateInfo {
  current: string;
  latest?: { version: string; url: string; publishedAt: string };
}

const g = globalThis as unknown as { __ysUpdate?: { at: number; ttl: number; latest?: UpdateInfo["latest"] }; __ysUpdateFlight?: Promise<void> };

/** Çalışan sürüm: kök package.json (release betiği artırır). */
export function currentVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * GitHub'daki son release (6 saatte bir sorulur). Ağ yoksa ya da YS_UPDATE_CHECK=0 ise sessizce atlanır:
 * uyarı yardımcıdır, sayfayı asla bekletmez ya da bozmaz.
 */
export async function updateInfo(): Promise<UpdateInfo & { available: boolean }> {
  const current = currentVersion();
  if (process.env.YS_UPDATE_CHECK !== "0") {
    const cached = g.__ysUpdate;
    if (!cached || Date.now() - cached.at > cached.ttl) {
      // Aynı anda gelen istekler tek GitHub sorgusunu paylaşır; önbellek varken sayfa sorguyu beklemez.
      g.__ysUpdateFlight ??= refresh(cached).finally(() => (g.__ysUpdateFlight = undefined));
      if (!cached) await g.__ysUpdateFlight;
    }
  }
  const latest = g.__ysUpdate?.latest;
  return { current, latest, available: Boolean(latest && compareVersions(latest.version, current) > 0) };
}

async function refresh(cached: (typeof g)["__ysUpdate"]): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "YoutubeStudio update check" },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    // 404: henüz release yok.
    const body = res.ok ? ((await res.json()) as { tag_name: string; html_url: string; published_at: string }) : undefined;
    g.__ysUpdate = {
      at: Date.now(),
      ttl: res.ok || res.status === 404 ? TTL_MS : RETRY_MS,
      latest: body && { version: body.tag_name.replace(/^v/, ""), url: body.html_url, publishedAt: body.published_at },
    };
  } catch {
    g.__ysUpdate = { at: Date.now(), ttl: RETRY_MS, latest: cached?.latest };
  }
}
