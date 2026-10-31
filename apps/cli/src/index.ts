import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { BudgetTier, Capability, Quality, STYLE_PACKS, formatUsd, trText, usd } from "@ys/core";
import { createDb, DbCostLedger } from "@ys/db";
import {
  createProvidersFromEnv,
  JsonlLedger,
  MediaGateway,
  type AspectRatio,
  type CostLedger,
  type GenerationRequest,
  type RefInput,
  type RunOptions,
} from "@ys/media-gateway";
import { backfillLibraryIdentities, curateLessons, EpisodePipeline, listLibraryCharacters, loadLessons, saveLessons } from "@ys/pipeline";
import { createStoreFromEnv } from "@ys/storage";
import { bankCommand } from "./bank.ts";
import { episodeCommand, positive, renderDemo } from "./episode.ts";

const LEDGER_FILE = ".data/ledger.jsonl";
const WORK_DIR = ".data/episodes";

const HELP = `YoutubeStudio CLI

Kullanım: pnpm ys <komut> [seçenekler]

Komutlar:
  providers                         Etkin ve atlanan sağlayıcıları listeler
  plan   --cap <yetenek>            Para harcamadan router sıralamasını gösterir
  image  --prompt "..." [--ref yol]...
  video  --image yol --prompt "..." [--last yol] [--duration 5]
  tts    --text "..." [--voice id] [--lang tr]
  sfx    --prompt "..." [--duration 3]
  music  --prompt "..." [--duration 60]
  cost   [--episode id]             Maliyet defteri özeti
  version                           Çalışan sürüm
  styles                            Hazır stil paketleri
  library [--backfill]              Kütüphanedeki karakterler; --backfill eski bölümlerden kimlik yazar (ücretsiz)
  bank [list]                       Karakter bankası (bölümlerde ve bankada çizilen onaylı karakterler)
  bank add --name "..." --desc "..." --pack <paket> [--line ...] [--role "sunucu"] [--reference "..."]
                                    Konudan bağımsız karakter çizer ve kapıdan geçirir (Claude, ~$0.15–0.35)
  bank mascot <kimlik> --series "Seri" [--remove]   Serinin maskotu: serinin her bölümüne kendiliğinden girer

  episode new --topic "..." [--lang tr] [--minutes 3] [--tier economy] [--budget 10]
              [--clips 0.2] [--style "..."] [--voice id] [--vertical]
  episode run <id> [--until <aşama>] [--from <aşama>] [--only <aşama>]
              aşamalar: style story script voice shots keyframes clips timeline render
  episode show <id>
  episode approve <id> script|concept
  episode select <id> <varlık>=<sıra>      örn. c1=2 (konsept adayı seç)
  episode preview <id>              seçilen referanslarla deneme kareleri
              new için: [--motion animated|mixed|still|vector] [--manual: onaylarda dur] [--no-qa: kare kontrolü kapalı] [--no-realism: gerçeklik denetimi kapalı] [--side-views: yürüyen karakterlere yan görünüş] [--line outline|flat|sketch|ink]
              [--series "Seri adı"] [--style-pack auto|custom|<paket>]  (paketler: pnpm ys styles)
              [--presenter <banka kimliği>] [--with <kimlik,kimlik>]  bankadan sunucu/karakter (vektör; bölüm onların stiline geçer)
  render-demo                       API'siz yerel Remotion testi (FFmpeg görselleri)
  lessons [--curate]                Orkestratörün ders defteri; --curate benzer kuralları birleştirir (Claude çağırır, ~$0.01)

Ortak seçenekler:
  --tier ultra|economy|standard|premium   (varsayılan: economy)
  --quality draft|standard|hero           (varsayılan: standard)
  --aspect 16:9|9:16|1:1
  --episode <id>  --budget <usd>  --no-cache  --no-local
  --provider <id>                         Sadece bu sağlayıcıyı kullan
`;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

async function loadRef(path: string, role: RefInput["role"]): Promise<RefInput> {
  const mimeType = MIME[extname(path).toLowerCase()];
  if (!mimeType) throw new Error(`Desteklenmeyen dosya türü: ${path}`);
  return { role, bytes: new Uint8Array(await readFile(path)), mimeType };
}

function createLedger(): CostLedger {
  if (process.env.LEDGER === "db" && process.env.DATABASE_URL) {
    return new DbCostLedger(createDb(process.env.DATABASE_URL));
  }
  return new JsonlLedger(LEDGER_FILE);
}

