# YoutubeStudio

Çok dilli, animasyon ağırlıklı, 8–20 dakikalık YouTube videoları üreten AI video fabrikası.
Mimari, sağlayıcı seçimi ve yol haritası için: **[docs/PROJE_PLANI.md](docs/PROJE_PLANI.md)**.

## Durum

| Parça | Durum |
|---|---|
| **Faz 0** | |
| `@ys/core`: Zod şemaları (Channel, Character, StyleBible, Shot, Timeline), mikro-dolar para birimi | ✅ |
| `@ys/storage`: Yerel klasör + S3 (RustFS yerel / Cloudflare R2) | ✅ entegrasyon testi |
| `@ys/media-gateway`: maliyet/kalite router'ı, önbellek, bütçe tavanı, fallback, sağlık takibi | ✅ test |
| Sağlayıcılar: fal, Gemini (Nano Banana, TTS, Veo), ElevenLabs (v3 + zamanlama, SFX, Music), ComfyUI | ✅ kod; gerçek API ile henüz denenmedi |
| `@ys/db`: Drizzle şeması, migration, Postgres maliyet defteri | ✅ entegrasyon testi (postgres 4.0) |
| **Faz 1** | |
| `@ys/agents`: Claude Agent SDK ajanları: Art Director, Story Architect, Screenwriter, Director | ✅ gerçek çağrıyla doğrulandı |
| `@ys/pipeline`: bölüm durumu, idempotent ve kaldığı yerden devam eden 9 aşama, kelime-indeksli çekim zamanlama | ✅ test |
| `@ys/video`: Remotion: Ken Burns/pan, klip, crossfade, kelime vurgulu altyazı, yerel render | ✅ gerçek render |
| `apps/worker`: Trigger.dev v4 `run-episode` task'ı (canlı ilerleme metadata'sı) | ✅ kod; Trigger.dev hesabı gerekli |
| Stüdyo arayüzü, karakter tutarlılığı, müzik/SFX, çok dil | Faz 2+ |

## Kurulum

```bash
pnpm install
cp .env.example .env          # anahtarları doldur; boş olan sağlayıcılar devre dışı kalır
pnpm ys providers             # hangi sağlayıcılar etkin?
pnpm ys render-demo           # API'siz: FFmpeg görselleriyle Remotion render testi
```

Docker'sız çalışır: varlıklar `.data/assets`, maliyet defteri `.data/ledger.jsonl`, videolar `.data/episodes`.
Postgres 18, Redis 8 ve RustFS (S3) ile çalıştırmak için:

```bash
pnpm infra:up                 # portlar: 5433 (pg), 6380 (redis), 9000/9001 (rustfs)
pnpm db:migrate
pnpm test:integration
# .env: STORE=s3, LEDGER=db
```

## Stüdyo (önerilen)

```bash
pnpm studio                   # http://localhost:3100
```

1. **Konu gir**: dil, süre, hareket modu, kalite, anlatıcı sesi. Stil, hikâye ve senaryo yazılır.
2. **Senaryoyu düzenle ve onayla**: sahne metinleri düzenlenebilir.
3. **Konsept**: Casting ajanı karakter ve mekânları çıkarır, her biri için aday görseller üretilir. Seç, istersen yeni adaylar üret, **deneme karelerini** gör, hareket modunu maliyetiyle birlikte seç.
4. **Konsept tamam**: ses → çekim planı → referanslı kareler → animasyon → kurgu → render. İlerleme canlı izlenir, video stüdyoda oynatılır ve indirilir.

Tutarlılık: her kare seçilen karakter ve mekân görselleri referans alınarak çizilir (`i2i_multiref`). "Tamamen animasyon" modunda her çekim AI video olur.
Ağır işler stüdyo sunucusunda değil, ayrı bir CLI sürecinde çalışır (`apps/studio/src/lib/server.ts`).

Gerçek ölçüm (1 dk, Türkçe, tamamen animasyon, standart): **$6.18**, 12/12 çekim animasyon, karakter 12 karede tutarlı.

## Bölüm üretmek (CLI)

```bash
pnpm ys episode new --topic "Osmanlı'da kahvehane yasakları" --lang tr --minutes 3 --tier economy --budget 5
pnpm ys episode run <id>                    # tüm aşamalar; hata olursa aynı komutla kaldığı yerden devam
pnpm ys episode run <id> --until script     # sadece hikâye + senaryo (görsel/ses için para harcamaz)
pnpm ys episode run <id> --from keyframes   # görselleri yeniden üret
pnpm ys episode show <id>
pnpm ys cost --episode <id>
```

Aşamalar: `style → story → script → [onay] → cast → concept → [onay] → voice → shots → keyframes → clips → timeline → render`.
CLI varsayılan olarak onaylarda durmaz ve ilk adayları seçer. `--manual` ile durur: `episode approve <id> script|concept`, `episode select <id> c1=2`, `episode preview <id>`.
`--motion animated|mixed|still` hareket modunu belirler.
`--clips 0.2` çekimlerin ~%20'sini gerçek AI video yapar (varsayılan 0, yani en ucuz: sadece hareketlendirilmiş resim).
`--vertical` 9:16 üretir.

Gerçek ölçüm (3 dakikalık Türkçe bölüm): stil + hikâye + senaryo ajanları **$0.24**, ~90 sn.

## Tek tek üretim

```bash
pnpm ys plan --cap i2v --duration 5 --tier economy   # para harcamadan sağlayıcı sıralaması
pnpm ys image --prompt "paper-cut fox in a misty forest"
pnpm ys video --image fox.png --prompt "slow push-in" --duration 5 --episode ep1 --budget 3
pnpm ys tts --text "Merhaba..." --lang tr
```

Aynı istek ikinci kez ödenmez (içerik hash'i ile önbellek). Yeniden üretmek için `--no-cache` veya farklı `--seed` ver.

## Trigger.dev

```bash
cd apps/worker
npx trigger.dev@4.8.2 login   # bir kez
# .env: TRIGGER_PROJECT_REF=proj_...
pnpm dev                      # yerel worker; task: run-episode { episodeId }
```

## Komutlar

| Komut | Ne yapar |
|---|---|
| `pnpm typecheck` | TypeScript 7 kontrolü |
| `pnpm test` | Birim testleri (Vitest 5) |
| `pnpm test:integration` | Postgres + RustFS testleri (Docker gerekli) |
| `pnpm ys …` | CLI |
| `pnpm db:generate` / `db:migrate` | Drizzle migration |
| `pnpm infra:up` / `infra:down` | Docker altyapısı |
