# YoutubeStudio

[English](README.md) · **Türkçe**

Tek bir konudan çok dilli, animasyon ağırlıklı YouTube videoları üreten bir AI video fabrikası. Hikâyeyi ve senaryoyu Claude ajanları yazar; çekimleri planlar, vektör çizimleri tasarlar ve kendi çıktılarını denetler. Ses, görsel ve video kliplerini ücretli medya API'leri üretir, son kurguyu Remotion render eder. Web tabanlı Stüdyo her adımda ne olduğunu gösterir ve son kararı insana bırakır.

Mimari, sağlayıcı seçimi ve yol haritası: [docs/PROJE_PLANI.md](docs/PROJE_PLANI.md). Sürüm geçmişi: [CHANGELOG.md](CHANGELOG.md).

## Özellikler

- **Konudan bitmiş videoya.** Pipeline şu aşamalardan geçer: stil → hikâye → senaryo → *onay* → kadro → konsept → *onay* → ses → çekimler → kareler → klipler → kurgu → render → inceleme. Her aşama idempotent'tir ve her alt adımdan sonra kaydeder; hata alan çalıştırma kaldığı yerden devam eder.
- **Dört hareket modu:**
  - `vector`: Claude'un çizdiği iskeletli SVG karakterler, hareketleri kodda. En ucuz mod.
  - `still`: Ken Burns hareketli görseller.
  - `mixed`: bazı çekimler AI video klibi olur.
  - `animated`: her çekim AI video klibi olur.
- **Kalite kapısı.** Hiçbir SVG denetlenmeden kullanılmaz:
  1. Çizimden önce bir planlayıcı ajan referans görsellere bakar ve tarifi somut bir çizim planına çevirir.
  2. Kör denetçi, çizimin adını bilmeden ne gördüğünü söyler.
  3. Kapı ajanı çizimin ne kadar tanınır olduğunu ve referanslara ne kadar sadık olduğunu puanlar.
  4. Geçemeyen çizim kusur listesiyle yeniden çizilir. Yine geçemezse kullanılmaz.
- **Gerçeğe dayalı.** Gerçek özneler Wikipedia ve Wikimedia Commons'ta bulunan referans görsellere bakılarak çizilir. Nesneler için önce Commons'taki kamu malı/CC0 hazır vektör çizimler denenir; ancak aynı kalite kapısından geçerse kullanılır. Harita ve bayrakları Claude çizmez; gerçek veriden üretilir (world-atlas, flag-icons).
- **Son söz insanın.** Stüdyo'da kapının reddettiği bir çizimi kabul edebilir, geçirdiğini de tasarımcıya bir notla reddedebilirsin. Gerçeklik denetimini bir bölüm için kapatabilirsin.
- **24 hazır stil paketi.** Örneğin düz anlatım, Osmanlı minyatürü, kara film, teknik çizim, ukiyo-e, synthwave, kara tahta, suluboya ve 8-bit piksel. *Otomatik* modda ucuz bir ajan konuya uyan paketi seçer; istersen kendin seçebilir ya da *Özel* ile sanat yönetmenine serbest tasarım yaptırabilirsin. Paket renkleri, çizim kurallarını ve çizgi stilini sabitler; aynı paketteki bölümler aynı elden çıkmış görünür. Liste için: `pnpm ys styles`.
- **Karakterleri tekrar kullanma.** Onaylı karakterler kimlikleriyle birlikte kütüphanede tutulur. Aynı kişi aynı stilde yeniden geçerse (ör. gerçek bir tarihî kişi ya da kanalın sunucusu) casting ajanı çizimi yeniden çizdirmek yerine tekrar kullanır. Stüdyo'da *Kütüphaneden kullan* ile kendin de seçebilirsin. Liste için: `pnpm ys library`.
- **Seriler.** Bölümler bir seriye ait olabilir. Ana sayfa seriye göre filtreler. Var olan bir seriye eklenen yeni bölüm serinin ayarlarını ve stil paketini devralır; tekrar kullanım için önce o serinin karakterleri önerilir. CLI'da `--series "Ad"`.
- **Öğrenme döngüsü.** Her render'dan sonra kareler incelenir; çıkan dersler sonraki bölümlerin uyduğu kural defterine yazılır.
- **Önce maliyet.** Para harcanmadan önce tahmin gösterilir. İstekler içerik hash'iyle önbelleğe alınır, aynı istek iki kez ödenmez. Bölüm bütçe tavanı ücretli görsel, ses ve video API'leri içindir. Claude ajan çağrıları ayrıca gösterilir ve tavana sayılmaz.
- **Ajan başına model seçimi.** Stüdyo'nun **Modeller** sayfasından her ajanın hangi Claude modeliyle çalışacağını seçersin (ör. kalite kapısı için Haiku yerine Sonnet).
- **İki dilli Stüdyo.** Arayüz Türkçe ve İngilizce. Videolar ses sağlayıcısının desteklediği her dilde üretilebilir.

## Gereksinimler

