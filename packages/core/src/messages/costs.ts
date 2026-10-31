/**
 * costs mesajları (bkz. ./index.ts): maliyet tahmini, birimler, fiyat açıklamaları ve fiyat notları.
 * Birim anahtarlarının `.one` eki tekil biçimdir (miktar 1 iken; Türkçede aynı).
 */
export const COSTS_MESSAGES = {
  // --- birimler (defterdeki eski Türkçe etiketler de bunlara eşlenir: unitText)
  "unit.image": { tr: "görsel", en: "images" },
  "unit.image.one": { tr: "görsel", en: "image" },
  "unit.sec": { tr: "sn", en: "s" },
  "unit.chars": { tr: "karakter", en: "characters" },
  "unit.chars.one": { tr: "karakter", en: "character" },
  "unit.min": { tr: "dk", en: "min" },
  "unit.none": { tr: "—", en: "—" },
  "unit.call": { tr: "çağrı", en: "calls" },
  "unit.call.one": { tr: "çağrı", en: "call" },
  "unit.asset": { tr: "varlık", en: "assets" },
  "unit.asset.one": { tr: "varlık", en: "asset" },
  "unit.scene": { tr: "sahne", en: "scenes" },
  "unit.scene.one": { tr: "sahne", en: "scene" },
  "unit.object": { tr: "nesne", en: "objects" },
  "unit.object.one": { tr: "nesne", en: "object" },
  "unit.frame": { tr: "kare", en: "frames" },
  "unit.frame.one": { tr: "kare", en: "frame" },
  "unit.billedSec": { tr: "sn (faturalanan)", en: "s (billed)" },
  "unit.videoSec": { tr: "sn video", en: "s of video" },
  "unit.credits": { tr: "kredi", en: "credits" },
  "unit.usd": { tr: "USD", en: "USD" },

  // --- fiyat kuralı (describePrice)
  "price.free": { tr: "ücretsiz (yerel)", en: "free (local)" },
  "price.perOutput": { tr: "${usd}/görsel", en: "${usd}/image" },
  "price.perSecond": { tr: "${usd}/sn{step}{min}{audio}", en: "${usd}/s{step}{min}{audio}" },
  "price.step": { tr: " ({n} sn adımlarla)", en: " (in {n} s steps)" },
  "price.minSec": { tr: ", en az {n} sn", en: ", at least {n} s" },
  "price.withAudio": { tr: "; sesli ${usd}/sn", en: "; with audio ${usd}/s" },
  "price.per1k": { tr: "${usd}/1000 karakter", en: "${usd}/1000 characters" },
  "price.perMinute": { tr: "${usd}/dk", en: "${usd}/min" },

  // --- sağlayıcı fiyat notları (Fiyatlar sayfası)
  "price.note.elevenlabs": {
    tr: "Abonelikte karakter kotasından düşer; ücretsiz plan ticari kullanıma izin vermez",
    en: "Deducted from the subscription's character quota; the free plan does not allow commercial use",
  },
  "price.note.sfx": { tr: "Ses efekti; 0.5–30 sn", en: "Sound effects; 0.5–30 s" },
  "price.note.perMegapixel": { tr: "~1 MP; megapiksel başına", en: "~1 MP; per megapixel" },
  "price.note.kling": { tr: "sessiz ${silent}/sn, sesli ${audio}/sn", en: "silent ${silent}/s, with audio ${audio}/s" },
  "price.note.klingPro": {
    tr: "sessiz ${silent}/sn, sesli ${audio}/sn (ses kontrolü ${control}/sn)",
    en: "silent ${silent}/s, with audio ${audio}/s (audio control ${control}/s)",
  },
  "price.note.seedance": { tr: "720p, video girdisi yok; ses dahil", en: "720p, no video input; audio included" },
  "price.note.minimaxTurbo": {
    tr: "768P standart fiyat (16 Kas 2026'dan); öncesinde %30–35 kampanya",
    en: "768P standard rate (from 16 Nov 2026); 30–35% promo before that",
  },
  "price.note.vidu": { tr: "720p; ses fiyatı değiştirmez", en: "720p; audio does not change the price" },
  "price.note.nanoBanana21": {
    tr: "1K; $30/1M görsel token. Batch API'de $0.0168",
    en: "1K; $30/1M image tokens. $0.0168 with the Batch API",
  },
  "price.note.nanoBanana2": {
    tr: "Google'ın listesinde 'legacy'; 2.1'in iki katı",
    en: "Listed as 'legacy' by Google; twice the price of 2.1",
  },
  "price.note.geminiTts": {
    tr: "Ses $9/1M token (2027'den $18), 25 token/sn; ~14 karakter/sn varsayımıyla 1000 karakter ≈ 71 sn",
    en: "Audio $9/1M tokens ($18 from 2027), 25 tokens/s; assuming ~14 characters/s, 1000 characters ≈ 71 s",
  },
  "price.note.veo": {
    tr: "Doğrulanmadı: fiyat sayfasında artık Veo yok (preview kapandı)",
    en: "Unverified: Veo is no longer on the pricing page (preview shut down)",
  },

  // --- bölüm tahmini (estimate.ts)
  "cost.stage.style": { tr: "Stil", en: "Style" },
  "cost.stage.story": { tr: "Hikâye", en: "Story" },
  "cost.stage.script": { tr: "Senaryo", en: "Script" },
  "cost.stage.cast": { tr: "Casting", en: "Casting" },
  "cost.stage.concept": { tr: "Konsept görselleri", en: "Concept art" },
  "cost.stage.voice": { tr: "Seslendirme", en: "Voice-over" },
  "cost.stage.shots": { tr: "Çekim planı", en: "Shot plan" },
  "cost.stage.keyframes": { tr: "Kareler", en: "Frames" },
  "cost.stage.clips": { tr: "Animasyon", en: "Animation" },
  "cost.stage.timeline": { tr: "Kurgu", en: "Edit" },
  "cost.stage.render": { tr: "Render", en: "Render" },
  "cost.stage.review": { tr: "İnceleme", en: "Review" },
  "cost.join": { tr: "{a}; {b}", en: "{a}; {b}" },
  "cost.noProvider": {
    tr: '"{capability}" için uygun sağlayıcı yok (anahtar eksik olabilir)',
    en: 'No suitable provider for "{capability}" (an API key may be missing)',
  },
  "cost.overBudget": {
    tr: "Tahmini toplam (${total}) bütçe tavanını (${cap}) aşıyor",
    en: "Estimated total (${total}) exceeds the budget cap (${cap})",
  },
  "cost.basis.noProvider": { tr: "sağlayıcı yok", en: "no provider" },
  "cost.basis.measured": { tr: "ölçüm (n={n})", en: "measured (n={n})" },
  "cost.basis.default": { tr: "varsayılan", en: "default" },
  "cost.basis.agents": { tr: "ölçüm (29 Eki)", en: "measured (Oct 29)" },
  "cost.basis.vectorConcept": {
    tr: "ölçüm (30 Eki): karakter ~${character}, mekân ~${location}",
    en: "measured (Oct 30): character ~${character}, location ~${location}",
  },
  "cost.basis.gate": {
    tr: "her çizim kalite kapısından geçer (~%{pct} ek çizim)",
    en: "every drawing passes the quality gate (~{pct}% extra drawings)",
  },
  "cost.basis.castGuess": {
    tr: "kadro tahmini ({characters} karakter, {locations} mekân)",
    en: "cast estimate ({characters} characters, {locations} locations)",
  },
  "cost.basis.textGuess": { tr: "metin tahmini", en: "text estimate" },
  "cost.basis.shotGuess": { tr: "çekim sayısı tahmini", en: "shot count estimate" },
  "cost.basis.scenes": { tr: "tahmin: sahne başı ~${usd} (kısa JSON)", en: "estimate: ~${usd} per scene (short JSON)" },
  "cost.basis.sideViews": {
    tr: "yürüyen karakter başına yan görünüş (~${usd} + kapı); kütüphanede olanlar ücretsiz",
    en: "side view per walking character (~${usd} + gate); those already in the library are free",
  },
  "cost.basis.props": {
    tr: "tahmin: yeni nesneler; kütüphanede olanlar ücretsiz",
    en: "estimate: new objects only; those already in the library are free",
  },
  "cost.basis.draft": {
    tr: "tahmin: taslak kare eleştirisi + sahnelerin ~%{pct}'i yeniden planlanır",
    en: "estimate: draft frame critique + ~{pct}% of scenes re-planned",
  },
  "cost.basis.qa": {
    tr: "kare kontrolü: ~%{pct} yeniden çizim, ~${usd}/kontrol (ölçüm 30 Eki)",
    en: "frame check: ~{pct}% redrawn, ~${usd}/check (measured Oct 30)",
  },
  "cost.basis.noClips": { tr: "hareket modu: animasyon yok", en: "motion mode: no animation" },
  "cost.basis.clips": { tr: "{n} klip", en: "{n} clip(s)" },
  "cost.basis.local": { tr: "yerel", en: "local" },
  "cost.basis.renderVector": {
    tr: "tahmin: ~{x}× video süresi (vektör sahneler)",
    en: "estimate: ~{x}× video length (vector scenes)",
  },
  "cost.basis.render": { tr: "ölçüm (29 Eki): ~1,1× video süresi", en: "measured (Oct 29): ~1.1× video length" },
  "cost.basis.review": {
    tr: "tahmin: {n} kare/çağrı, ~${usd}/çağrı; dersler sonraki bölümlere aktarılır",
    en: "estimate: {n} frames/call, ~${usd}/call; lessons carry over to later episodes",
  },
  // Model sütunundaki açıklama: "claude (SVG)", "yerel (Remotion)"…
  "cost.via.svg": { tr: "SVG", en: "SVG" },
  "cost.via.draftReview": { tr: "taslak denetimi", en: "draft review" },
  "cost.via.vision": { tr: "görsel", en: "vision" },
  "cost.via.local": { tr: "yerel", en: "local" },
  "cost.via.remotion": { tr: "yerel (Remotion)", en: "local (Remotion)" },
} as const;
