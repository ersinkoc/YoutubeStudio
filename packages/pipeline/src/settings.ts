import { cleanModelSettings, type ModelSettings } from "@ys/core";
import { getJson, putJson, type AssetStore } from "@ys/storage";

const MODELS_KEY = "settings/models.json";

/** Kullanıcının ajan başına model seçimi (Stüdyo → Modeller). Dosya yoksa ya da bozuksa boş: varsayılanlar geçerli. */
export async function loadModelSettings(store: AssetStore): Promise<ModelSettings> {
  return cleanModelSettings(await getJson(store, MODELS_KEY));
}

/** Yalnız geçerli seçimler yazılır; varsayılanla aynı olan seçim de saklanır (kullanıcı bilerek seçti). */
export async function saveModelSettings(store: AssetStore, raw: unknown): Promise<ModelSettings> {
  const clean = cleanModelSettings(raw);
  await putJson(store, MODELS_KEY, clean);
  return clean;
}
