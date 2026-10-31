import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { repo } from "../../../../../lib/server";

/**
 * Dosyayı çekme (pull) tabanlı web akışına çevirir. `Readable.toWeb` istemci bağlantıyı kesince (oynatıcıda ileri sarma)
 * kapanmış akışa yazmaya çalışıp yakalanmamış istisna atıyordu; burada iptal dosya akışını kapatır, sonrası yazılmaz.
 */
function fileStream(path: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const file = createReadStream(path, range);
  const chunks = file[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(new Uint8Array(value));
    },
    cancel() {
      file.destroy();
    },
  });
}

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
    return new Response(fileStream(path), { headers: { ...headers, "content-length": String(size) } });
  }
  // "bytes=-500" son 500 bayt demektir; boyut dışı aralık 416.
  const suffix = !range[1] && range[2];
  const start = suffix ? Math.max(0, size - Number(range[2])) : range[1] ? Number(range[1]) : 0;
  const end = suffix ? size - 1 : range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  return new Response(fileStream(path, { start, end }), {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}
