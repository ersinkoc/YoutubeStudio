import { LineStyle } from "@ys/core";
import { listLibraryCharacters, setMascot, type EpisodePipeline } from "@ys/pipeline";
import type { AssetStore } from "@ys/storage";

export interface BankArgs {
  name?: string;
  desc?: string;
  pack?: string;
  line?: string;
  role?: string;
  reference?: string;
  series?: string;
  remove?: boolean;
}

export interface BankDeps {
  pipeline: Pick<EpisodePipeline, "createBankCharacter">;
  store: AssetStore;
  print: (line: string) => void;
}

/**
 * Karakter bankası: kütüphanedeki onaylı karakterler (bölümlerde çizilenler + bankada çizilenler).
 *   bank [list]                                   listeler
 *   bank add --name --desc --pack [--line] [--role] [--reference]   Claude çizer, kapı denetler (~$0.15–0.35)
 *   bank mascot <kimlik> --series "Seri" [--remove]                 serinin maskotu yapar/çıkarır
 */
export async function bankCommand(deps: BankDeps, sub: string | undefined, id: string | undefined, args: BankArgs): Promise<void> {
  switch (sub ?? "list") {
    case "list": {
      for (const c of await listLibraryCharacters(deps.store)) {
        const tags = [c.bank ? "banka" : "", c.mascotOf.length ? `maskot: ${c.mascotOf.join(", ")}` : ""].filter(Boolean).join(" · ");
        deps.print(
          `${c.id.slice(0, 8)}  ${c.name.padEnd(24)} ${(c.role ?? "").padEnd(16)} ${(c.pack ?? "özel").padEnd(18)} ${c.lineStyle.padEnd(8)} ${c.episodes.length} bölüm${tags ? `  ${tags}` : ""}`,
        );
      }
      return;
    }
    case "add": {
      if (!args.name?.trim() || !args.desc?.trim() || !args.pack) throw new Error("Kullanım: bank add --name \"...\" --desc \"...\" --pack <paket> [--line outline|flat|sketch|ink] [--role \"...\"]");
      const c = await deps.pipeline.createBankCharacter({
        name: args.name.trim(),
        description: args.desc.trim(),
        role: args.role,
        pack: args.pack,
        lineStyle: args.line ? LineStyle.parse(args.line) : undefined,
        reference: args.reference?.trim() || undefined,
      });
      deps.print(`${c.id.slice(0, 8)}  ${c.name} bankaya eklendi`);
      return;
    }
    case "mascot": {
      if (!id || !args.series?.trim()) throw new Error("Kullanım: bank mascot <kimlik> --series \"Seri\" [--remove]");
      const full = (await listLibraryCharacters(deps.store)).find((c) => c.id === id || c.id.startsWith(id))?.id ?? id;
      await setMascot(deps.store, full, args.series, !args.remove);
      deps.print(args.remove ? "maskotluktan çıkarıldı" : "seri maskotu yapıldı");
      return;
    }
    default:
      throw new Error(`Bilinmeyen bank komutu: ${sub}`);
  }
}
