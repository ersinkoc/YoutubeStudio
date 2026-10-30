import type { RunStatus, Stage } from "@ys/pipeline/light";
import type { MessageKey, Translate } from "./i18n";

/** Durum rozetinin metni: "Çalışıyor · Kareler", "Onay bekliyor · Senaryo". */
export function statusLabel(t: Translate, st: { status: RunStatus; stage?: Stage }): string {
  const base = t(`status.${st.status}` as MessageKey);
  if (!st.stage || st.status === "done" || st.status === "idle") return base;
  // Bekleme, kapının açtığı aşamada görünür; rozet onaylanacak şeyi söylesin.
  const what = st.status === "waiting" ? t(st.stage === "voice" ? "step.concept" : "step.script") : t(`stage.${st.stage}` as MessageKey);
  return `${base} · ${what}`;
}