- Node.js 24 veya üstü ve pnpm 11
- FFmpeg (yerel render testi için)
- Claude: oturum açılmış bir Claude Code kurulumu (abonelik) ya da `ANTHROPIC_API_KEY`
- İsteğe bağlı API anahtarları: fal, Gemini, ElevenLabs. Anahtarı olmayan sağlayıcı devre dışı kalır.

## Kurulum

```bash
pnpm install
cp .env.example .env          # elindeki anahtarları doldur; boş olan sağlayıcılar devre dışı kalır
pnpm ys providers             # hangi sağlayıcılar etkin?
pnpm ys render-demo           # API'siz: yerel Remotion render testi
```

Docker'sız çalışır. Varlıklar `.data/assets`, maliyet defteri `.data/ledger.jsonl`, videolar `.data/episodes` altına yazılır. Bunların yerine Postgres 18, Redis 8 ve RustFS (S3) kullanmak için:

```bash
pnpm infra:up                 # portlar: 5433 (pg), 6380 (redis), 9000/9001 (rustfs)
pnpm db:migrate
pnpm test:integration
# .env: STORE=s3, LEDGER=db
```

## Stüdyo (önerilen)

```bash
pnpm studio                   # geliştirme: http://localhost:3100
pnpm studio:build && pnpm studio:start   # production derlemesi, aynı port
```

