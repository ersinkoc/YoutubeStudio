import { QUALITY_GATE, READABLE_SIDE, TEXT_RULES } from "@ys/core/rules";
import { getI18n } from "../../lib/locale";
import type { MessageKey } from "../../lib/i18n";

/**
 * Stüdyo kuralları. Sayılar koddaki sabitlerden okunur (core/rules.ts): sayfa ile pipeline'ın uyguladığı kural
 * ayrışamaz. Her kural bir cümle; ayrıntı belgede (docs/PROJE_PLANI.md §9).
 */
export default async function RulesPage() {
  const { t } = await getI18n();
  const g = QUALITY_GATE;
  const cm = (m: number) => Math.round(m * 100);
  const sections: { title: MessageKey; rules: [MessageKey, Record<string, string | number>?][] }[] = [
    {
      title: "rules.gate",
      rules: [
        ["rules.gate.every"],
        ["rules.gate.plan"],
        ["rules.gate.blind"],
        ["rules.gate.thresholds", { character: g.recognizableMin.character, prop: g.recognizableMin.prop, background: g.recognizableMin.background, fidelity: g.fidelityMin }],
        ["rules.gate.redraw", { n: g.maxDraws }],
        ["rules.gate.reject", { n: g.maxDraws }],
        ["rules.gate.studio"],
        ["rules.gate.human"],
        ["rules.gate.realism"],
        ["rules.gate.library"],
      ],
    },
    {
      title: "rules.real",
      rules: [["rules.real.refs", { n: g.maxReferences }], ["rules.real.data"], ["rules.real.history"], ["rules.real.people"]],
    },
    {
      title: "rules.stage",
      rules: [
        ["rules.stage.physics"],
        ["rules.stage.readable", { held: cm(READABLE_SIDE.held), surface: cm(READABLE_SIDE.surface), floor: cm(READABLE_SIDE.floor) }],
        ["rules.stage.text", { n: TEXT_RULES.maxTexts }],
        ["rules.stage.faces"],
      ],
    },
    { title: "rules.money", rules: [["rules.money.consent"], ["rules.money.estimate"], ["rules.money.cap"]] },
    { title: "rules.learn", rules: [["rules.learn.review"], ["rules.learn.visible"]] },
  ];
  return (
    <div className="grid max-w-4xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("rules.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("rules.intro")}</p>
      </div>
      {sections.map((s) => (
        <section key={s.title} className="card">
          <h2 className="mb-3 font-semibold">{t(s.title)}</h2>
          <ol className="grid gap-2.5 text-sm">
            {s.rules.map(([key, vars], i) => (
              <li key={key} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-panel-2 text-[11px] font-semibold text-muted">{i + 1}</span>
                <span className="leading-relaxed">{t(key, vars)}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
