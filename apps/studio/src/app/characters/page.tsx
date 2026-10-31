import { CHARACTER_BANK_ID, listLibraryCharacters, summarizeSeries } from "@ys/pipeline/light";
import { getI18n } from "../../lib/locale";
import { getJob, repo, store } from "../../lib/server";
import { CharacterBank } from "./character-bank";

export const dynamic = "force-dynamic";

export default async function CharactersPage() {
  const [characters, episodes, { t }] = await Promise.all([listLibraryCharacters(store()), repo().list(), getI18n()]);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("bank.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t("bank.intro")}</p>
      </div>
      <CharacterBank initial={characters} series={summarizeSeries(episodes).map((s) => s.name)} initialJob={getJob(CHARACTER_BANK_ID) ?? null} />
    </div>
  );
}
