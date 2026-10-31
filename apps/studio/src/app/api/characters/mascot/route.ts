import { setMascot } from "@ys/pipeline/light";
import { errorResponse } from "../../../../lib/api";
import { store } from "../../../../lib/server";

/** Karakteri serinin maskotu yapar ya da çıkarır: serinin her bölümünün kadrosuna kendiliğinden girer. */
export async function POST(req: Request) {
  const b = (await req.json()) as { id?: unknown; series?: unknown; on?: unknown };
  try {
    await setMascot(store(), String(b.id ?? ""), String(b.series ?? ""), b.on !== false);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(req, e);
  }
}
