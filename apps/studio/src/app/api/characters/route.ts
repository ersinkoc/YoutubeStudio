import { LineStyle, msg, stylePackOf } from "@ys/core";
import { CHARACTER_BANK_ID, listLibraryCharacters } from "@ys/pipeline/light";
import { apiError, errorResponse } from "../../../lib/api";
import { getJob, startJob, store } from "../../../lib/server";

/** Karakter bankası: kütüphanedeki onaylı karakterler ve banka çiziminin iş durumu. */
export async function GET() {
  return Response.json({ characters: await listLibraryCharacters(store()), job: getJob(CHARACTER_BANK_ID) ?? null });
}

interface AddBody {
  name?: string;
  description?: string;
  role?: string;
  pack?: string;
  lineStyle?: string;
  reference?: string;
}

/** Bankaya konudan bağımsız karakter çizdirir (CLI işi: plan → çizim → kalite kapısı; Claude ~$0.15–0.35). */
export async function POST(req: Request) {
  const b = (await req.json()) as AddBody;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
  const description = typeof b.description === "string" ? b.description.trim().slice(0, 800) : "";
  if (!name || !description) return apiError(req, msg("api.bank.fields"));
  if (typeof b.pack !== "string" || !stylePackOf(b.pack)) return apiError(req, msg("err.bank.badPack", { pack: String(b.pack) }));
  const line = b.lineStyle ? LineStyle.safeParse(b.lineStyle) : undefined;
  if (line && !line.success) return apiError(req, msg("api.bank.fields"));
  const opt = (flag: string, v: unknown) => (typeof v === "string" && v.trim() ? [flag, v.trim().slice(0, 200)] : []);
  try {
    const job = startJob(CHARACTER_BANK_ID, "job.bankAdd", [
      "bank",
      "add",
      "--name",
      name,
      "--desc",
      description,
      "--pack",
      b.pack,
      ...opt("--line", line?.data),
      ...opt("--role", b.role),
      ...opt("--reference", b.reference),
    ]);
    return Response.json({ job });
  } catch (e) {
    // Bankada zaten bir çizim sürüyor.
    return errorResponse(req, e, 409);
  }
}
