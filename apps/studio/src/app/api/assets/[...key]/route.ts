import { store } from "../../../../lib/server";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

/** Depodaki üretilmiş varlıkları sunar. Anahtarlar içerik hash'li olduğu için kalıcı önbelleklenebilir. */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  if (key[0] !== "assets" || key.some((k) => k === ".." || k.includes("\\"))) {
    return new Response("Yasak", { status: 403 });
  }
  const bytes = await store().get(key.join("/"));
  if (!bytes) return new Response("Yok", { status: 404 });
  const ext = key.at(-1)?.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
