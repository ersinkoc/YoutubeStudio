import { lessonCurator, type AgentDeps, type AgentResult, type LessonCuratorOut } from "@ys/agents";
import { applyCuration, CURATE_ABOVE, type LessonBook } from "./lessons.ts";

const TARGETS = ["director", "designer", "script"] as const;

/**
 * Ders defterini küratörden geçirir: kural sayısı eşiği aşan (force ise 2+ kuralı olan) her hedef için benzer
 * kurallar birleştirilir. Her çağrının sonucu onCall ile bildirilir (maliyet defterine yazmak için).
 */
export async function curateLessons(
  book: LessonBook,
  opts: {
    force?: boolean;
    deps?: AgentDeps;
    onCall?: (target: string, res: AgentResult<LessonCuratorOut>, before: number) => Promise<void> | void;
  } = {},
): Promise<LessonBook> {
  for (const target of TARGETS) {
    const rules = book.lessons.filter((l) => l.target === target).map((l) => l.rule);
    if (rules.length <= (opts.force ? 1 : CURATE_ABOVE)) continue;
    const res = await lessonCurator(target, rules, opts.deps);
    applyCuration(book, target, res.data.rules);
    await opts.onCall?.(target, res, rules.length);
  }
  return book;
}
