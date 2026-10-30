import { loadModelSettings } from "@ys/pipeline/light";
import { getI18n } from "../../lib/locale";
import { store } from "../../lib/server";
import { ModelsForm } from "./models-form";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const [settings, { t }] = await Promise.all([loadModelSettings(store()), getI18n()]);
  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("models.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("models.intro")}</p>
      </div>
      <ModelsForm initial={settings} />
    </div>
  );
}
