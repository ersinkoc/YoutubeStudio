import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { repo } from "../../../../../lib/server";

/** Render edilmiş videoyu Range desteğiyle sunar (oynatıcıda ileri sarma için). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(id)) return new Response("Geçersiz bölüm", { status: 400 });
  const state = await repo().load(id);
  if (!state.render) return new Response("Video yok", { status: 404 });
  const path = state.render.path;
  const info = await stat(path).catch(() => undefined);
  if (!info) return new Response("Video dosyası yok", { status: 404 });
  const { size } = info;
  const download = new URL(req.url).searchParams.has("download");
  const headers: Record<string, string> = {
    "content-type": "video/mp4",
    "accept-ranges": "bytes",
    ...(download ? { "content-disposition": `attachment; filename="${id}.mp4"` } : {}),
  };

  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (!range) {
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return new Response(body, { headers: { ...headers, "content-length": String(size) } });
  }
  // "bytes=-500" son 500 bayt demektir; boyut dışı aralık 416.
  const suffix = !range[1] && range[2];
  const start = suffix ? Math.max(0, size - Number(range[2])) : range[1] ? Number(range[1]) : 0;
  const end = suffix ? size - 1 : range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
  return new Response(body, {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}
