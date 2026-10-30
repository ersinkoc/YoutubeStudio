# YoutubeStudio: Claude için proje notları

Plan ve mimari: `docs/PROJE_PLANI.md`. Büyük kararları değiştirmeden önce oradaki ilgili bölüme bak ve gerekirse güncelle.

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
- **Kalite kapısı ve gerçeklik zorunlu:** hiçbir SVG denetlenmeden kullanılmaz (`designAsset` → `gateCheck`: kör tahmin + `assetGate`, eşikler `core/rules.ts`'te; Stüdyo Kurallar sayfası aynı sabitleri gösterir). Gerçek özneler ve her nesne internetten (Wikipedia/Commons) bulunan görsele bakılarak çizilir (`pipeline/src/reference.ts`). Eşik değiştirirken yalnız `QUALITY_GATE`'i değiştir.
- Harita ve bayrak gibi gerçek dünya bilgisi Claude'a çizdirilmez: yönetmen `map`/`flag` tarifi verir, `pipeline/src/geo.ts` gerçek veriden üretir. Yeni "olgusal" varlık türü (logo, anıt, bina…) eklerken de önce gerçek veri kaynağı ara.
- `apps/studio`: arayüz metinleri `src/lib/i18n.ts` sözlüğünden (TR + EN, ikisi de zorunlu); bileşenlerde sabit metin yazma.

## Sürümler
- Her bağımlılık en son sürümde ve **tam sürüm** sabitli (`^` yok). pnpm'in minimumReleaseAge kuralına takılan çok yeni sürümler `pnpm-workspace.yaml` → `minimumReleaseAgeExclude` listesinde. Büyük sürüm atlamalarında (ör. postgres 4) entegrasyon testi çalıştır.
- Docker: postgres 18.6, redis 8.10, rustfs 1.0.4. Portlar diğer projelerle çakışmasın diye 5433/6380/9000.

## Kurallar
- **Maliyet önce:** Yeni sağlayıcı eklerken `price` ve `qualityPrior` zorunlu. Fiyat kaynağını yorumda belirt. Yerel (ComfyUI) seçenek varsa önce o.
- Endpoint veya alan adlarından emin değilsen spec'i `verified: false` ekle.
- Kod yorumları ve pipeline logları Türkçe; Stüdyo arayüzü Türkçe + İngilizce (sözlükten).
- Her değişiklikten sonra: `pnpm typecheck && pnpm test`.
- Gerçek API çağrısı (para harcar) yapan komutları kullanıcı istemeden çalıştırma. Para harcamadan kontrol için `pnpm ys plan`.