async function main(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");

  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      cap: { type: "string" },
      prompt: { type: "string" },
      negative: { type: "string" },
      text: { type: "string" },
      voice: { type: "string" },
      lang: { type: "string" },
      image: { type: "string" },
      last: { type: "string" },
      ref: { type: "string", multiple: true },
      duration: { type: "string" },
      aspect: { type: "string" },
      seed: { type: "string" },
      tier: { type: "string", default: "economy" },
      quality: { type: "string", default: "standard" },
      episode: { type: "string" },
      budget: { type: "string" },
      provider: { type: "string" },
      "no-cache": { type: "boolean", default: false },
      "no-local": { type: "boolean", default: false },
      topic: { type: "string" },
      minutes: { type: "string" },
      clips: { type: "string" },
      style: { type: "string" },
      until: { type: "string" },
      from: { type: "string" },
      only: { type: "string" },
      motion: { type: "string" },
      manual: { type: "boolean", default: false },
      "no-qa": { type: "boolean", default: false },
      "no-realism": { type: "boolean", default: false },
      "side-views": { type: "boolean", default: false },
      presenter: { type: "string" },
      with: { type: "string" },
      name: { type: "string" },
      desc: { type: "string" },
      pack: { type: "string" },
      role: { type: "string" },
      reference: { type: "string" },
      remove: { type: "boolean", default: false },
      curate: { type: "boolean", default: false },
      line: { type: "string" },
      "style-pack": { type: "string" },
      series: { type: "string" },
      backfill: { type: "boolean", default: false },
      vertical: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      // "--version" seçenek olarak tanımlı değilse parseArgs "Unknown option" ile düşüyordu.
      version: { type: "boolean", default: false },
    },
  });

  const command = values.version ? "version" : positionals[0];
  if (!command || values.help) {
    console.log(HELP);
    return;
  }

  const { providers, skipped } = createProvidersFromEnv(process.env);
  const ledger = createLedger();

  if (command === "version") {
    const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version?: string };
    console.log(`YoutubeStudio v${version ?? "0.0.0"}`);
    return;
  }

  if (command === "library") {
    const store = createStoreFromEnv(process.env);
    if (values.backfill) console.log(`${await backfillLibraryIdentities(store)} karaktere kimlik yazıldı`);
    for (const c of await listLibraryCharacters(store)) {
      console.log(`${c.id.slice(0, 8)}  ${c.name.padEnd(28)} ${(c.pack ?? "özel").padEnd(18)} ${c.lineStyle.padEnd(8)} ${c.episodes.length} bölüm`);
    }
    return;
  }

  if (command === "styles") {
    for (const p of STYLE_PACKS) console.log(`${p.id.padEnd(18)} ${p.name.tr} · ${p.lineStyle} · ${p.suits}`);
    return;
  }

  if (command === "providers") {
    console.log("Etkin sağlayıcılar:");
    for (const p of providers) {
      const price = p.price.unit === "free" ? "ücretsiz" : `$${p.price.usd} ${p.price.unit}`;
      console.log(`  ${p.id.padEnd(28)} q=${p.qualityPrior.toFixed(2)}  ${price.padEnd(26)} ${p.capabilities.join(", ")}`);
    }
    console.log("\nAtlananlar:");
    for (const s of skipped) console.log(`  ${trText(s)}`);
    return;
  }

  if (command === "cost") {
    if (!(ledger instanceof JsonlLedger)) {
      console.log(values.episode ? formatUsd(await ledger.spent(values.episode)) : "--episode gerekli (LEDGER=db)");
      return;
    }
    const entries = (await ledger.all()).filter((e) => !values.episode || e.episodeId === values.episode);
    const byProvider = new Map<string, { n: number; micros: number; hits: number }>();
    for (const e of entries) {
      const row = byProvider.get(e.providerId) ?? { n: 0, micros: 0, hits: 0 };
      row.n++;
      if (e.cacheHit) row.hits++;
      else row.micros += e.estimateMicros;
      byProvider.set(e.providerId, row);
    }
    let total = 0;
    for (const [id, r] of byProvider) {
      total += r.micros;
      console.log(`  ${id.padEnd(28)} ${String(r.n).padStart(4)} çağrı  ${String(r.hits).padStart(4)} önbellek  ${formatUsd(r.micros)}`);
    }
    console.log(`  ${"TOPLAM".padEnd(28)} ${formatUsd(total)}`);
    return;
  }

  if (command === "lessons") {
    // Orkestratörün ders defteri: listele; --curate ile benzer kuralları birleştir (ucuz model, ~$0.01).
    const store = createStoreFromEnv(process.env);
    const book = await loadLessons(store);
    if (values.curate) {
      await curateLessons(book, {
        force: true,
        deps: { log: (m: string) => console.error(m) },
        onCall: async (target, res, before) => {
          await ledger.record({
          at: new Date().toISOString(),
          stage: "review",
          providerId: `claude:${res.model}`,
          capability: "llm",
          estimateMicros: usd(res.costUsd),
          cacheHit: false,
            requestHash: `lessons:${target}`,
            durationMs: res.durationMs,
          });
          console.error(`${target}: ${before} → ${res.data.rules.length} kural`);
        },
      });
      await saveLessons(store, book);
    }
    for (const target of ["director", "designer", "script"] as const) {
      console.log(`\n${target}:`);
      for (const l of book.lessons.filter((x) => x.target === target).sort((a, b) => b.count - a.count)) {
        console.log(`  [${l.count}] ${l.rule}`);
      }
    }
    return;
  }

  if (command === "bank") {
    const store = createStoreFromEnv(process.env);
    const log = (m: string) => console.error(m);
    const gateway = new MediaGateway({ providers, store, ledger, log: (m) => log(`  · ${m}`) });
    const pipeline = new EpisodePipeline({ gateway, store, ledger, workDir: WORK_DIR, log, agentDeps: { log } });
    return bankCommand({ pipeline, store, print: (l) => console.log(l) }, positionals[1], positionals[2], values);
  }

  if (command === "episode" || command === "render-demo") {
    const store = createStoreFromEnv(process.env);
    const log = (m: string) => console.error(m);
    const gateway = new MediaGateway({ providers, store, ledger, log: (m) => log(`  · ${m}`) });
    const pipeline = new EpisodePipeline({ gateway, store, ledger, workDir: WORK_DIR, log, agentDeps: { log } });
    if (command === "render-demo") return renderDemo(pipeline, store);
    return episodeCommand(pipeline, positionals[1], positionals[2], {
      ...values,
      noQa: values["no-qa"],
      noRealism: values["no-realism"],
      sideViews: values["side-views"],
      stylePack: values["style-pack"],
      gate: positionals[3],
      pick: positionals[3],
      minutes: values.minutes,
      lang: values.lang,
    });
  }

  const tier = BudgetTier.parse(values.tier);
  const quality = Quality.parse(values.quality);
  const durationSec = values.duration ? Number(values.duration) : undefined;
  const base = {
    quality,
    prompt: values.prompt,
    negativePrompt: values.negative,
    aspectRatio: values.aspect as AspectRatio | undefined,
    seed: values.seed ? Number(values.seed) : undefined,
    durationSec,
  };

  let req: GenerationRequest;
  switch (command) {
    case "plan":
      req = { ...base, capability: Capability.parse(values.cap), text: values.text, voiceId: values.voice };
      break;
    case "image": {
      const refs = await Promise.all((values.ref ?? []).map((p) => loadRef(p, "character")));
      req = { ...base, capability: refs.length ? "i2i_multiref" : "t2i", refs };
      break;
    }
    case "video": {
      if (!values.image) throw new Error("--image gerekli");
      const refs = [await loadRef(values.image, "first_frame")];
      if (values.last) refs.push(await loadRef(values.last, "last_frame"));
      req = { ...base, capability: values.last ? "first_last_frame" : "i2v", refs };
      break;
    }
    case "tts":
      if (!values.text) throw new Error("--text gerekli");
      req = { ...base, capability: "tts", text: values.text, voiceId: values.voice, language: values.lang };
      break;
    case "sfx":
      req = { ...base, capability: "sfx" };
      break;
    case "music":
      req = { ...base, capability: "music" };
      break;
    default:
      throw new Error(`Bilinmeyen komut: ${command}\n\n${HELP}`);
  }

  const gateway = new MediaGateway({
    providers,
    store: createStoreFromEnv(process.env),
    ledger,
    log: (m) => console.error(`· ${m}`),
  });
  const run: RunOptions = {
    policy: {
      tier,
      useLocal: !values["no-local"],
      allow: values.provider ? [values.provider] : undefined,
    },
    episodeId: values.episode,
    stage: `cli:${command}`,
    budgetCapMicros: values.budget ? usd(positive("--budget", values.budget)) : undefined,
    noCache: values["no-cache"],
  };

  // Tavan bölüm defterine göre uygulanır: bölümsüz --budget sessizce yok sayılıyordu.
  if (values.budget && !values.episode && command !== "plan") throw new Error("--budget için --episode <id> de gerekli");

  if (command === "plan") {
    const ranked = gateway.plan(req, run.policy);
    if (ranked.length === 0) console.log("Uygun sağlayıcı yok.");
    ranked.forEach((r, i) =>
      console.log(`${i + 1}. ${r.adapter.id.padEnd(28)} ~${formatUsd(r.estimateMicros).padEnd(10)} skor=${r.score.toFixed(2)}`),
    );
    return;
  }

  const result = await gateway.generate(req, run);
  console.log(
    JSON.stringify(
      {
        provider: result.providerId,
        cost: formatUsd(result.costMicros),
        cacheHit: result.cacheHit,
        files: result.files.map((f) => f.uri),
        words: result.words?.length,
      },
      null,
      2,
    ),
  );
}

/**
 * İş bitince süreç kesin kapanır: açık kalan tarayıcı (Remotion), DB bağlantısı ya da zamanlayıcı süreci canlı tutup
 * Stüdyo'ya işi "çalışıyor" gösteriyordu (30 Eki). Çıkmadan önce stdout/stderr boşaltılır.
 */
async function exit(code: number): Promise<never> {
  await Promise.all([process.stdout, process.stderr].map((s) => new Promise<void>((r) => s.write("", () => r()))));
  process.exit(code);
}

main()
  .then(() => exit(Number(process.exitCode ?? 0)))
  .catch(async (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    await exit(1);
  });
