import { loadModelSettings, saveModelSettings } from "@ys/pipeline/light";
import { store } from "../../../../lib/server";

/** Ajan başına model seçimi (Modeller sayfası). Değişiklik bir sonraki çalıştırmada geçerli olur. */
export async function GET() {
  return Response.json(await loadModelSettings(store()));
}

export async function PUT(req: Request) {
  return Response.json(await saveModelSettings(store(), await req.json()));
}
