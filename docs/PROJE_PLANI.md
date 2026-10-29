# YoutubeStudio — AI Video Fabrikası: Proje Planı

> Sürüm: v0.2 · Tarih: 29 Ekim 2026
> Hedef: Niş konularda fikir üretip 8–20 dakikalık, animasyon ağırlıklı, içi tutarlı (karakterli veya özgün) YouTube videolarını **istenen her dilde** yarı otomatik üreten fabrika. Kapsam **maksimum**: çok dil, çok kanal, karakterli ve özgün mod, tüm bütçe seviyeleri, Shorts türevleri.

---

## 0. Yönetici Özeti

- **Tek dil, uçtan uca TypeScript.** Next.js stüdyo arayüzü, Trigger.dev ile uzun süren işler, Claude Agent SDK ile "yaratıcı ekip" ajanları, Remotion ile montaj ve render.
- **Sesten başla, görüntüyü sese oturt.** Önce senaryo seslendirilir. Kelime zaman damgaları timeline'ı belirler. Görseller ve klipler bu iskelete göre üretilir. 8–20 dakikalık videolarda senkronu koruyan yöntem bu.
- **Her saniye AI video olmamalı.** 12 dakikalık bir videoda yaklaşık %50 hareketlendirilmiş görsel (parallax veya Ken Burns), %20–30 AI video klip, %15 Remotion motion-graphics ve gerektiğinde %5–10 konuşan karakter. Maliyet bu sayede 10 kat düşer, tutarlılık artar.
- **Sağlayıcıdan bağımsız "Media Gateway".** Modeller her ay değişiyor. Sora 2 API'si 24 Eylül 2026'da kapandı. Her model bir adapter, her çekim bir "yetenek isteği" olarak tanımlanır. Router maliyet, kalite ve tutarlılık ihtiyacına göre seçer, hata olursa yedeğe düşer.
- **Tutarlılık bir sistem işi, prompt işi değil.** Karakter kimlik paketi, stil kitabı, mekân kitabı, süreklilik defteri, çekimden çekime son kare → ilk kare zincirleme ve Claude vision ile otomatik QA puanlaması.
- **İnsan onay kapıları.** Fikir, senaryo, karakter/keyframe ve final aşamalarında onay var. Hem kalite hem de YouTube'un "inauthentic content" politikası için bu şart.
- **Dilden bağımsız görsel master + dil katmanları.** Görüntü bir kez üretilir. Senaryo her dile çevrilmez, **yeniden yazılır** (kültürel uyarlama). Ses, altyazı, ekrandaki yazılar, başlık ve thumbnail dil başına üretilir. Ek dil maliyeti video başına yaklaşık **$5–12**.

---

## 1. Araştırma Bulguları (Ekim 2026 durumu)

