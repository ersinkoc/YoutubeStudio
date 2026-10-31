import { msg } from "@ys/core/messages";
import { textResponse } from "../../../../lib/api";
import { store } from "../../../../lib/server";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  svg: "image/svg+xml",
};

/** Üretilmiş varlıkların bulunduğu kökler: görsel/ses üretimleri ve vektör kütüphanesi. */
const ROOTS = new Set(["assets", "library"]);

/** Depodaki üretilmiş varlıkları sunar. Anahtarlar içerik hash'li olduğu için kalıcı önbelleklenebilir. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  // Kodlanmış eğik çizgi (%2F) bir parçaya "../episodes/…" sokabiliyordu: parçada ayraç ve nokta ile başlama yasak.
  if (!ROOTS.has(key[0] ?? "") || key.some((k) => !k || k.startsWith(".") || /[\\/\0]/.test(k))) {
    return textResponse(req, msg("api.forbidden"), 403);
  }
  const bytes = await store().get(key.join("/"));
  if (!bytes) return textResponse(req, msg("api.notFound"), 404);
  // Yukarıdaki denetim en az bir dolu parça garanti eder; "" yalnız tip için (ulaşılamaz).
  /* v8 ignore next */
  const ext = key.at(-1)?.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      // Model üretimi SVG doğrudan açılsa bile betik çalışmasın: belge kum havuzunda, dış kaynak yok.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
