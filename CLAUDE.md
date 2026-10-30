# YoutubeStudio: Claude için proje notları

Plan ve mimari: `docs/PROJE_PLANI.md`. Büyük kararları değiştirmeden önce oradaki ilgili bölüme bak ve gerekirse güncelle.
README İngilizce (`README.md`), Türkçesi `README-TR.md`: birini değiştirirken diğerini de güncelle. CHANGELOG ve release notları İngilizce.

## Yapı
- pnpm workspace, TypeScript 7, ESM, derleme adımı yok (tsx/vitest kaynaktan çalışır). Paketler `exports: ./src/index.ts`.
- Göreli importlar `.ts` uzantılı yazılır (`./router.ts`).
- `packages/core`: paylaşılan Zod şemaları. Para her yerde **mikro-dolar tamsayı** (`usd()`, `formatUsd()`).
- `packages/media-gateway`: tüm üretim çağrıları buradan geçer. Pipeline kodu sağlayıcıyı asla doğrudan çağırmaz.
- Sağlayıcılar REST ile `fetch` üzerinden yazılır (SDK yok). `ctx.fetch` kullanılır ki testte mock'lanabilsin.

- `packages/agents`: Agent SDK `query()` + `outputFormat: json_schema`. Şemalar `toOutputSchema()` ile draft-07'ye çevrilir (Claude Code 2020-12'yi reddediyor). Ajan talimatları İngilizce, anlatım bölüm dilinde.
- `packages/pipeline`: aşamalar idempotent; her alt adımdan sonra `save()`. Yeni aşama eklerken `STAGES` sırasını ve `from` silme davranışını düşün.
- `packages/video`: Remotion; varlıklar `staticFile()` ile render klasörünün `public/` dizininden okunur. Vektör sahneler (`Vector.tsx`) model çıktısı SVG gömer: her SVG `sanitizeSvg()` ile temizlenir, tekrar eden hareketler koddadır (token harcanmaz).
- Pipeline `this.log` satırları `state.activity`'ye (son 400) ve `heartbeatAt`'e yazılır; Stüdyo bölüm durumunu `runStatusOf()` ile durum dosyasından okur (CLI'dan başlayan işler de görünür, 15 dk kayıt yoksa "takıldı").
- `apps/studio` istemci bileşenleri (`"use client"`) `@ys/pipeline/light`'tan sadece **tip** import eder; çalışma kodu `node:fs`'e ulaşır ve Turbopack çöker. Sunucu sayfası, istemci dosyasındaki düz fonksiyonu çağıramaz: ortak yardımcılar `src/lib/` altında.
- **Kalite kapısı ve gerçeklik zorunlu:** hiçbir SVG denetlenmeden kullanılmaz (`designAsset` → `gateCheck`: kör tahmin + `assetGate`, eşikler `core/rules.ts`'te; Stüdyo Kurallar sayfası aynı sabitleri gösterir). Gerçek özneler ve her nesne internetten (Wikipedia/Commons) bulunan görsele bakılarak çizilir (`pipeline/src/reference.ts`). Eşik değiştirirken yalnız `QUALITY_GATE`'i değiştir. Çizimden önce `assetPlanner` referanslara bakıp tarifi varlık türüne uydurur ve plan çıkarır (`<anahtar>.plan.json`, bir kez); tasarımcı plana göre çizer, kapı planın ipuçlarını arar.
- Harita ve bayrak gibi gerçek dünya bilgisi Claude'a çizdirilmez: yönetmen `map`/`flag` tarifi verir, `pipeline/src/geo.ts` gerçek veriden üretir. Yeni "olgusal" varlık türü (logo, anıt, bina…) eklerken de önce gerçek veri kaynağı ara.
- Stil paketleri `core/styles.ts` (`STYLE_PACKS`, en az 20; test bunu denetler): "auto" `stylePicker` seçer, "custom" eski `artDirector`. Çizgi stili `lineStyleOf(state)` (kullanıcı seçimi yoksa paketinki). Onaylı karakterlerin meta'sında `identity` var; `listLibraryCharacters` aynı stil + çizgi stilindekileri verir, casting `reuse` ile, Stüdyo "Kütüphaneden kullan" (`reuseCharacter`) ile tekrar kullanır.
- Seriler (`pipeline/src/series.ts`): `input.series`; "auto" stil seçimi serinin önceki paketini devralır, kütüphanede serinin karakterleri önce gelir. Seri adı karşılaştırması `sameSeries` ile (büyük/küçük harf ve boşluk duyarsız).
- Ajan modelleri: her ajanın kodda varsayılan sınıfı var; kullanıcı Stüdyo → Modeller'den ajan başına model seçer (`settings/models.json`, `core/models.ts` → `AGENT_ROLES`). Yeni ajan eklerken `AGENT_ROLES`'a ve Modeller sayfasının gruplarına ekle; seçim `runStructured` içinde `modelFor` ile uygulanır.
- Sürüm: tek kaynak kök `package.json`. `pnpm release [patch|minor|major] [--publish]` (main, temiz ağaç, typecheck+test, CHANGELOG, etiket; `--publish` olmadan dışarı bir şey gitmez). Stüdyo GitHub'daki son release'i görünce güncelleme uyarısı gösterir (`YS_UPDATE_CHECK=0` kapatır). Dev olmadan: `pnpm studio:build && pnpm studio:start`.
- Stüdyo API'si: yazma istekleri yalnız aynı kökenden ve JSON (`apps/studio/src/proxy.ts`). Bölüm durumunu değiştiren her eylem, iş sürerken reddedilir (`episodeBusy`: Stüdyo işi + durum dosyası); çalışan pipeline durumu bellekten yeniden yazar, araya giren değişiklik kaybolur.
- Paylaşılan kütüphane (library/…) bir bölümün kararıyla yerinde değiştirilmez: insan reddi yeni türetilmiş anahtara çizdirir, gerçeklik kapalı geçişler `fidelitySkipped` ile işaretlenir, tekrar kullanılan karakteri reddetmek yalnız o bölümden ayırır.
- Model SVG'si temizlenirken `&`/`\` içeren değerler, dış `url()` ve izin listesi dışı `style` özellikleri atılır; temizleyiciye dokunursan `packages/core/test/sanitize.test.ts`'e atlatma örneği ekle.
- `apps/studio`: arayüz metinleri `src/lib/i18n.ts` sözlüğünden (TR + EN, ikisi de zorunlu); bileşenlerde sabit metin yazma.

## Sürümler
- Her bağımlılık en son sürümde ve **tam sürüm** sabitli (`^` yok). pnpm'in minimumReleaseAge kuralına takılan çok yeni sürümler `pnpm-workspace.yaml` → `minimumReleaseAgeExclude` listesinde. Büyük sürüm atlamalarında (ör. postgres 4) entegrasyon testi çalıştır.
- Docker: postgres 18.6, redis 8.10, rustfs 1.0.4. Portlar diğer projelerle çakışmasın diye 5433/6380/9000.

## Kurallar
- **Maliyet önce:** Yeni sağlayıcı eklerken `price` ve `qualityPrior` zorunlu. Fiyat kaynağını yorumda belirt. Yerel (ComfyUI) seçenek varsa önce o.
- Endpoint veya alan adlarından emin değilsen spec'i `verified: false` ekle.
- Kod yorumları ve pipeline logları Türkçe; Stüdyo arayüzü Türkçe + İngilizce (sözlükten).
- Her değişiklikten sonra: `pnpm typecheck && pnpm test`.
- Bütçe tavanı yalnız ücretli görsel/ses/video API'leri içindir (`ledger.spent` "llm" kayıtlarını saymaz). Claude ajan çağrıları tavanı aşabilir (kullanıcı kararı, 30 Eki); maliyetleri Stüdyo'da ayrıca gösterilir. Bu yüzden Claude çağrısını tavanla durdurma.
- Gerçek API çağrısı (para harcar) yapan komutları kullanıcı istemeden çalıştırma. Para harcamadan kontrol için `pnpm ys plan`.
