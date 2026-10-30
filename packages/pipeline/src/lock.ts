import { hostname } from "node:os";
import { getJson, putJson, type AssetStore } from "@ys/storage";

/**
 * Çalışma kilidi: pipeline çalışırken bölüm klasörüne süreç kimliği yazılır. Aynı bölüm ikinci kez başlatılamaz (iki
 * süreç aynı durum dosyasını birbirinin üstüne yazardı); süreç ölmüşse (iptal, çökme) kilit bayattır ve yok sayılır.
 * Durum dosyasının "15 dk kayıt yoksa takıldı" tahmininden kesindir. Yalnız aynı makinedeki süreç denetlenebilir;
 * başka makinedeki kilit (paylaşılan S3) canlı sayılır.
 */
export interface RunLock {
  pid: number;
  host: string;
  startedAt: string;
}

const lockKey = (id: string) => `episodes/${id}/run.lock.json`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: süreç var ama sinyal izni yok.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Canlı kilit (yoksa ya da sahibi ölmüşse undefined). */
export async function liveLock(store: AssetStore, id: string): Promise<RunLock | undefined> {
  const lock = await getJson<RunLock | null>(store, lockKey(id)).catch(() => null);
  if (!lock?.pid) return undefined;
  if (lock.host !== hostname()) return lock;
  return alive(lock.pid) ? lock : undefined;
}

/**
 * Bu makinede sahibi ölmüş kilit var mı: pipeline çökmüş ya da öldürülmüş, durum dosyasındaki "sürüyor" kesin bayattır.
 * Kilit hiç yoksa false (kilitsiz işler, ör. önizleme, için bir şey söylenemez).
 */
export async function deadLock(store: AssetStore, id: string): Promise<boolean> {
  const lock = await getJson<RunLock | null>(store, lockKey(id)).catch(() => null);
  return Boolean(lock?.pid) && lock!.host === hostname() && !alive(lock!.pid);
}

/** Kilidi alır; başka canlı süreç tutuyorsa hata. Dönen fonksiyon kilidi bırakır (yalnız kendi kilidiyse). */
export async function acquireLock(store: AssetStore, id: string): Promise<() => Promise<void>> {
  const held = await liveLock(store, id);
  if (held && !(held.pid === process.pid && held.host === hostname())) {
    throw new Error(`Bu bölüm zaten çalışıyor (süreç ${held.pid}, ${held.startedAt}); bitmesini bekle ya da iptal et`);
  }
  const mine: RunLock = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
  await putJson(store, lockKey(id), mine);
  return async () => {
    const now = await getJson<RunLock | null>(store, lockKey(id)).catch(() => null);
    if (now?.pid === mine.pid && now.host === mine.host) await putJson(store, lockKey(id), null);
  };
}