1. **Yeni bölüm.** Üst menünün başındaki **Yeni bölüm** düğmesine tıkla; form tam genişlikte kendi sayfasında açılır. Konuyu gir; dili, süreyi, hareket modunu, çizgi stilini, sesi, bütçeyi, gerçeklik denetiminin açık olup olmayacağını ve altyazının videoya gömülüp gömülmeyeceğini seç. Her hareket modu kartı kendi tahmini maliyetini gösterir; sağdaki panel seçilen modu aşama aşama döker.
2. **Senaryo.** Sahneleri düzenle ve onayla.
3. **Konsept.** Karakterler ve mekânlar seçilip çizilir. Kalite kapısı paneli her çizimi referanslarıyla, puanlarıyla, kusurlarıyla ve çizim planıyla gösterir. Kabul et, reddet ya da notla yeniden çizdir.
4. **Üretim.** Pipeline şeridi, canlı panel ve etkinlik günlüğü her ajan çağrısını modeli, maliyeti ve süresiyle gösterir. Çekimler sekmesi render'dan önce her çekimin önizleme karesini gösterir.
5. **İzle ve indir:** videoyu, `.srt` altyazı dosyasını ve incelemesini gör. Altyazı her zaman videonun yanına `.srt` olarak yazılır; videoya gömülmesi bölüm başına bir anahtardır (değiştirmek yalnız render'ı tekrarlar, ücretsizdir).

Ekran yazıları tek düzende: mekân, tarih ve olay satırları sol üstte sabit bir bilgi kartında, kişi etiketleri kişinin yanında; hepsi aynı yazı tipi ve plaka stiliyle.

Diğer sayfalar:

- **Maliyetler:** harcama defteri.
- **Fiyatlar:** sağlayıcı fiyatları.
- **Dersler:** öğrenilmiş kural defteri.
- **Kurallar:** Stüdyo kuralları, kodun kullandığı aynı sabitlerden okunur.
- **Modeller:** her ajanın modeli.

Ağır işler Stüdyo sunucusunda değil, ayrı bir CLI sürecinde çalışır. Bu yüzden CLI'dan başlatılan çalıştırmalar da Stüdyo'da canlı görünür.

## CLI

```bash
pnpm ys episode new --topic "Osmanlı'da kahvehane yasakları" --lang tr --minutes 3 --motion vector --budget 5
pnpm ys episode run <id>                    # tüm aşamalar; hatadan sonra tekrar çalıştırınca kaldığı yerden devam eder
pnpm ys episode run <id> --until script     # yalnız hikâye + senaryo (görsel ve ses için para harcamaz)
pnpm ys episode run <id> --from keyframes   # bir aşamadan itibaren yeniden üretir
pnpm ys episode show <id>
pnpm ys cost --episode <id>
pnpm ys plan --cap i2v --duration 5         # para harcamadan sağlayıcı sıralaması
pnpm ys version
```

`episode new` için işe yarar seçenekler:

- `--motion animated|mixed|still|vector`
- `--style-pack auto|custom|<paket>` (liste: `pnpm ys styles`)
- `--line outline|flat|sketch|ink` (varsayılan: paketin çizgi stili)
- `--manual`: onaylarda durur.
- `--no-qa`: kare denetimini kapatır.
- `--no-realism`: gerçeklik denetimini kapatır.
- `--side-views`: yalnız vektör modunda. Yürüyen karakterlere ikinci, yandan bir çizim yapılır ve yürürken ona döner. Her biri bir tasarımcı çağrısı ve kapı denetimi tutar (~$0,15–0,35), kütüphanede saklanır.
- `--vertical`: 9:16 render eder.

Karakter bankası (vektör modu): onaylanan her karakter kütüphanede saklanır ve Stüdyo'nun **Karakterler** sayfasında görünür. Orada Claude'a konudan bağımsız bir karakter çizdirebilirsin (sunucu, bilim insanı, çocuk…; tanesi ~$0,15–0,35, kalite kapısından geçer) ve herhangi bir karakteri seri maskotu yapabilirsin. Bölüm açarken bankadan bir karakteri ekrandaki sunucu seçebilirsin (anlatımı o konuşur, çekimlerin çoğunda görünür) ya da kadroya ekleyebilirsin. Seçilenler yeniden çizilmez; bölüm onların stil paketine geçer. CLI: `pnpm ys bank [list|add|mascot]`, `episode new --presenter <kimlik> --with <kimlik,kimlik>`.

Hepsi için: `pnpm ys --help`.

## Yapılandırma

Anahtarlar ve ayarlar `.env` dosyasında durur (bkz. `.env.example`). Önemlileri:

| Değişken | Ne işe yarar |
|---|---|
| `FAL_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` | Medya sağlayıcıları. Anahtar boşsa o sağlayıcı devre dışı kalır. |
| `ANTHROPIC_API_KEY` | Claude ajanları. Boşsa Claude Code girişi kullanılır. |
| `YS_MODEL_CREATIVE` / `_FAST` / `_CHEAP` | Her sınıfın varsayılan modeli. Modeller sayfasındaki ajan başına seçimler bunları ezer. |
| `STORE=s3`, `LEDGER=db` | Yerel dosyalar yerine S3 ve Postgres kullanır. |
| `YS_UPDATE_CHECK=0` | Stüdyo'nun güncelleme kontrolünü kapatır. |

## Sürümler ve güncelleme

Sürüm kök `package.json` dosyasındadır. Stüdyo başlığında görünür; `pnpm ys version` da gösterir.

Stüdyo 6 saatte bir GitHub'daki son release'e bakar. Daha yeni bir sürüm varsa sürüm notlarına bağlantı veren bir uyarı şeridi çıkar. Güncellemek için:

```bash
git pull && pnpm install && pnpm studio:build   # sonra pnpm studio:start ile yeniden başlat
```

Release çıkarmak için (bakımcılar):

```bash
pnpm release patch|minor|major              # sürüm artırma, CHANGELOG, commit ve etiket (yalnız yerelde)
pnpm release minor --publish                # ayrıca push eder ve GitHub release'i açar
pnpm release minor --dry-run                # notları önizler
```

Release betiği yalnız `main` dalında, commit edilmemiş değişiklik yokken, typecheck ve testler geçtikten sonra çalışır.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `pnpm studio` / `studio:build` / `studio:start` | Stüdyo, geliştirme ya da production modunda |
| `pnpm ys …` | CLI |
| `pnpm typecheck` | TypeScript 7 kontrolü |
| `pnpm test` | Birim testleri (Vitest) |
| `pnpm test:coverage` | Kapsamlı birim testleri; satır/dal/fonksiyon/ifade %100 altına düşerse başarısız |
| `pnpm test:integration` | Postgres ve RustFS testleri (Docker gerekir) |
| `pnpm release` | Sürüm artırma, değişiklik günlüğü ve etiket |
| `pnpm db:generate` / `db:migrate` | Drizzle migration'ları |
| `pnpm infra:up` / `infra:down` | Docker altyapısı |

## Lisans

[MIT](LICENSE) © 2026 Ersin KOÇ.

Üçüncü taraf parçalar kendi şartlarına tabidir. Özellikle render motoru [Remotion](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) bireyler, kâr amacı gütmeyen kuruluşlar ve en çok 3 çalışanlı şirketler için ücretsizdir; daha büyük şirketlerin Remotion şirket lisansı alması gerekir. Üretilen medya her sağlayıcının (fal, Google, ElevenLabs) şartlarına, referans görseller kendi Wikimedia lisanslarına tabidir.

## Depo yapısı

| Yol | İçerik |
|---|---|
| `packages/core` | Paylaşılan Zod şemaları, mikro-dolar para birimi, kalite kapısı kuralları, model rolleri, sürümler |
| `packages/media-gateway` | Her ücretli üretim çağrısı: maliyet ve kalite router'ı, önbellek, bütçe tavanı, yedek sağlayıcı |
| `packages/agents` | JSON şema çıktılı Claude Agent SDK ajanları |
| `packages/pipeline` | Bölüm durum makinesi ve aşamalar, referanslar, harita ve bayrak üretimi, tahminler |
| `packages/video` | Remotion kompozisyonları, vektör sahne çizicisi dahil |
| `packages/storage`, `packages/db` | Yerel ya da S3 varlık deposu; Postgres maliyet defteri |
| `apps/studio` | Next.js Stüdyo |
| `apps/cli` | `pnpm ys` |
| `apps/worker` | Trigger.dev task'ı (isteğe bağlı) |
