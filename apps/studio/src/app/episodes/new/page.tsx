import { stylePackOf } from "@ys/core/styles";
import { listLibraryCharacters, summarizeSeries } from "@ys/pipeline/light";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getI18n } from "../../../lib/locale";
import { repo, store } from "../../../lib/server";
import { NewEpisodeForm } from "../../new-episode-form";

export const dynamic = "force-dynamic";

/** Yeni bölüm sayfası: form tam genişlikte. "?series=Ad" ile açılırsa ayarlar o serinin son bölümünden dolar. */
export default async function NewEpisodePage({ searchParams }: { searchParams: Promise<{ series?: string }> }) {
  const [all, { t }, params, library] = await Promise.all([repo().list(), getI18n(), searchParams, listLibraryCharacters(store())]);
  const series = summarizeSeries(all.filter((e) => e.input.topic !== "render demo"));
  // Karakter bankasından seçilebilenler: stili bir paketle yeniden kurulabilenler.
  const bank = library.filter((c) => c.pack && stylePackOf(c.pack));
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link href="/" className="flex w-fit items-center gap-1 text-sm text-muted hover:text-white">
          <ArrowLeft size={14} /> {t("form.back")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t("form.title")}</h1>
        <p className="text-sm text-muted">{t("form.subtitle")}</p>
      </div>
      <NewEpisodeForm series={series} initialSeries={params.series || undefined} bank={bank} />
    </div>
  );
}