> Fiyatlar çoğunlukla üçüncü taraf kaynaklardan. Bütçe kesinleşmeden önce resmi fiyat sayfaları kontrol edilmeli (Faz 0'da `pricing-check` görevi).

### 1.1 Video üretim modelleri

| Model | Güçlü yanı | Tutarlılık araçları | Yaklaşık fiyat | Rolü |
|---|---|---|---|---|
| **Kling 4.0** (YENİ, ~15 Eki 2026) | 3–30 sn, 4K, stereo ses, 10 keyframe | **Omni Reference ≤15**, ilk/son kare | API kademeli açılıyor, fiyat belirsiz | Doğrulanınca **ana iş atı** |
| **Seedance 2.5** (YENİ, Ağu 2026) | 30 sn native, uzun anlatı, zaman damgalı düzenleme | **50 referansa kadar** (30 görsel + 10 video + 10 ses) | Volcano/BytePlus, doğrulanmadı | Karakterli uzun sahneler için en güçlü aday |
| **Wan 3.0** (Alibaba, Ağu 2026) | 30 sn, omni-reference, native ses. **Açık ağırlık yok** | Omni-reference | ~$0.20/sn 1080p | Alternatif ana model |
| **Hailuo 3 / MiniMax H3** | Hareket fiziği, ucuz | Referans | ~$0.05–0.08/sn (2.3) | Ucuz aksiyon |
| **Vidu Q3**, **PixVerse V6** | Ucuz, hızlı, 1080p | Referans | ~$0.04–0.08/sn | Taslak/animatik, b-roll |
| **Luma Ray 3 / 3.2** | Sinematik ışık, HDR | Keyframe | ~$0.06–0.12/sn | Atmosfer çekimleri |
| **Kling 3.0 / O3 (Omni)** | Fiyat/performans lideri, sinematik, çoklu çekim | **Elements** (karakter referansı, toplam ≤10 ref), başlangıç+bitiş karesi, video referansı | 1080p: ~$0.112/sn sessiz, ~$0.168/sn sesli | Kanıtlanmış iş atı (bugün) |
| **Seedance 2.0 (ByteDance)** | Çok modlu referans: 9 görsel + 3 video + 3 ses | reference-to-video, @-referans sözdizimi | 720p ~$0.23/sn (rota bağlı) | Karakterli, çok referanslı sahneler |
| **Veo 3.1 (Google)** | En iyi kalite + native ses, 4K | ≤3 referans görsel, ilk/son kare, **extend** | Std ~$0.40/sn, Fast ~$0.15/sn, Lite daha ucuz | Premium/hero çekimler, uzatma |
| **Gemini Omni 1.1 Flash** | Her şeyden her şeye, 720p, native ses | Çok modlu girdi | Doğrulanmadı | Deneysel, izlemede |
| **Runway Gen-4.5 / Turbo** | Stabil, kontrol araçları | Referanslar | ~$0.12/sn, Turbo ~$0.05/sn | Yedek |
| **Wan 2.2 / LTX-2.3 (açık kaynak)** | Yerelde bedava, LTX native ses | LoRA, ComfyUI | GPU maliyeti | Ucuz b-roll, iterasyon |
| ~~Sora 2~~ | — | — | **API 24.09.2026'da kapandı** | **Kullanılmayacak** |

### 1.2 Görsel üretim (keyframe, karakter sayfası, thumbnail)

| Model | Not | Fiyat (yaklaşık) |
|---|---|---|
| **Nano Banana Pro (Gemini 3 Pro Image)** | En iyi çoklu referans + metin yazımı (thumbnail). 14+ referans | ~$0.134 (1K/2K), $0.24 (4K) |
| **Nano Banana 2 (Gemini 3.1 Flash Image)** | Hızlı/ucuz, çok referanslı | ~$0.07–0.10 |
| **FLUX.2 (BFL)** | API'de 8 referans, LoRA eğitimi, stil kontrolü | ~$0.03–0.07/MP |
| **FLUX Kontext** | Talimatla düzenleme (aynı karakter, farklı poz) | ~$0.04 |
| **GPT Image 2.x (OpenAI)** | Tipografi, hero görseller | — |

**Karar:** Keyframe'lerde Nano Banana Pro/2 ve FLUX.2 kullanılacak. Kalıcı maskot karakter için FLUX LoRA eğitilecek (20–50 görsel, bir kez).

### 1.3 Ses

| İhtiyaç | Seçim | Not |
|---|---|---|
| Anlatım / diyalog | **ElevenLabs Eleven v3** (`eleven_v3`, Şubat 2026'da GA) | 70+ dil, Türkçe dahil. Çok konuşmacılı diyalog, duygu etiketleri. **with-timestamps** ile kelime hizalama |
| Hızlı / ucuz TTS | ElevenLabs Flash/Turbo | ~$0.05/1k karakter |
| Müzik | **Eleven Music v2** (resmi API, ticari lisans) | ~$0.80/dk (fal) |
| SFX | ElevenLabs `eleven_text_to_sound_v2` | ~$0.12/dk |
| Lip-sync | **sync.so lipsync-2-pro** | ~$0.05/sn. Alternatif: VEED Fabric, Hedra |
| ~~Suno~~ | **Resmi API yok** (2026). Ticari haklar davalık | **Kullanılmayacak** |

### 1.4 Montaj / Render

- **Remotion 4.0.4xx** (neredeyse her gün sürüm çıkıyor). React ile programatik video. Studio'da interaktif keyframe/easing editörü var, ElevenLabs voiceover **agent skill'i** de mevcut.
- Lisans: 3 kişiye kadar şirketler ve bireyler için **ücretsiz**. 4+ kişide Company License, otomasyon için "Automators": **$0.01/render, en az $100/ay**.
- Render: yerelde (`@remotion/renderer`) veya Remotion Lambda. 12 dakikalık 1080p video yerelde 64 GB RAM ve iyi CPU ile yaklaşık 10–25 dk sürer.
- *Claude Motion* (Anthropic, 8 Ekim 2026 beta): kod tabanlı açıklayıcı animasyon, MP4 export. Team/Enterprise planlarına özel, API'si yok. Fabrikaya entegre edilmez, motion-graphic fikirleri için ilham kaynağı olabilir.

### 1.5 Ajan altyapısı (Claude)

- **Claude Agent SDK (TypeScript)**: Claude Code'un harness'ı kütüphane olarak. Subagent'lar, skill'ler (`.claude/skills`), in-process MCP araçları (`createSdkMcpServer`) ve yapılandırılmış çıktı sunar. Pipeline'daki tüm "beyin" işleri bununla yapılır.
- **ACP (Agent Client Protocol)**: Resmi adapter `@agentclientprotocol/claude-agent-acp`. Stüdyo arayüzünden etkileşimli bir Claude Code oturumu açmak için kullanılır ("bu sahneyi yeniden yaz", "bu Remotion bileşenine parallax ekle"). İzin istekleri, diff/edit review ve terminal desteği var.
- **`claude -p` (headless)**: Tek atımlık CLI işleri için. CI'da `--bare` kullanılmalı.
- **Faturalama uyarısı:** Kaynaklara göre 15 Haziran 2026'dan itibaren abonelik planında SDK ve `claude -p` kullanımı ayrı bir kredi havuzundan düşüyor (doğrulanmadı). Fabrika üretimi **API anahtarı** ile çalışmalı. Max aboneliği geliştirme ve etkileşimli kullanım için kalır.
- Model dağılımı: **Opus 5.5** hikâye, senaryo, yönetmenlik ve QA kararları için. **Sonnet 5.5** shot-list, prompt üretimi, Remotion kodu için. **Haiku 5.5** sınıflandırma, etiketleme ve toplu kontroller için. Prompt caching (stil/karakter kitapları) zorunlu.

### 1.6 YouTube tarafı

- **Politika:** 15 Temmuz 2025'te "repetitious" kuralı **"inauthentic content"** adını aldı. AI serbest. Hedeflenen şey seri üretim, şablon ve tekrar. Değerlendirme **kanal seviyesinde** yapılıyor. → Fabrikada **çeşitlilik motoru** ve **editoryal katkı** (insan onayı, özgün analiz, hikâye) mimari gereksinim.
- **İfşa:** Gerçekçi sentetik içerikte "altered or synthetic" etiketi (API'de `status.containsSyntheticMedia`). Çizgi film ve açıkça animasyon olan içerik genelde muaf. Etiketin para kazanmaya etkisi yok.
- **Data API:** Yeni projede günlük 100 `videos.insert` ve 10.000 birim. **Doğrulanmamış projeden yüklenen videolar private kalır**, bu yüzden OAuth doğrulaması ve compliance audit Faz 0'da başlatılmalı (haftalar sürebilir).

---

## 2. Gerekli Abonelikler ve API'ler

| # | Servis | Neden | Plan önerisi | Öncelik |
|---|---|---|---|---|
| 1 | **Anthropic API** (Console) | Agent SDK ajanları | Pay-as-you-go + prompt caching | Zorunlu |
| 2 | Claude Max | Geliştirme (Claude Code), ACP etkileşimi | Mevcut | Zorunlu |
| 3 | **fal.ai** | Tek anahtar: Kling 3.0/O3, Seedance 2.0, Veo 3.1, FLUX.2, Nano Banana, LoRA eğitimi, LTX | Kredi yüklemeli | Zorunlu |
| 4 | **Google AI Studio / Vertex (Gemini API)** | Veo 3.1 (extend, ilk/son kare), Nano Banana Pro direkt, Gemini Omni | Paid tier | Zorunlu |
| 5 | **ElevenLabs** | v3 TTS, ses tasarımı/klon, Music, SFX | **Pro veya Scale** (API + ticari lisans) | Zorunlu |
| 6 | **sync.so** | Konuşan karakter lip-sync | Kullandıkça öde | Karakterli kanallar için |
| 7 | Kling API (direkt) | Hacim büyüyünce fal'dan ucuz | Paket | Ölçeklenince |
| 8 | BytePlus ModelArk | Seedance direkt | Kullandıkça öde | Opsiyonel |
| 9 | Runway API | Yedek video sağlayıcısı | Kredi | Opsiyonel |
| 10 | **Remotion** | Render | ≤3 kişi ücretsiz. Büyürsen Automators | Zorunlu |
| 11 | **Cloudflare R2** | Varlık deposu (çıkış trafiği ücretsiz) | Kullandıkça öde | Zorunlu |
| 12 | **Trigger.dev** | Dayanıklı uzun işler | Self-host (Apache 2.0) veya Cloud | Zorunlu |
| 13 | PostgreSQL | Veri | Yerel/Docker → Neon/Supabase | Zorunlu |
| 14 | **Google Cloud projesi** | YouTube Data API v3 + Analytics API, OAuth doğrulama | Ücretsiz + audit | Zorunlu |
| 15 | GPU (yerel RTX 4090/5090 veya RunPod) | ComfyUI: Wan 2.2, LTX-2.3, upscale, frame interpolation | Opsiyonel | Faz 5 |
| 16 | **İkinci agregatör** (Runware, WaveSpeed veya Kie.ai) | fal kesintisinde yedek + fiyat rekabeti | Kullandıkça öde | Faz 2 |
| 17 | **Higgsfield** (API + MCP) | Soul ID / Cinema Studio, Claude Code'dan MCP ile etkileşimli deneme | Kredili plan (krediler ~90 günde bitiyor) | Opsiyonel |
| 18 | Volcano Engine / BytePlus | Seedance 2.5 direkt (30 sn, 50 referans) | Kurumsal başvuru gerekebilir | Faz 2 |

Tüm pazar haritası ve konumlandırma için bkz. **§17**.

**Kullanılmayacaklar:** Sora (kapandı), Suno (resmi API yok, hukuki risk), HeyGen (lip-sync odaklı geliştirici API'si yok).

---

## 3. Sistem Mimarisi

```
┌──────────────────────────── STUDIO (Next.js 16 + React 19) ─────────────────────────────┐
│ Kanal/Niş paneli · Fikir havuzu · Senaryo editörü · Karakter/Stil kitapları ·           │
│ Shot board · Timeline önizleme (@remotion/player) · Onay kapıları · Maliyet paneli ·    │
│ "Claude ile düzenle" paneli (ACP → claude-agent-acp)                                     │
└───────────────▲───────────────────────────────┬──────────────────────────────────────────┘
                │ realtime ilerleme              │ tRPC/Server Actions
┌───────────────┴───────────────────────────────▼──────────────────────────────────────────┐
│                      ORKESTRATÖR (Trigger.dev v4 tasks, idempotent adımlar)              │
│  ideate → story → script → voice → align → shotplan → bibles → keyframes → motion →     │
│  audio-mix → assemble → render → QA → package → publish → analytics                     │
└──────┬──────────────────┬──────────────────────┬─────────────────────┬───────────────────┘
       │                  │                      │                     │
┌──────▼───────┐  ┌───────▼────────┐   ┌─────────▼─────────┐  ┌────────▼─────────┐
│ AGENT LAYER  │  │ MEDIA GATEWAY  │   │ RENDER ENGINE     │  │ PUBLISHER        │
│ Claude Agent │  │ capability     │   │ Remotion 4 comps  │  │ YouTube Data API │
│ SDK ajanları │  │ router, cache, │   │ + FFmpeg post     │  │ + Analytics API  │
│ + MCP araçları│ │ cost ledger,   │   │ yerel / Lambda    │  │                  │
│ (vision QA)  │  │ fallback       │   └───────────────────┘  └──────────────────┘
└──────────────┘  └─┬──┬──┬──┬──┬─┘
                    │  │  │  │  └ comfyui (yerel GPU: Wan/LTX)
                    │  │  │  └ syncso
                    │  │  └ elevenlabs
                    │  └ gemini (Veo/NanoBanana/Omni)
                    └ fal (Kling/Seedance/FLUX/LTX…)
        Postgres (Drizzle) · Cloudflare R2 (varlıklar) · Redis (rate limit/kuyruk kilidi)
```

### 3.1 Monorepo yapısı (pnpm + Turborepo)

```
YoutubeStudio/
├─ apps/
│  ├─ studio/               # Next.js 16 arayüz
│  └─ worker/               # Trigger.dev task'ları (pipeline aşamaları)
├─ packages/
│  ├─ core/                 # Zod şemaları: Channel, Character, Episode, Shot, Timeline…
│  ├─ db/                   # Drizzle şema + migration
│  ├─ agents/               # Claude Agent SDK ajanları, prompt'lar, MCP araçları
│  ├─ media-gateway/        # Provider adapter'ları + router + cost ledger + cache
│  │  └─ providers/ fal/ gemini/ kling/ elevenlabs/ syncso/ runway/ comfyui/
│  ├─ video/                # Remotion projesi: kompozisyonlar, sahne tipleri, efekt kütüphanesi
│  ├─ audio/                # Mix, ducking, LUFS normalizasyon, hizalama
│  ├─ qa/                   # Teknik ve görsel QA kontrolleri
│  └─ youtube/              # Upload, metadata, analytics
├─ .claude/
│  ├─ skills/               # remotion, shot-planning, prompt-styles, continuity… (ajanlar da kullanır)
│  └─ agents/               # Claude Code subagent tanımları
└─ docs/
```

---

## 4. Veri Modeli (çekirdek)

```ts
Channel      { id, name, niche, language, audience, tone, styleBibleId, voiceProfile, defaultCharacterIds[], formatRules }
StyleBible   { id, artStyle, palette[hex], lighting, lensLanguage, negativeRules, refImages[], loraId?, promptPrefix }
Character    { id, name, description, turnaround[] (6–8 açı), expressions[], outfits[], palette, loraId?,
               klingElementId?, voiceId, mannerisms, doNotChange[] }
Location     { id, name, refImages[], timeOfDayVariants, props[] }
Idea         { id, channelId, title, angle, hookOptions[], score{demand,competition,fit,novelty}, status }
Episode      { id, ideaId, targetDurationSec, mode: "character" | "original", status, budgetTier, budgetCap, costSoFar,
               sourceLang, targetLangs[], publishMode: "multi_audio" | "per_channel" }
LanguageVersion { episodeId, lang, script, voiceTrack, timingMap, textLayer, captions, metadata, thumbnailId, renderId, status }
Story        { premise, logline, beats[] {id, purpose, retentionHook, approxSec} }
Script       { scenes[] { id, beatId, locationId, characters[], lines[] {speaker, text, emotion} } }
VoiceTrack   { audioUrl, words[] {text, startMs, endMs}, perSceneRanges }
Shot         { id, sceneId, startMs, endMs, minMs, maxMs, kind, description, camera, characters[], locationId,
               continuity {outfit, props, lighting}, keyframeAssetId?, clipAssetId?, chainFromShotId?,
               providerHint?, qaScore?, attempts }
Asset        { id, type, url(R2), provider, model, prompt, refs[], seed, cost, contentHash, parentId, approved }
Timeline     { episodeId, fps, width, height, tracks: { video[], overlays[], captions[], voice, music[], sfx[] } }  // = Remotion inputProps
CostEntry    { episodeId, stage, provider, units, unitPrice, total, at }
```

`Shot.kind` sahne tipleri:
- `still_motion`: keyframe + parallax/Ken Burns (2.5D derinlik haritası ile, Remotion'da)
- `ai_clip`: keyframe → i2v (Kling/Seedance/Veo)
- `chained_clip`: önceki çekimin son karesinden başlar (süreklilik)
- `talking_character`: karakter klibi + lip-sync
- `motion_graphic`: tamamen Remotion (harita, grafik, metin, diyagram, zaman çizelgesi)
- `title_card` / `transition`

---

## 5. Üretim Hattı (aşama aşama)

| # | Aşama | Kim / Ne | Çıktı | Kapı |
|---|---|---|---|---|
| 0 | **Niş ve fikir** | *Scout* ajanı: YouTube Data API (rakip kanallar, görüntülenme/abone oranı, yükleme sıklığı), web araması, kanal geçmişi. Puanlama: talep, rekabet, kanal uyumu, **yenilik** | Fikir havuzu, açı ve hook seçenekleri | 👤 Fikir onayı |
| 1 | **Hikâye** | *Story Architect* (Opus): premise, logline, beat sheet. 8–20 dk için **retention yapısı**: 0–30 sn hook, her 60–90 sn'de yeniden hook, açık döngüler, orta noktada dönüş | Story + beats | — |
| 2 | **Senaryo** | *Screenwriter* (Opus): anlatım ve diyalog, duygu etiketleri. Dakikada ~150 kelime → 12 dk ≈ 1.800 kelime. *Critic* ajanı ile 1–2 revizyon turu | Script | 👤 Senaryo onayı |
| 3 | **Ses** | ElevenLabs v3 with-timestamps, sahne başına ayrı üretim (yeniden üretim ucuz kalsın), konuşmacı başına sabit voiceId | VoiceTrack + kelime zamanları | — |
| 4 | **Çekim planı** | *Director* (Opus/Sonnet): ses zamanlarına göre shot list, kind dağılımı, kamera dili, `chainFromShotId`. **Bütçe kısıtı** burada uygulanır | Shot[] | — |
| 5 | **Kitaplar** | *Art Director*: stil kitabı. *Character Designer*: turnaround ve ifade sayfası, gerekirse LoRA veya Kling Element. Kanal başına bir kez | StyleBible, Character, Location | 👤 İlk kez onay |
| 6 | **Keyframe** | Media Gateway (Nano Banana Pro / FLUX.2, referanslarla). *Continuity Supervisor* (Claude vision) karakter benzerliği, stil, süreklilik defteri ve anatomi için 0–10 puan verir. Eşik altı otomatik yeniden üretilir (en fazla 3) | Onaylı keyframe'ler | 👤 Shot board hızlı onay |
| 7 | **Hareket** | i2v: Kling 3.0 (varsayılan), Seedance 2.0 (çok karakter/referans), Veo 3.1 (hero ve extend). Zincirli çekimlerde önceki klibin son karesi → ilk kare. Klip QA: kare örnekleme + vision | Klipler | — |
| 8 | **Ses tasarımı** | Müzik (Eleven Music, sahne duygusuna göre bölümler), SFX listesi (Director'dan), ducking, **-14 LUFS** | Mix stemleri | — |
| 9 | **Montaj** | Timeline JSON → Remotion kompozisyonu. *Editor* ajanı gerekirse özel motion-graphic bileşeni yazar (Claude Code + Remotion skill'leri). Altyazılar `@remotion/captions` ile | Timeline + kompozisyon | — |
| 10 | **Render ve QA** | Remotion render → FFmpeg post. Otomatik kontroller: süre, siyah kare, donma, ses tepe/LUFS, altyazı taşması. Vision ile 1 kare/5 sn tarama | final.mp4 | 👤 Final onay |
| 11 | **Paketleme** | *Packager*: 3 başlık, açıklama, beat'lerden **bölümler (chapters)**, etiketler. Thumbnail için Nano Banana Pro ile 3 varyant | Metadata + thumbnail | 👤 (hızlı) |
| 12 | **Yayın** | YouTube Data API: upload, zamanlama, `containsSyntheticMedia` (gerekirse), thumbnail. A/B için YouTube'un "Test & Compare" özelliği | Yayınlanan video | — |
| 13 | **Öğrenme döngüsü** | Analytics API: izlenme süresi eğrisi, CTR. Düşüş noktaları beat'lerle eşlenir. Bulgular kanalın "dersler" belleğine yazılır, Scout ve Story ajanları bunu okur | Kanal belleği | — |
| L | **Yerelleştirme (dil başına, 2–12 paralel)** | Bkz. §15. Transcreation → TTS → yeniden zamanlama → lip-sync → yerel yazılar → render → yerel metadata/altyazı/thumbnail | Dil başına video veya ses kanalı | 👤 Dil başına hızlı onay (anadil kontrolü opsiyonel) |

**Yeniden üretilebilirlik:** Her aşama idempotent ve içerik hash'i ile önbellekli. Tek bir çekim veya sahne yeniden üretildiğinde sadece etkilenen alt aşamalar tekrar çalışır (DAG invalidation).

---

## 6. Tutarlılık Stratejisi

1. **Kimlik paketi (Character Identity Pack):** 6–8 açılı turnaround, 8–12 ifade, kıyafet varyantları, hex palet ve "asla değişmeyecekler" listesi (ör. yara izi sol yanakta). Kalıcı maskot için **FLUX LoRA**, video tarafında **Kling Element** veya Seedance referans seti.
2. **Stil kitabı:** Sabit prompt öneki, 3–5 stil referans görseli, negatif kurallar, lens ve ışık dili. Her üretim çağrısı bunu otomatik enjekte eder. Kullanıcı ham prompt yazmaz.
3. **Mekân kitabı:** Her mekân için referans set. Sahne içindeki çekimler aynı mekân referansını kullanır.
4. **Süreklilik defteri (continuity ledger):** Sahne bazında kıyafet, eşyalar, gün saati, hava durumu, yaralanma vb. Director yazar, prompt builder okur, QA kontrol eder.
5. **Kare zincirleme:** Ardışık hareketli çekimlerde son kare → ilk kare (Kling veya Veo ilk/son kare). Uzun sürekli aksiyon için Veo extend.
6. **Vision QA döngüsü:** Claude, üretilen kareyi kimlik paketiyle karşılaştırıp puanlar ve sapmayı metinle açıklar. Bu açıklama düzeltme prompt'una dönüşür.
7. **Ses tutarlılığı:** Kanal başına bir anlatıcı voiceId, karakter başına bir voiceId. Dinleyicide kanal kimliği görselden önce sesle oluşur.
8. **"Özgün mod"**: Karaktersiz videolarda bile bölüm içi stil kitabı ve mekân kitabı otomatik üretilir. Tutarlılık yine aynı mekanizmayla sağlanır.

---

## 7. Media Gateway Tasarımı

```ts
interface ProviderAdapter {
  id: string;                                   // "fal:kling-v3-pro-i2v"
  capabilities: Capability[];                   // "t2i" | "i2i_multiref" | "i2v" | "first_last_frame" | "ref2v" | "extend" | "lipsync" | "tts" | "music" | "sfx"
  limits: { maxDurationSec?; maxRefs?; resolutions: string[] };
  estimateCost(req): Money;
  submit(req): Promise<JobHandle>;              // async kuyruk + webhook/polling
  poll(handle): Promise<JobStatus>;
  fetchResult(handle): Promise<AssetPayload>;   // → R2'ye kopyala
}
```

- **Router:** `ShotRequest { capability, quality: "draft" | "standard" | "hero", refs, durationSec, budgetLeft }` → uygun adapter'lar → (kalite skoru × başarı oranı) / maliyet sıralaması.
- **Fallback zinciri:** Ör. `kling-v3 → seedance-2 → veo-3.1-fast → runway-turbo`.
- **Önbellek:** `hash(model, prompt, refs, seed, params)`. Aynı istek iki kez ödenmez.
- **Cost ledger:** Her çağrı kaydedilir. Bölüm bütçesi aşılırsa iş durur ve onay ister.
- **Rate limit ve eşzamanlılık:** Sağlayıcı başına semafor (Redis).
- **Taslak modu:** Önce düşük çözünürlükte veya ucuz modelle tüm bölüm çıkarılır (animatik), onaydan sonra final kalitede üretilir. Bu yöntem maliyeti %30–50 düşürür.
- Fiyat tablosu kodda sabit tutulmaz. `pricing` tablosunda durur, fal'ın pricing endpoint'inden periyodik güncellenir.

---

## 8. Ajan Ekibi (Claude Agent SDK)

| Ajan | Model | Araçlar (MCP) | Görev |
|---|---|---|---|
| Scout | Sonnet | youtube.search, youtube.channelStats, web_search, memory | Niş ve fikir keşfi, puanlama |
| Story Architect | Opus | memory, channel.read | Premise, beat sheet, retention yapısı |
| Screenwriter | Opus | story.read | Senaryo ve diyalog |
| Critic | Opus | — | Senaryoyu kanca, tempo ve özgünlük açısından eleştirir |
| Director | Opus | voice.alignment, bibles.read, budget.read | Shot list, kamera dili, süreklilik defteri |
| Prompt Engineer | Sonnet | bibles.read | Shot → modele özgü prompt (Kling, Veo, Seedance sözdizimleri farklı) |
| Continuity Supervisor | Opus (vision) | asset.view, bibles.read | Keyframe ve klip QA puanı + düzeltme önerisi |
| Editor | Sonnet | fs (packages/video), remotion.preview | Özel Remotion bileşenleri, timeline düzeltmeleri |
| Packager | Sonnet | analytics.read | Başlık, açıklama, bölümler, thumbnail brief'i |
| Analyst | Sonnet | youtube.analytics | Retention analizi → kanal dersleri |
| Transcreator | Opus | script.read, timing.targets, glossary | Dil başına süreye sığan kültürel uyarlama |
| Localization Critic | Sonnet | asr.transcribe, backtranslate | Geri çeviri, ASR eşleşmesi, kültürel hassasiyet kontrolü |

- Ajan çıktıları **Zod şemalı yapılandırılmış JSON** olarak alınır. Serbest metin pipeline'a girmez.
- Stil ve karakter kitapları sistem prompt'unda **prompt cache** ile tutulur.
- **ACP kullanımı:** Stüdyodaki "Claude ile düzenle" paneli `claude-agent-acp` sürecini başlatır ve repo + bölüm çalışma klasörüne bağlanır. Kullanıcı "3. sahneyi daha gergin yaz", "bu grafiğe sayaç animasyonu ekle" gibi talepler verir. Değişiklikler diff onayıyla uygulanır, ilgili pipeline aşamaları invalid edilir.
- **Claude Code'a iş yaptırma:** Yeni sahne tipi veya efekt gerektiğinde `packages/video` içinde Claude Code (Agent SDK, `permissionMode` kısıtlı, sadece o klasöre yazma) bileşeni yazar, `remotion still` ile görsel testten geçirir.

---

## 9. Remotion Katmanı

- **Tek ana kompozisyon:** `<Episode timeline={...} />`. Timeline JSON doğrudan `inputProps` olarak verilir, kod üretmeden render yapılır.
- **Sahne tipi bileşenleri:** `StillMotion` (derinlik haritasıyla parallax, Ken Burns), `Clip` (OffthreadVideo, crossfade), `TalkingCharacter`, `MotionGraphic/*` (harita, sayaç, zaman çizelgesi, liste, karşılaştırma, alıntı kartı), `Captions` (kelime vurgulu, `@remotion/captions`), `LowerThird`, `ChapterCard`, `Transitions` (`@remotion/transitions`).
- **Efekt kütüphanesi kanal markasına bağlı:** Fontlar, renkler ve geçiş dili StyleBible'dan gelir.
- **Render:** Varsayılan yerel render (`@remotion/renderer`, `concurrency` ayarlı). Paralel çok bölüm üretilecekse Remotion Lambda.
- **Uzun video ipuçları:** Sahne bazında `<Series>`. Ağır klipler için `OffthreadVideo` + önceden transcode (sabit fps, keyframe aralığı). 12–20 dk için gerekirse bölüm bazında render edilip FFmpeg ile concat.
- Remotion'un resmi agent skill'leri `.claude/skills/` altına eklenir. Hem geliştirme hem de Editor ajanı bunları kullanır.

---

## 10. Maliyet Tahmini (12 dakikalık bir video)

Varsayım: ~120 çekim (ortalama 6 sn), %50 still-motion, %25 AI klip (180 sn), %15 motion-graphic, ~60 sn konuşan karakter, 1,5× yeniden deneme.

| Kalem | Ekonomi | Standart | Premium |
|---|---|---|---|
| Claude (tüm ajanlar, cache'li) | $4 | $8 | $15 |
| Seslendirme (~11k karakter) | $1 | $1.5 | $2 |
| Keyframe (~180 görsel) | $8 (NB2/FLUX) | $16 | $30 (NB Pro 2K) |
| AI video (270 sn) | $15 (Kling 720p) | $30 (Kling 1080p) | $110 (Veo 3.1 std) |
| Lip-sync (90 sn) | — | $4.5 | $4.5 |
| Müzik + SFX | $3 | $8 | $12 |
| Thumbnail varyantları | $0.5 | $1 | $2 |
| Render/altyapı | ~$1 | ~$1 | ~$2 |
| **Toplam** | **≈ $30–35** | **≈ $70** | **≈ $175** |

Sabit aylık: ElevenLabs Pro (~$99), Trigger.dev/DB/R2 (~$20–50), Remotion (ücretsiz veya $100+), Claude Max (mevcut).

**Her ek dil (aynı 12 dakikalık video):** Transcreation + QA ($1–2), TTS ($1–2), lip-sync yeniden çalıştırma ($0–5), yerel thumbnail ($0.5–1), render (~$1) → **≈ $5–12/dil**. Görsel master yeniden üretilmez. 10 dilde Standart video toplamı ≈ $70 + 9 × $8 ≈ **$140**.

Bütçe seviyesi **bölüm bazında** seçilir (Ekonomi, Standart, Premium). Aynı bölüm içinde hero sahneler Premium, geri kalanı Standart olacak şekilde **karma** da olabilir.

---

## 11. YouTube Uyum Tasarımı

- **Çeşitlilik motoru:** Bölümler arasında hook tipi, yapı, sahne tipi dağılımı ve thumbnail kompozisyonu rotasyonla değişir. Aynı şablon tekrar edilmez.
- **Editoryal iz:** Her bölümde onay kapısı logları ve insan revizyonları kaydedilir. Kanal "AI destekli editoryal üretim" olarak konumlanır.
- **İfşa:** Gerçekçi insan veya olay tasviri varsa `containsSyntheticMedia=true` otomatik önerilir.
- **Telif:** Sadece ticari lisanslı üretici çıktıları (ElevenLabs Music, lisanslı sağlayıcılar). Gerçek kişi ve marka taklidi yasak, Critic ajanı kontrol eder.
- **Yayın temposu:** Seri üretim sinyali vermemek için kanal başına makul sıklık (ör. haftada 2–3 uzun video).

---

## 12. Yol Haritası

| Faz | Süre | Kapsam | "Bitti" kriteri |
|---|---|---|---|
| **0: Temel** ✅ kod (29 Eki) — Trigger.dev Faz 1'e kaydı | 1 hafta | Monorepo, Drizzle şeması, R2, Trigger.dev, Media Gateway (fal, gemini, elevenlabs adapter'ları), cost ledger, API anahtarları. **YouTube OAuth doğrulama ve audit başvurusu** | Bir görsel, bir klip ve bir ses üretilip R2'ye yazılıyor, maliyet kaydı var |
| **1: Dikey dilim** ✅ kod (29 Eki): ajanlar gerçek çağrıyla, render gerçek olarak doğrulandı; görsel/ses sağlayıcıları API anahtarı bekliyor | 2 hafta | Fikir (manuel) → hikâye → senaryo → TTS + timestamps → shot plan → keyframe → still-motion → Remotion render | 3 dakikalık, uçtan uca otomatik video |
| **2: Tutarlılık** 🟡 kısmen (29 Eki): Casting + konsept adayları + referanslı keyframe + hareket modu + onay kapıları ✅; vision QA ✅ (30 Eki: `frameInspector` Haiku ile her kareyi kadro referanslarıyla karşılaştırır; yazı, kolaj, çift/yanlış karakter ya da puan < 7 ise bir kez yeniden çizer, `packages/pipeline/src/qa.ts`; gerçek maliyeti henüz ölçülmedi); LoRA, kare zincirleme kaldı | 2–3 hafta | StyleBible, Character Identity Pack, LoRA ve Kling Element, continuity ledger, vision QA döngüsü, i2v ve zincirleme | Aynı karakter 30 çekimde tanınır (QA ortalaması ≥ 8) |
| **3: Uzun form + Stüdyo** 🟡 kısmen (30 Eki): Stüdyoda onay kapıları, aşama başına tahmin ve gerçek maliyet/süre tablosu, ilerleme ve kalan süre, hata bandı, ses kotası ön kontrolü ve ses değiştirme, `/costs` ve `/pricing` sayfaları ✅. "Canlı resim + efekt": Director her çekime bir `ambience` seçer (rain, snow, fog, dust, embers, flicker, rays); Remotion bunu durağan karelerin üstüne prosedürel çizer, API maliyeti sıfır (`packages/video/src/Ambience.tsx`, önizleme: `packages/video/scripts/preview-ambience.ts`) ✅. Tahminler gateway'in fiyat kurallarından ve defterde ölçülen gecikmelerden hesaplanır (`packages/pipeline/src/estimate.ts`) | 3 hafta | 8–20 dk akış, bölüm render ve concat, müzik/SFX/mix, lip-sync, motion-graphic kütüphanesi, Next.js stüdyo (onay kapıları, shot board, timeline önizleme), ACP paneli | 12 dakikalık karakterli bölüm, insan onaylarıyla 1 iş gününde çıkıyor |
| **4: Fikir + Yayın + Öğrenme** | 2 hafta | Scout ajanı, fikir puanlama, packager, thumbnail, YouTube upload ve zamanlama, Analytics döngüsü | Bir kanal için haftalık plan → yayın döngüsü çalışıyor |
| **4.5: Çok dil** | 2 hafta | Dil katmanlı Timeline, transcreation ajanı, esnek zamanlama, dil başına lip-sync, i18n motion-graphic'ler, RTL/CJK font desteği, yerel metadata/altyazı/thumbnail, iki yayın modu (§15) | Aynı bölüm 5 dilde, tek tıkla, görsel master yeniden üretilmeden çıkıyor |
| **5: Ölçek** | sürekli | Çok kanal, paralel bölümler, yerel GPU (ComfyUI: Wan/LTX) ile ucuz taslaklar, Remotion Lambda, sağlayıcı A/B ölçümleri, Shorts türevleri, dizi/sezon sürekliliği | Kanal başına haftalık maliyet ve süre hedefleri |

---

## 13. Riskler ve Önlemler

| Risk | Önlem |
|---|---|
| Model ve API'lerin kapanması veya fiyat değişimi (Sora örneği) | Adapter mimarisi, fallback zinciri, fiyat tablosu DB'de |
| Karakter kayması (drift) | Kimlik paketi + LoRA/Element + vision QA eşiği + insan shot board onayı |
| Uzun videoda maliyet patlaması | Bölüm bütçesi, taslak modu, still-motion ağırlığı, önbellek |
| YouTube "inauthentic content" demonetizasyonu | Çeşitlilik motoru, insan kapıları, özgün anlatı, makul tempo |
| YouTube API'den yüklenen videoların private kalması | OAuth doğrulama + audit Faz 0'da. Geçici olarak manuel yükleme |
| Ajan maliyeti ve abonelik kredi limitleri | Üretimde API anahtarı, prompt caching, Haiku/Sonnet ile katmanlama |
| Telif ve lisans | Sadece ticari lisanslı sağlayıcılar, Suno yok, gerçek kişi taklidi yok |
| Remotion lisansı (ekip büyürse) | 4. kişi eklendiğinde Company/Automators lisansı |

---

## 14. Alınan Kararlar (v0.2: "maksimum kapsam")

| Konu | Karar |
|---|---|
| Dil | **Her dil.** Kaynak dil bölüm bazında seçilir, hedef diller kanal bazında listelenir. Varsayılan ilk set: TR, EN, ES, PT-BR, DE, FR, AR, HI, JA, ID |
| Bütçe | Üç seviye de var, **bölüm bazında ve sahne bazında** seçilebilir. Bölüm bütçe tavanı zorunlu |
| Mod | **Karakterli ve özgün mod** birinci günden desteklenir (veri modeli aynı) |
| GPU | **Yerel-önce.** RTX 5080 16 GB + 128 GB RAM mevcut. ComfyUI adapter'ı Faz 1'de birinci sınıf sağlayıcı (§18). Ölçek için RunPod |
| Maliyet | Varsayılan seviye **Ekonomi**. Router her zaman önce yerel, sonra batch, sonra en ucuz bulut seçeneğine bakar |
| Ekip | ≤3 kişi varsayıldı (Remotion ücretsiz). Lisans kontrolü ayarlarda bir anahtar |
| Hosting | **Hibrit:** geliştirme Windows + Docker (Postgres, Redis, Trigger.dev self-host). Üretim tek komutla buluta taşınabilir (Neon, Trigger.dev Cloud, Remotion Lambda). Render varsayılanı yerel |
| Yayın | Çok kanallı (bir Google hesabında birden fazla kanal, OAuth token kanal başına) |

Tek açık konu: **ilk kanalın nişi.** Scout ajanı Faz 4'te öneri üretecek. O zamana kadar test için seçilecek herhangi bir konu yeterli.

---

## 15. Çok Dilli Üretim Mimarisi

### 15.1 Prensip: "Visual Master + Language Layers"

```
Episode
 ├─ VisualMaster (dilden bağımsız): keyframe'ler, klipler, metinsiz motion-graphic şablonları, müzik, SFX
 └─ LanguageVersion[lang]
     ├─ Script(lang)            ← transcreation (çeviri değil, yeniden yazım)
     ├─ VoiceTrack(lang)        ← aynı karakter sesi, o dilde (ElevenLabs v3 çok dilli ses kimliği)
     ├─ TimingMap(lang)         ← çekim süreleri bu dilin sesine yeniden oturtulur
     ├─ LipSync(lang)           ← sadece talking_character çekimleri
     ├─ TextLayer(lang)         ← ekrandaki yazılar, grafik etiketleri, altyazı (i18n)
     ├─ Thumbnail(lang), Metadata(lang), Captions(lang).srt/.vtt
     └─ Render(lang)            ← final_{lang}.mp4 ve/veya audio_{lang}.m4a
```

### 15.2 Kritik problem: diller farklı uzunlukta

Aynı metin Almancada ~%20–30 uzar, Japoncada kısalır. Çözüm üç katmanlı:
1. **Transcreation ajanı hedef süreyle yazar.** Her sahne için hedef ms aralığı verilir, ajan metni ±%8'e sığdırır. Taşarsa kısaltma turu yapılır.
2. **Esnek çekimler.** Her Shot `minMs/maxMs` taşır. `still_motion` ve `motion_graphic` serbestçe uzar/kısalır. `ai_clip` için yavaşlatma (≤%15), donuk kare uzatma, kırpma veya taslakta üretilmiş "ekstra kuyruk" kullanılır.
3. **TTS hız ayarı** (±%7 doğal kalır). Son çare: tek çekim için ek kısa klip üretimi.

### 15.3 Dil başına özel işler

- **Kültürel uyarlama:** Deyimler, birimler (mil/km), para, örnekler ve şakalar uyarlanır. Hassas konu kontrolü (din, siyaset, yerel yasalar) yapılır. *Localization Critic* ajanı ikinci bir gözle kontrol eder.
- **Ses:** Anlatıcı ve karakterler her dilde aynı ses kimliğini korur (v3 çok dilli). Dil özel telaffuz sözlüğü (özel isimler, marka adları) için ElevenLabs pronunciation dictionary kullanılır. ElevenLabs'in desteklemediği bir dil gelirse yedek TTS adapter'ı devreye girer (Gemini TTS veya Azure).
- **Dudak senkronu:** Karakter konuşuyorsa sync.so her dil için ayrıca çalıştırılır. Bu yüzden karakter sahnelerinde mümkün olduğunca "anlatıcı + yan profil / uzak plan" tercih edilir, lip-sync gereken saniye azaltılır.
- **Tipografi:** Dil başına font yığını (Noto ailesi: CJK, Arapça, Devanagari, Tay). **RTL** (Arapça, İbranice, Farsça) için Remotion'da yön ve hizalama aynalanır. Altyazı satır kırma kuralları dile göre ayarlanır.
- **Görsel içindeki yazı:** Keyframe'lere metin gömülmez (kural). Tüm yazılar Remotion katmanında durur, bu sayede tek görsel her dile hizmet eder. Thumbnail'deki yazı da ayrı katmandır, ya Nano Banana Pro ile dil başına yeniden yazdırılır ya da Remotion still ile basılır.
- **Ses miksajı:** Müzik ve SFX ortak stem'dir, sadece konuşma stem'i değişir. Ducking dil başına yeniden hesaplanır.

### 15.4 İki yayın modu (kanal bazında seçilir)

| Mod | Nasıl | Ne zaman |
|---|---|---|
| **A: Tek video, çok ses kanalı** | Ana video + YouTube'un multi-language audio özelliği (dil başına ses kanalı ve yerel thumbnail). Başlık ve açıklama `localizations` alanıyla, altyazılar `captions.insert` ile API üzerinden | Ekranda az yazı olan videolar. İzlenmeler tek videoda toplanır |
| **B: Dil başına ayrı kanal** | Her dil kendi kanalına tamamen yerel bir video olarak yüklenir (yazılar da yerel) | Metin ağırlıklı videolar, farklı yayın saatleri ve pazar bazlı nişler |

⚠️ Ses kanalı yükleme için **resmi bir Data API uç noktası doğrulanamadı.** Mod A'da ses dosyaları şimdilik YouTube Studio'dan elle yüklenir (fabrika dosyaları hazır paketler, yükleme ~1 dk/dil). Studio arayüzünü bot ile otomatikleştirmek YouTube Şartları'na aykırı olabilir, yapılmayacak. API desteği gelirse adapter eklenir. YouTube'un kendi otomatik dublajı (27 dil) kapatılır, kendi seslerimiz daha kaliteli ve karakter kimliğini korur.

### 15.5 Dil kapsamı ve önceliklendirme

- Scout ajanı fikir bazında **dil-pazar skoru** üretir: o dildeki arama talebi, rakip yoğunluğu, CPM potansiyeli. Her bölüm her dile çıkmaz, puanı yüksek dillere çıkar.
- QA: Dil başına otomatik geri çeviri kontrolü (Claude) + ASR doğrulaması (TTS çıktısı yazıya döküldüğünde senaryoyla eşleşiyor mu, ElevenLabs Scribe ile).
- Opsiyonel insan anadil kontrolü: Stüdyoda "reviewer" rolü ve paylaşılabilir inceleme linki.

---

## 16. Maksimum Kapsam: Ek Modüller

| Modül | Açıklama | Faz |
|---|---|---|
| **Shorts türetici** | Uzun videodan en güçlü 3–5 an seçilir (retention verisi + Claude). 9:16 yeniden kompozisyon yapılır (Remotion'da ayrı layout, keyframe'ler 9:16 da üretilebilir), hook altyazılı, ana videoya bağlantılı | 5 |
| **Çoklu en-boy render** | 16:9 ana, 9:16 Shorts, 1:1 sosyal. Layout'lar Timeline'dan türetilir | 5 |
| **Dizi / sezon sürekliliği** | `SeriesBible`: bölümler arası olay örgüsü, karakter gelişimi, geçmiş olay kaydı. Story ajanı önceki bölümleri hafızadan okur | 3 |
| **Varlık kütüphanesi ve yeniden kullanım** | Onaylanmış keyframe'ler, klipler, mekânlar ve müzikler etiketlenip aranabilir (embedding). Yeni bölüm önce kütüphaneye bakar. Maliyet her bölümde düşer | 3 |
| **Kendi sesin / marka sesi** | ElevenLabs Professional Voice Clone ile kanal sahibinin sesi, tüm dillerde | 4.5 |
| **Upscale ve interpolasyon** | 720p klipleri 1080p/4K'ya büyütme, 24→30/60 fps ara kare (fal upscaler'lar veya yerel ComfyUI) | 3 |
| **Thumbnail laboratuvarı** | Dil başına 3 varyant, CTR tahmin ajanı, YouTube Test & Compare | 4 |
| **Bölüm sonrası içerik** | Topluluk gönderisi, sabitlenmiş yorum, açıklama içi kaynakça (belgesel nişlerinde güven için) | 4 |
| **Kanal sağlığı paneli** | Çeşitlilik skoru (son 10 bölümün yapı benzerliği), yayın temposu, politika uyarıları | 4 |
| **Maliyet ve ROI paneli** | Bölüm, dil ve kanal bazında maliyet ↔ izlenme ve gelir (Analytics API, monetizasyon verisi) | 4 |
| **Çok kullanıcılı roller** | Owner, Editor, Reviewer (anadil kontrolü), sadece onay yetkisi | 3 |
| **Sağlayıcı benchmark'ı** | Aynı çekimi 3 modelde üretip QA skoru/maliyet ölçen arka plan işi. Router ağırlıklarını otomatik günceller | 5 |
| **Model Scout** | Haftalık ajan: yeni model ve sürümleri tarar (fal/Replicate katalogları, sağlayıcı changelog'ları, web), aday adapter oluşturur, benchmark'a sokar, önerir. Kapanış duyurularını yakalar (Sora örneği) | 5 |

---

## 17. Pazar Haritası (Ekim 2026)

Pazar her ay değişiyor. Son 6 ayda Sora kapandı, Kling 4.0, Seedance 2.5, Wan 3.0 ve Gemini Omni çıktı. Bu yüzden mimari **"model değil, yetenek"** üzerine kurulu. Aşağıdaki liste bugünkü durum. Model Scout ajanı (§16) bu listeyi canlı tutar.

### 17.1 Dört katman

| Katman | Örnekler | Fabrikadaki rolü |
|---|---|---|
| **1. Model sahipleri (direkt API)** | Google (Veo 3.1, Gemini Omni, Nano Banana), Kuaishou (Kling), ByteDance (Seedance, Seedream, OmniHuman), Alibaba (Wan 3.0, Qwen-Image), MiniMax (Hailuo, Speech), Shengshu (Vidu), PixVerse, Luma, Runway, BFL (FLUX), OpenAI (GPT Image), ElevenLabs | En çok kullanılan 3–4 model için direkt bağlantı: en ucuz fiyat, en yeni özellikler önce burada |
| **2. API agregatörleri** | **fal.ai**, Replicate, Runware, WaveSpeed, Kie.ai, Atlas Cloud, EvoLink, CometAPI, Together AI, PiAPI, Segmind, Eden AI | Tek anahtarla yüzlerce model. **fal birincil, bir tane yedek.** Yeni model genelde ilk gün buraya gelir |
| **3. Yaratıcı platformlar (stüdyo + kredi)** | **Higgsfield** (Soul ID, Cinema Studio, Popcorn, Supercomputer, API + MCP), Freepik, OpenArt, Krea, Leonardo, LTX Studio, Adobe Firefly, Midjourney | Kendi arayüzleri olan "hazır fabrikalar". Biz kendi fabrikamızı kuruyoruz. Bunları ancak **benzersiz bir özellik** sunuyorlarsa adapter olarak ekliyoruz |
| **4. Açık kaynak (kendi GPU'n)** | Wan 2.2, Wan-Animate-2, LTX-2.3, HunyuanVideo 1.5, FLUX.1/2 dev, Qwen-Image | Sınırsız taslak, LoRA, ölçekte maliyet düşürme |

### 17.2 Higgsfield ve benzeri platformlar nerede duruyor?

**Higgsfield**, kendi modelleri (Soul görsel modelleri) ile Kling, Veo, Seedance, Wan gibi üçüncü taraf modelleri tek arayüzde ve kredi sisteminde birleştiren bir **yaratıcı platform ve aracı**.

**Bize yararlı tarafları:**
- **Soul ID:** 20+ fotoğrafla eğitilen kimlik katmanı. Sadece gerçek kişiler için. Uydurma karakterler için Cinema Studio'daki "Soul Cast" kullanılıyor.
- **Cinema Studio:** Lens, sensör ve kamera hareketi kontrolü. Elements sürüm 4.0'da 50 referansa kadar çıkıyor.
- **Popcorn:** Hikâye tahtası ve görsel dizi tutarlılığı.
- **MCP sunucusu:** Claude Code'dan doğrudan bağlanılabiliyor (30+ model). Ayrıca webhook destekli bir REST API'si var (`api.higgsfield.ai`).

**Ana motor yapmama sebeplerimiz:**
- Altta yatan modellerin çoğuna fal veya direkt API ile daha ucuza ulaşıyoruz. Kredi sistemi ve kredilerin ~90 günde sona ermesi bir maliyet riski.
- Soul ID modeller arasında paylaşılmıyor, her model için yeniden eğitim gerekiyor. Tutarlılığı kendi kimlik paketimizle (§6) sağlamak, platform bağımlılığını kaldırıyor.
- 15 saniyenin altındaki kliplerde en güçlü. Bizim ihtiyacımız uzun anlatı.

**Karar:** Higgsfield **opsiyonel adapter** (`higgsfield:*`) ve **ACP oturumlarında MCP aracı** olarak eklenecek. Benchmark (§16) Soul/Cinema çıktılarının bizim pipeline'dan daha iyi tutarlılık verdiğini gösterirse router ona trafik yönlendirir. Aynı mantık Freepik, Krea, OpenArt ve LTX Studio için de geçerli: API'leri varsa adapter yazılır, yoksa sadece insan kullanımı için listede kalırlar.

### 17.3 Kategori bazında tam liste

| Kategori | Birinci tercih | Güçlü alternatifler | İzlemede / kullanılmayacak |
|---|---|---|---|
| **Video (i2v/ref2v)** | Kling 3.0 → 4.0, Seedance 2.0 → 2.5 | Veo 3.1, Wan 3.0, Hailuo 3, Vidu Q3, PixVerse V6, Luma Ray 3.2, Runway Gen-4.5 | Gemini Omni 1.1 (720p), Genie 4 (dünya modeli, bekleme listesi), Moonvalley Marey (lisanslı veri, API belirsiz), ~~Sora~~ |
| **Görsel** | Nano Banana Pro / 2, FLUX.2 | GPT Image 2.x, Seedream, Qwen-Image, Ideogram (tipografi), Recraft (vektör ve marka) | Midjourney (resmi API yok) |
| **Karakter kimliği** | Kendi kimlik paketi + FLUX LoRA + Kling Element / Seedance referansları | Higgsfield Soul ID / Soul Cast | — |
| **TTS** | ElevenLabs v3 | MiniMax Speech 2.6 HD (40+ dil, ucuz), Gemini 3.1 Flash TTS, Hume Octave 2 (duygu), Inworld TTS, Fish Audio (ucuz klon), Cartesia Sonic (hız), Azure / Google Cloud TTS (dil kapsamı) | — |
| **Müzik** | Eleven Music v2 | Mubert API, Stable Audio | ~~Suno~~, ~~Udio~~ (resmi API ve hukuki belirsizlik) |
| **SFX** | ElevenLabs SFX v2 | Video modellerinin native sesi (Veo, Kling 4, Seedance) | — |
| **Lip-sync / avatar** | sync.so lipsync-2-pro | VEED Fabric, Hedra, LTX-2 lipsync, OmniHuman, Wan-Animate-2 (açık) | HeyGen (geliştirici lip-sync API'si yok) |
| **Upscale / interpolasyon** | fal upscaler'ları | Topaz API, Magnific, yerel ComfyUI (RIFE, SeedVR) | — |
| **Agregatör** | fal.ai | Runware, WaveSpeed, Kie.ai, Replicate, Together, Atlas Cloud | — |

### 17.4 Sağlayıcı seçim kuralları (router politikası)

0. **Önce yerel:** Görev yerel GPU'da kabul edilebilir kalitede yapılabiliyorsa bulut kullanılmaz (§18).

1. **Yetenek uyuyor mu?** Referans sayısı, süre, ilk/son kare, ses.
2. **Bu kanalın benchmark skoru** (QA puanı × kabul oranı).
3. **Saniye başı maliyet** (direkt API > agregatör > platform kredisi).
4. **Sağlık:** Son 24 saatteki hata oranı ve kuyruk süresi.
5. **Çeşitlilik:** Aynı bölümde tek modele aşırı bağlanmama. Stil tutarlılığı izin veriyorsa model karışımı.
6. **Kapanma riski:** "Preview" modeller hero çekimlerde kullanılmaz.

---

## 18. En Ucuz Mimari: "Yerel Önce, Bulut Sadece Gerektiğinde"

### 18.1 Elimizdeki donanım

| Bileşen | Değer | Ne kazandırır |
|---|---|---|
| GPU | **RTX 5080, 16 GB VRAM** | FLUX.2 dev / Qwen-Image (FP8/GGUF), LTX-2.3 (FP8), Wan 2.2 5B ve 14B GGUF, upscale, interpolasyon, derinlik haritası, yerel vision QA |
| RAM | **128 GB** | Model offloading (16 GB VRAM sınırını aşan modeller için kritik), paralel Remotion render |
| CPU | **Ryzen 9 9950X3D (16 çekirdek)** | 12 dakikalık 1080p Remotion render ≈ 8–15 dk, FFmpeg, Whisper |
| Elektrik | ~0,4 kWh/saat tam yükte | GPU saati birkaç kuruş. Bulutta aynı iş $0.35–1/saat |

### 18.2 Kalem kalem en ucuz çözüm

| İş | En ucuz yol | Maliyet | Ne zaman buluta çık |
|---|---|---|---|
| **Claude ajanları** | **Claude Max aboneliğinin Agent SDK kredi havuzu** (`claude -p` / SDK). Üretimde aşım olursa Anthropic **Batch API (%50 indirim)** + prompt caching (%90'a varan) | ~$0 marjinal (havuz dolana kadar) | Havuz biterse Batch API |
| **Seslendirme** | Kademeli: (1) **Gemini Flash TTS** (token bazlı, 12 dk ≈ $0.2–0.5), (2) Inworld TTS-1.5 Mini (~$5/1M karakter), (3) yerel açık kaynak TTS (Kokoro vb., dil kapsamı sınırlı) | $0–0.5/video | Karakter sesi ve duygu kritikse ElevenLabs v3 (abonelik kredisiyle) |
| **Kelime zamanlaması** | Yerel **faster-whisper / WhisperX** (forced alignment) | $0 | — |
| **Keyframe görselleri** | Yerel **FLUX.2 dev / Qwen-Image-Edit** + karakter LoRA'sı (yerelde eğitilir) | $0 | Çok referanslı zor sahneler: **Nano Banana 2 Batch** (~$0.034/1K görsel, %50 indirimli) |
| **Hareketli resim (2.5D)** | Yerel **Depth Anything** ile derinlik haritası → Remotion'da parallax ve kamera hareketi. Videoların %50'si bu | $0 | — |
| **AI video (b-roll, atmosfer)** | Yerel **LTX-2.3** (hızlı) ve **Wan 2.2** (kalite), 480–720p → yerel upscale | $0 | — |
| **AI video (karakterli, hero)** | Bulut, **sessiz** üretim (ses ücreti ödenmez): Veo 3.1 Lite ~$0.03/sn (Vertex, sessiz), Seedance 2.0 480p ~$0.025/sn + yerel upscale, Kling 720p ~$0.084/sn | 12 dk videoda ~$5–25 | Premium seviyede Kling 1080p / Veo std |
| **Upscale ve interpolasyon** | Yerel (Real-ESRGAN / SeedVR, RIFE) | $0 | — |
| **Lip-sync** | Yerel (LatentSync, Wan-Animate-2, LTX-2 lipsync). Kurgu kuralı: konuşan karakterin yüzü az gösterilir | $0 | Yakın plan hero sahne: sync.so (~$0.05/sn) |
| **Müzik** | **Kanal müzik kütüphanesi bir kez üretilir** (Eleven Music ile 20–40 parça, ~$30–60 tek sefer) + **YouTube Audio Library** (ücretsiz). Bölümlerde tekrar kullanılır | ~$0/video | Özel tema gerekirse |
| **SFX** | Ücretsiz kütüphaneler (YouTube Audio Library, Freesound CC0) + bir kez üretilmiş ElevenLabs SFX kütüphanesi | ~$0 | — |
| **Vision QA** | Önce yerel VLM (Qwen-VL sınıfı) ile eleme, sınırda kalanlar için Claude (Max havuzu) | ~$0 | — |
| **Render** | Yerel Remotion (≤3 kişi ücretsiz lisans) | $0 | Paralel çok bölüm: Lambda |
| **Altyapı** | Docker'da Postgres 18, Redis 8, Trigger.dev, RustFS (S3 uyumlu yerel depo; MinIO topluluk sürümü Ekim 2025'te imaj yayınlamayı bıraktı). Yedekleme için R2 (10 GB ücretsiz) | ~$0 | Ekip veya uzaktan erişim gerekince |

### 18.3 Maliyeti düşüren 12 kural (pipeline'a gömülü)

1. **Animatik önce:** Bölüm önce sadece still-motion ve yerel taslaklarla kurulur ve onaylanır. Ücretli üretim sadece onaylı çekimlere yapılır.
2. **Video, görselden 10 kat pahalı.** Keyframe onaylanmadan i2v çağrılmaz. Reddedilen video sayısı sıfıra yaklaşmalı.
3. **Düşük çözünürlükte üret, yerelde büyüt.** 480/720p → 1080p/4K.
4. **Sessiz üret.** Ses kendi hattımızdan geliyor, video modellerine ses ücreti ödenmez.
5. **5 sn üret, 8 sn kullan.** Yavaşlatma (≤%15), donuk kare, Ken Burns ile uzatma. Uzun klip parası ödenmez.
6. **Batch API'ler:** Gemini ve Anthropic batch modları %50 indirimli. Acil olmayan her iş batch kuyruğuna gider (sonuç 24 saat içinde).
7. **Önbellek ve kütüphane:** Mekân açılış çekimleri, karakter pozları, geçişler, müzik ve SFX etiketlenip yeniden kullanılır. Her bölüm bir öncekinden ucuza gelir.
8. **Video yerine motion-graphic:** Harita, liste, karşılaştırma, zaman çizelgesi gibi anlatımlar Remotion ile bedava yapılır.
9. **Lip-sync'i kurguyla azalt:** Anlatıcı sesi, sırt/yan çekim, uzak plan.
10. **Çok dilde görseli tekrar kullan** (§15). Ek dil ≈ sadece TTS maliyeti.
11. **Bütçe tavanı ve fiyat farkındalıklı router:** Her çağrıdan önce tahmini maliyet hesaplanır. Bölüm tavanı aşılacaksa daha ucuz modele düşülür veya onay istenir.
12. **Kredi programları:** Google for Startups / Cloud kredileri, sağlayıcıların yeni hesap kredileri, kademeli hacim indirimleri (Kling ve ByteDance kurumsal paketleri) ölçek büyüyünce değerlendirilir.

### 18.4 Güncellenmiş seviyeler (12 dakikalık video)

| Seviye | Yaklaşım | Tahmini maliyet |
|---|---|---|
| **Ultra-ekonomi (yerel)** | Her şey yerelde. Bulut sadece birkaç zor keyframe için. Gemini TTS | **≈ $1–5** |
| **Ekonomi** | Yerel + karakterli çekimler bulutta (Veo Lite / Seedance 480p sessiz) + Nano Banana 2 batch | **≈ $8–20** |
| **Standart** | Kling 720p/1080p karakter çekimleri, ElevenLabs v3, sync.so hero | **≈ $35–60** |
| **Premium** | Kling 4 / Seedance 2.5 / Veo std hero çekimleri, 4K | **≈ $120–180** |

Sabit aylık en düşük senaryo: **~$0–25** (Claude Max mevcut, ElevenLabs gerekirse Starter/Creator, R2 ücretsiz katman). Bir 12 dakikalık video yerelde üretilirken GPU'nun meşgul kalacağı süre tahminen 2–5 saat. Yani tek makineyle günde 3–6 bölüm. Ölçek gerekirse RunPod RTX 4090 Community ~$0.34/saat.

> ⚠️ Doğrulanacaklar: Max aboneliğinde Agent SDK kredi havuzunun miktarı ve koşulları. Yerel modellerin 16 GB VRAM'deki gerçek süre ve kalite değerleri (Faz 1'de ölçülecek). Gemini TTS'in Türkçe dahil dil kalitesi.

---

## Kaynaklar

- Video API fiyat karşılaştırmaları: [CometAPI](https://www.cometapi.com/ai-video-api-pricing/), [Crazyrouter](https://crazyrouter.com/en/blog/ai-video-generation-api-pricing-may-2026-comparison), [ModelsLab](https://modelslab.com/best-ai-video-api-2026)
- Kling 3.0: [fal.ai/kling-3](https://fal.ai/kling-3), [Kie.ai docs](https://docs.kie.ai/market/kling/kling-3.0)
- Seedance 2.0: [fal.ai/seedance-2.0](https://fal.ai/seedance-2.0), [BytePlus ModelArk](https://docs.byteplus.com/docs/ModelArk/2291680), [Together AI](https://docs.together.ai/docs/seedance2.0-quickstart)
- Veo 3.1: [Google Developers Blog](https://developers.googleblog.com/introducing-veo-3-1-and-new-creative-capabilities-in-the-gemini-api/)
- Gemini Omni: [KDnuggets](https://kdnuggets.com/google-gemini-omni-what-it-actually-does-what-it-costs-and-how-it-compares), [VentureBeat](https://venturebeat.com/technology/google-unveils-gemini-omni-any-to-any-ai-model-what-enterprises-should-know)
- Sora kapanışı: [Zilliz](https://zilliz.com/ai-faq/what-is-the-sora-shutdown-timeline), [TechJack](https://techjacksolutions.com/ai-brief/openai-videos-api-sora-2-deprecated-september-2026/)
- Görsel modeller: [fal.ai rehberi](https://fal.ai/learn/tools/ai-image-generators), [Nano Banana Pro dev guide](https://dev.to/akaranjkar08/nano-banana-pro-gemini-3-pro-image-developer-guide-api-2026-104c), [aiofm](https://aiofm.info/en/guides/image-editing-models-2026)
- Açık kaynak video: [InsiderLLM](https://insiderllm.com/guides/local-ai-video-generation/), [LTX blog](https://ltx.io/blog/best-open-source-video-generation-models)
- ElevenLabs: [API pricing](https://elevenlabs.io/pricing/api), [LLM Reference: eleven v3](https://www.llmreference.com/provider/elevenlabs/eleven-v3)
- Suno API durumu: [Sonilo](https://sonilo.com/blog/guides/official-suno-api-saas-builders-2026), [AIMLAPI](https://aimlapi.com/blog/the-suno-api-reality)
- Lip-sync: [sync.so](https://ai.sync.so/task/blog/api-add-lip-sync-ai-video-characters), [VEED karşılaştırma](https://dhl.veed.io/learn/best-lipsync-api)
- Remotion: [Pricing](https://www.remotion.dev/docs/license/pricing), [v4.0.422](https://newreleases.io/project/github/remotion-dev/remotion/release/v4.0.422), [2026 güncellemeleri](https://autoae.online/blog/remotion-updates-2026)
- Claude Motion: [eesel](https://eesel.ai/blog/claude-motion), [aiwiki](https://aiwiki.ai/wiki/claude_motion/raw)
- Claude Agent SDK / ACP: [Subagents docs](https://platform.claude.com/docs/en/agent-sdk/subagents), [claude-agent-acp README](https://cdn.jsdelivr.net/npm/@agentclientprotocol/claude-agent-acp@0.41.0/README.md), [Atlas survey](https://laoujin.github.io/Atlas/research/2026-06-03-extending-claude-code-session-4-authoring-craft-operating-at-scale/claude-agent-sdk-headless-agents/)
- Orkestrasyon: [noqta](https://noqta.tn/blog/durable-execution-ai-agents-inngest-trigger-temporal-2026), [AutomationAtlas](https://automationatlas.io/guides/trigger-dev-vs-inngest-2026-comparison/)
- YouTube politika: [vidIQ](https://vidiq.com/blog/post/youtube-ai-monetization/), [eWeek](https://www.eweek.com/news/youtube-responds-to-ai-concerns/), [AIR Media-Tech](https://air.io/en/monetization/youtube-monetization-policy-changes-2026-a-complete-dated-timeline)
- Maliyet: [Invideo – resmi saniye fiyatları (Ağu 2026)](https://invideo.io/blog/ai-video-model-pricing/), [TeamDay – Eyl 2026](https://www.teamday.ai/blog/best-ai-video-models-2026), [Nano Banana batch](https://techearl.com/nano-banana-batch-api), [Gemini batch modu](https://geekflare.com/news/gemini-api-gets-batch-mode-50-cheaper-higher-throughput), [Fish Audio – en ucuz TTS](https://fish.audio/blog/cheapest-text-to-speech-api-developers/), [Inworld TTS fiyatları](https://inworld.ai/resources/tts-api-pricing-comparison), [RunPod fiyatları](https://diyai.io/ai-tools/hosting/runpod-pricing/)
- Higgsfield: [Creatify – Higgsfield MCP](https://creatify.ai/blog/what-is-higgsfield-mcp-what-it-does-what-it-costs-and-how-to-use-it), [Scalekit – MCP vs API](https://www.scalekit.com/blog/higgsfield-mcp-vs-api), [Soul ID](https://higgsfield.ai/blog/sould-id-best-character-consistency), [Tutarlı karakter rehberi](https://higgsfield.ai/blog/consistent-characters-locations)
- Yeni modeller: [Kling 4.0 – Atlas Cloud](https://www.atlascloud.ai/blog/tips/kling-4-flash-vs-full), [Kling 4 API durumu](https://aireiter.com/blog/kling-4-api-availability), [Wan 3.0 – DataNorth](https://datanorth.ai/news/alibaba-launches-wan3-0-video-model), [Seedance 2.5 – EvoLink](https://evolink.ai/blog/seedance-2-5-api-status), [Pinggy 2026 roundup](https://pinggy.io/blog/best_video_generation_ai_models/)
- Diğer video API'leri: [Atlas Cloud en ucuzlar](https://atlascloud.ai/blog/guides/cheapest-ai-video-generation-api-2026), [Apiframe fiyatlar](https://apiframe.ai/blog/ai-video-api-pricing-2026), [Eden AI](https://www.edenai.co/post/best-ai-video-generation-apis)
- Agregatörler: [TeamDay karşılaştırma](https://teamday.pages.dev/blog/ai-image-video-api-providers-comparison-2026), [CometAPI – Kie alternatifleri](https://www.cometapi.com/best-kie-ai-alternatives/), [DEV – inference platformları](https://dev.to/preecha/best-ai-inference-platforms-in-2026-replicate-vs-falai-vs-runware-vs-novita-ai-vs-atlas-cloud-5foh)
- TTS alternatifleri: [Novita](https://blogs.novita.ai/best-text-to-speech-api-2026/), [Inworld](https://inworld.ai/resources/best-text-to-speech-apis), [FutureAGI](https://futureagi.com/blog/best-text-to-speech-providers-2026/)
- Moonvalley Marey: [PetaPixel](https://petapixel.com/2025/07/09/moonvalley-releases-marey-an-ethical-ai-video-tool-built-for-pro-filmmakers)
- YouTube çok dilli ses / otomatik dublaj: [TechCrunch](https://techcrunch.com/2025/09/10/youtubes-multi-language-audio-feature-for-dubbing-videos-rolls-out-to-all-creators/), [Metricool](https://metricool.com/youtube-multi-language-audio/), [BeMultilingual](https://www.bemultilingual.ca/blog/youtube-dubbing-updates), [ARY News](https://arynews.tv/youtube-expands-auto-dubbing-to-27-languages-with-expressive-speech)
- ElevenLabs dublaj karşılaştırmaları: [Dupple](https://dupple.com/learn/best-ai-dubbing-tools), [Perso.ai](https://perso.ai/blog/ai-dubbing-tools-comparison-2026)
- YouTube Data API kota/audit: [Google](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits?authuser=6), [Phyllo](https://www.getphyllo.com/post/is-the-youtube-api-free-in-2026-quota-limits-costs-when-to-pay)
