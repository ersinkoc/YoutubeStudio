import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { repo } from "../../../../../lib/server";

/** Render edilmiş videoyu Range desteğiyle sunar (oynatıcıda ileri sarma için). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const state = await repo().load(id);
  if (!state.render) return new Response("Video yok", { status: 404 });
  const path = state.render.path;
  const { size } = await stat(path);
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
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
  return new Response(body, {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}
