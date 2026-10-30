import { loadLessons, type Lesson } from "@ys/pipeline/light";
import type { MessageKey } from "../../lib/i18n";
import { getI18n } from "../../lib/locale";
import { store } from "../../lib/server";

export const dynamic = "force-dynamic";

const TARGETS = ["director", "designer", "script"] as const;

export default async function LessonsPage() {
  const [{ lessons }, { t, fmt }] = await Promise.all([loadLessons(store()), getI18n()]);
  const sorted = (target: (typeof TARGETS)[number]): Lesson[] =>
    lessons
      .filter((l) => l.target === target)
      .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("lessons.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("lessons.intro")}</p>
      </div>
      {lessons.length === 0 && <p className="text-muted">{t("lessons.empty")}</p>}
      {TARGETS.map((target) => {
        const list = sorted(target);
        if (list.length === 0) return null;
        return (
          <section key={target} className="card">
            <h2 className="mb-3 text-lg font-semibold">{t(`lessons.target.${target}` as MessageKey)}</h2>
            <ol className="grid gap-2 text-sm">
              {list.map((l) => (
                <li key={l.rule} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line/50 pb-2">
                  <span>{l.rule}</span>
                  <span className="text-xs text-muted">
                    {t("lessons.count", { n: l.count })} · {t("lessons.lastSeen", { date: fmt.day(l.lastSeen) })}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
