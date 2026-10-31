/** pipeline mesajları (bkz. ./index.ts). Günlük satırlarının Türkçesi CLI çıktısıyla birebir aynıdır (testler ve uyarı düzeyi buna bakar). */
import { STYLE_PACKS } from "../styles.ts";

/** Stil paketi adları (günlükte paket adı da seçili dilde görünsün). */
const STYLE_PACK_NAMES = Object.fromEntries(STYLE_PACKS.map((p) => [`style.pack.${p.id}`, p.name])) as Record<
  `style.pack.${string}`,
  { readonly tr: string; readonly en: string }
>;

export const PIPELINE_MESSAGES = {
  ...STYLE_PACK_NAMES,

  // ---- ortak parçalar ----
  "log.item": { tr: "{id}: {error}", en: "{id}: {error}" },
  "log.join.line": { tr: "{a}\n{b}", en: "{a}\n{b}" },
  "log.join.indented": { tr: "{a}\n  {b}", en: "{a}\n  {b}" },
  "log.cached": { tr: ", önbellek", en: ", cached" },
  "log.gate.score": { tr: 'tanınırlık {recognizable}/10 ("{guess}")', en: 'recognizability {recognizable}/10 ("{guess}")' },
  "log.gate.scoreFidelity": {
    tr: 'tanınırlık {recognizable}/10 ("{guess}"), gerçeğe sadakat {fidelity}/10',
    en: 'recognizability {recognizable}/10 ("{guess}"), fidelity to reality {fidelity}/10',
  },

  // ---- çalışma ve ajanlar ----
  "log.run.models": { tr: "  model seçimi: {list}", en: "  model choice: {list}" },
  "log.agent.failed": { tr: "  ajan {agent} başarısız · ${cost}", en: "  agent {agent} failed · ${cost}" },
  "log.agent.done": { tr: "  ajan {name} · {model} · ${cost} · {sec} sn", en: "  agent {name} · {model} · ${cost} · {sec} s" },

  // ---- varlık tasarımı ve kalite kapısı ----
  "log.ref.found": { tr: '  {name}: referans "{query}" → {sources}', en: '  {name}: reference "{query}" → {sources}' },
  "log.ref.none": {
    tr: '  {name}: referans "{query}" için görsel bulunamadı, tarifle çiziliyor',
    en: '  {name}: no image found for reference "{query}", drawing from the description',
  },
  "log.ref.searchFailed": { tr: "  referans araması başarısız ({source}): {error}", en: "  reference search failed ({source}): {error}" },
  "log.ref.downloadFailed": { tr: "  referans indirilemedi ({title}): {error}", en: "  reference could not be downloaded ({title}): {error}" },
  "log.ref.vectorSearchFailed": { tr: "  hazır SVG araması başarısız: {error}", en: "  ready-made SVG search failed: {error}" },
  "log.asset.plan": { tr: "  {name}: çizim planı → {subject}", en: "  {name}: drawing plan → {subject}" },
  "log.asset.planMoved": {
    tr: "  {name}: çizim planı → {subject} (bu çizime girmeyen: {moved})",
    en: "  {name}: drawing plan → {subject} (left out of this drawing: {moved})",
  },
  "log.asset.planFailed": {
    tr: "  {name}: çizim planı hazırlanamadı, tarifle çiziliyor ({error})",
    en: "  {name}: drawing plan could not be prepared, drawing from the description ({error})",
  },
  "log.asset.fromLibrary": { tr: "  {name}: kütüphaneden (kapı ✓)", en: "  {name}: from the library (gate ✓)" },
  "log.asset.fromLibraryChecked": { tr: "  {name}: kütüphaneden, kapı ✓ ({score})", en: "  {name}: from the library, gate ✓ ({score})" },
  "log.asset.libraryFailed": {
    tr: "  {name}: kütüphanedeki çizim kapıdan geçemedi ({score}), yeniden çiziliyor",
    en: "  {name}: the library drawing failed the gate ({score}), redrawing",
  },
  "log.asset.previousPasses": {
    tr: "  {name}: önceki deneme bugünkü kurala göre geçiyor (gerçeklik denetimi kapalı), yeniden çizilmeden kullanılıyor",
    en: "  {name}: the previous attempt passes under today's rule (realism check off), used without redrawing",
  },
  "log.asset.previouslyRejected": {
    tr: "  {name}: bu bölümde kalite kapısından reddedilmişti ({score}), yeniden çizilmiyor",
    en: "  {name}: already rejected by the quality gate in this episode ({score}), not redrawing",
  },
  "log.asset.designerError": { tr: "  {name}: deneme {attempt} tasarımcı hatası ({error})", en: "  {name}: attempt {attempt} designer error ({error})" },
  "log.asset.invalidSvg": { tr: "  {name}: deneme {attempt} geçersiz SVG ({error})", en: "  {name}: attempt {attempt} invalid SVG ({error})" },
  "log.asset.attempt": { tr: "  {name}: deneme {attempt}, {score} {mark}", en: "  {name}: attempt {attempt}, {score} {mark}" },
  "log.asset.hopeless": {
    tr: "  {name}: iki çizim de tanınmadı (≤{max}/10), yeniden çizilmiyor; karar insanın",
    en: "  {name}: neither drawing was recognized (≤{max}/10), not redrawing; a human decides",
  },
  "log.asset.rejected": {
    tr: "  ✗ REDDEDİLDİ {name}: {draws} denemede kalite kapısı geçilemedi ({score}): {defects}",
    en: "  ✗ REJECTED {name}: failed the quality gate in {draws} attempts ({score}): {defects}",
  },
  "log.asset.drawn": { tr: "  {name}: çizildi ({kb} KB, {draws} deneme)", en: "  {name}: drawn ({kb} KB, {draws} attempts)" },
  "log.side.name": { tr: "{name} (yan görünüş)", en: "{name} (side view)" },
  "log.side.fallback": {
    tr: "  {name}: yan görünüş kalite kapısından geçemedi; karakter önden yürüyecek",
    en: "  {name}: the side view failed the quality gate; the character will walk in front view",
  },
  "log.asset.readyMadeFailed": { tr: "  {name}: hazır SVG aranamadı ({error})", en: "  {name}: could not search for a ready-made SVG ({error})" },
  "log.asset.readyMade": {
    tr: '  {name}: hazır SVG "{title}" ({license}) → {score} {mark}',
    en: '  {name}: ready-made SVG "{title}" ({license}) → {score} {mark}',
  },
  "err.asset.rejectedBefore": {
    tr: "{name}: kalite kapısı geçilemedi (önceki deneme); Stüdyo'da kabul et ya da yeniden çizdir",
    en: "{name}: failed the quality gate (previous attempt); accept it or have it redrawn in the Studio",
  },
  "err.asset.rejected": { tr: "{name}: kalite kapısı geçilemedi ({score})", en: "{name}: failed the quality gate ({score})" },
  "err.asset.rigMissing": { tr: "iskelet parçası eksik: {parts}", en: "missing rig parts: {parts}" },

  // ---- konsept ----
  "log.concept.reused": {
    tr: "  ♻ {name}: kütüphaneden ({count} bölümde kullanıldı), çizilmedi",
    en: "  ♻ {name}: from the library (used in {count} episodes), not drawn",
  },
  "log.concept.resume": {
    tr: "  devam: {todo} eksik varlık çizilecek, {ready} hazır",
    en: "  resume: {todo} missing assets to draw, {ready} ready",
  },
  "log.concept.gateWait": {
    tr: "  ⏸ kalite kapısı: {names} reddedildi; Stüdyo'da kabul et ya da notla yeniden çizdir",
    en: "  ⏸ quality gate: {names} rejected; accept or redraw with a note in the Studio",
  },
  "log.concept.candidate": { tr: "  {id} aday ✓ ({provider}{cached})", en: "  {id} candidate ✓ ({provider}{cached})" },
  "err.concept.rejected": {
    tr: 'Kalite kapısı: {names} kabul edilebilir çizilemedi. Konsept sekmesinde kusurları gör; "Yeni adaylar üret" ile yeniden çizdir.',
    en: 'Quality gate: {names} could not be drawn acceptably. See the defects in the concept tab; redraw with "Generate new candidates".',
  },

  // ---- vektör çekim planı, taslak, önizleme ----
  "log.scene.planned": {
    tr: "  {scene}{revision}: {shots} çekim, {props} yeni nesne, {backgrounds} yeni mekân{dropped}",
    en: "  {scene}{revision}: {shots} shots, {props} new props, {backgrounds} new locations{dropped}",
  },
  "log.scene.revision": { tr: " (düzeltme)", en: " (revision)" },
  "log.scene.dropped": { tr: ", {n} bilinmeyen katman atıldı", en: ", {n} unknown layers dropped" },
  "log.scene.planReused": { tr: "  {scene}: önceki çalıştırmanın planı kullanıldı", en: "  {scene}: reused the plan from the previous run" },
  "log.shots.vector": { tr: "  {shots} vektör çekim, {props} nesne/mekân", en: "  {shots} vector shots, {props} props/locations" },
  "log.review.batchSkipped": { tr: "  inceleme grubu atlandı: {error}", en: "  review batch skipped: {error}" },
  "log.stills.wait": {
    tr: "  başka bir render sürüyor (süreç {pid}); kareler için sıra bekleniyor",
    en: "  another render is running (process {pid}); waiting in line for the frames",
  },
  "log.preview.done": { tr: "  önizleme: {n} çekim karesi", en: "  preview: {n} shot frames" },
  "log.preview.failed": { tr: "  önizleme kareleri çıkarılamadı ({error})", en: "  preview frames could not be extracted ({error})" },
  "log.draft.failed": {
    tr: "  ⚠ taslak kareler çıkarılamadı, taslak denetimi atlandı: {reason}",
    en: "  ⚠ draft frames could not be extracted, draft review skipped: {reason}",
  },
  "log.draft.summary": {
    tr: "  taslak: {frames} kare, ortalama {avg}/10; yeniden planlanacak sahne: {scenes}",
    en: "  draft: {frames} frames, average {avg}/10; scenes to replan: {scenes}",
  },
  "log.lessons.curated": { tr: "  dersler ({target}): {before} → {after} kural", en: "  lessons ({target}): {before} → {after} rules" },
  "log.lessons.curatorSkipped": { tr: "  ders küratörü atlandı: {error}", en: "  lesson curator skipped: {error}" },
  "log.props.failed": {
    tr: "  {n} nesne çizilemedi, sahnelerden çıkarılacak:\n  {list}",
    en: "  {n} props could not be drawn and will be removed from the scenes:\n  {list}",
  },
  "log.geo.fromLibrary": { tr: "  {id}: kütüphaneden (gerçek veri)", en: "  {id}: from the library (real data)" },
  "log.geo.map": { tr: "  {id}: harita gerçek veriden üretildi ({kb} KB)", en: "  {id}: map generated from real data ({kb} KB)" },
  "log.geo.flag": { tr: "  {id}: bayrak gerçek veriden üretildi ({kb} KB)", en: "  {id}: flag generated from real data ({kb} KB)" },
  "log.preview.trial": { tr: "  deneme {scene} ✓ ({provider})", en: "  trial {scene} ✓ ({provider})" },

  // ---- aşamalar ----
  "log.style.custom": { tr: "  özel stil: {style}", en: "  custom style: {style}" },
  "log.style.pack": { tr: "  stil paketi: {pack}", en: "  style pack: {pack}" },
  "log.style.series": { tr: '  stil paketi (seri "{series}"): {pack}', en: '  style pack (series "{series}"): {pack}' },
  "log.style.auto": { tr: "  stil paketi (otomatik): {pack}: {reason}", en: "  style pack (automatic): {pack}: {reason}" },
  "log.story.done": { tr: '  "{title}" — {beats} beat', en: '  "{title}" — {beats} beats' },
  "log.script.draftReused": { tr: "  taslak: önceki çalıştırmanın taslağı kullanıldı", en: "  draft: reused the draft from the previous run" },
  "log.script.draft": { tr: "  taslak: {scenes} sahne, {words} kelime", en: "  draft: {scenes} scenes, {words} words" },
  "log.script.doctor": { tr: "  doktor: {words} kelime; {notes} düzeltme{kept}", en: "  doctor: {words} words; {notes} fixes{kept}" },
  "log.script.keptDraft": { tr: " (sahne yapısı değişti, taslak kullanıldı)", en: " (scene structure changed, the draft was used)" },
  "log.cast.reuse": { tr: "  ♻ kütüphaneden tekrar kullanılacak: {names}", en: "  ♻ reused from the library: {names}" },
  "log.cast.nonHuman": {
    tr: "  insan olmayan {n} oyuncu nesne olarak çizilecek: {names}",
    en: "  {n} non-human cast members will be drawn as props: {names}",
  },
  "log.cast.done": { tr: "  {characters} karakter, {locations} mekân", en: "  {characters} characters, {locations} locations" },
  "log.voice.scene": { tr: "  {scene}: {sec} sn ({provider})", en: "  {scene}: {sec} s ({provider})" },
  "log.shots.done": { tr: "  {shots} çekim ({clips} AI klip)", en: "  {shots} shots ({clips} AI clips)" },
  "log.keyframe.failed": { tr: "  {shot} çizilemedi: {error}", en: "  {shot} could not be drawn: {error}" },
  "log.keyframe.redrawFailed": {
    tr: "  {shot} yeniden çizilemedi, ilk kare kullanılıyor: {error}",
    en: "  {shot} could not be redrawn, using the first frame: {error}",
  },
  "log.keyframe.done": { tr: "  {shot} {mark} ({provider}{cached}{check}{issues})", en: "  {shot} {mark} ({provider}{cached}{check}{issues})" },
  "log.keyframe.check": { tr: ", kontrol {score}/10", en: ", check {score}/10" },
  "log.frame.checkFailed": { tr: "  {shot}: kare kontrolü yapılamadı ({error})", en: "  {shot}: frame check failed ({error})" },
  "log.clip.done": { tr: "  {shot} klip ✓ ({provider})", en: "  {shot} clip ✓ ({provider})" },
  "log.clip.skipped": { tr: "  {shot} klip atlandı: {error}", en: "  {shot} clip skipped: {error}" },
  "log.timeline.done": { tr: "  {min} dk, {visuals} görsel", en: "  {min} min, {visuals} visuals" },
  "log.render.progress": { tr: "  render %{pct}", en: "  render {pct}%" },
  "log.render.wait": { tr: "  başka bir render sürüyor (süreç {pid}); sıra bekleniyor", en: "  another render is running (process {pid}); waiting in line" },
  "log.render.retry": {
    tr: "⚠ render geçici bir hatayla düştü ({reason}); baştan bir kez daha deneniyor",
    en: "⚠ render failed with a transient error ({reason}); retrying once from the start",
  },
  "log.render.done": { tr: "  ✓ {path}", en: "  ✓ {path}" },
  "log.review.summary": {
    tr: "  {frames} kare, ortalama {avg}/10; sorunlar: {issues}",
    en: "  {frames} frames, average {avg}/10; issues: {issues}",
  },
  "log.review.noIssues": { tr: "yok", en: "none" },
  "log.review.lesson": { tr: "  ders ({target}): {rule}", en: "  lesson ({target}): {rule}" },

  // ---- hatalar ----
  "err.episode.notFound": { tr: "Bölüm bulunamadı: {id}", en: "Episode not found: {id}" },
  "err.store.missing": { tr: "Depoda yok: {key}", en: "Not in storage: {key}" },
  "err.missing": { tr: "{what} yok", en: "{what} missing" },
  "err.preview.needConcept": { tr: "Önce casting ve konsept aşamaları çalışmalı", en: "The cast and concept stages must run first" },
  "err.preview.vector": {
    tr: "Vektör modunda deneme karesi yok; varlıklar zaten önizleniyor",
    en: "No trial frames in vector mode; the assets are already previewed",
  },
  "err.selection.missing": { tr: "Seçim yapılmamış: {ids}", en: "Nothing selected for: {ids}" },
  "err.voice.noProvider": { tr: "Seslendirme için uygun sağlayıcı yok", en: "No suitable provider for the voice-over" },
  "err.voice.quota": {
    tr: "{provider} kotası yetmiyor: {chars} karakter gerekli, {left} kaldı ({plan}{reset}). Sesi değiştir veya planı yükselt.",
    en: "{provider} quota is not enough: {chars} characters needed, {left} left ({plan}{reset}). Change the voice or upgrade the plan.",
  },
  "err.voice.quotaReset": { tr: ", yenilenme {date}", en: ", resets {date}" },
  "err.keyframes.failed": {
    tr: "{n} kare çizilemedi (diğerleri kaydedildi, devam edince yalnız bunlar denenir):\n{list}",
    en: "{n} frames could not be drawn (the others were saved; resuming retries only these):\n{list}",
  },
  "err.timeline.missing": { tr: "Timeline için script, voice, shots, keyframes gerekli", en: "The timeline needs script, voice, shots and keyframes" },
  "err.lock.busy": {
    tr: "Bu bölüm zaten çalışıyor (süreç {pid}, {startedAt}); bitmesini bekle ya da iptal et",
    en: "This episode is already running (process {pid}, {startedAt}); wait for it to finish or cancel it",
  },
  "err.media.probe": { tr: "ffprobe süre okuyamadı: {output}", en: "ffprobe could not read the duration: {output}" },
  "err.flag.unknownCode": { tr: "bilinmeyen bayrak kodu: {code}", en: "unknown flag code: {code}" },
  "err.flag.notFound": { tr: "bayrak bulunamadı: {code}", en: "flag not found: {code}" },

  // ---- Stüdyo eylemleri (actions.ts) ----
  "err.action.scriptFirst": { tr: "Önce senaryo üretilmeli", en: "The script must be generated first" },
  "err.action.noCandidate": { tr: "Aday yok: {id}", en: "No candidate: {id}" },
  "err.action.scriptApproved": {
    tr: "Senaryo onaylandı; düzenlemek için önce onayı geri al",
    en: "The script is approved; withdraw the approval before editing",
  },
  "err.action.noScene": { tr: "Sahne yok: {id}", en: "No such scene: {id}" },
  "err.action.conceptApproved": { tr: "Konsept onaylandı; hareket modu değiştirilemez", en: "The concept is approved; the motion mode cannot be changed" },
  "err.action.noShots": { tr: "Yeniden çizilecek çekim yok", en: "No shots to redraw" },
  "err.action.rendered": {
    tr: "Video render edildi; ses değiştirmek için yeni bölüm aç",
    en: "The video is rendered; open a new episode to change the voice",
  },
  "err.action.noGateRecord": { tr: "Kapı kaydı yok: {key}", en: "No gate record: {key}" },
  "err.action.rejectedMissing": { tr: "Reddedilen çizim depoda yok", en: "The rejected drawing is not in storage" },
  "err.action.notInCast": { tr: "Kadroda yok: {id}", en: "Not in the cast: {id}" },
  "err.action.notApproved": { tr: "Kütüphanede onaylı karakter değil", en: "Not an approved character in the library" },
  "err.bank.notFound": { tr: "Karakter bankasında yok: {id}", en: "Not in the character bank: {id}" },
  "err.bank.noPack": {
    tr: "{name} bir stil paketiyle çizilmedi (özel stil); stili yeniden kurulamadığı için bankadan seçilemez",
    en: "{name} was not drawn with a style pack (custom style); its style cannot be rebuilt, so it cannot be picked from the bank",
  },
  "err.bank.mixedStyles": {
    tr: "Seçilen karakterler farklı stillerde çizilmiş: {names}. Bölüm tek stilde olur; aynı stildekileri seç",
    en: "The chosen characters were drawn in different styles: {names}. An episode has one style; pick characters of the same style",
  },
  "err.bank.badPack": { tr: "Bilinmeyen stil paketi: {pack}", en: "Unknown style pack: {pack}" },
  "err.bank.vectorOnly": {
    tr: "Karakter bankası yalnız vektör modunda kullanılabilir",
    en: "The character bank is only available in vector mode",
  },
  "log.bank.added": { tr: "Karakter bankasından kadroya: {names}", en: "From the character bank into the cast: {names}" },
  "log.bank.styleMismatch": {
    tr: "  {name}: bu bölümün stilinde değil, kadroya eklenmedi",
    en: "  {name}: not in this episode's style, not added to the cast",
  },
  "err.action.realismSkipped": {
    tr: "Bu karakter gerçeklik denetimi kapalıyken geçti; gerçeklik açık bölümde kullanılamaz",
    en: "This character passed with the realism check off; it cannot be used in an episode with realism on",
  },
} as const;
