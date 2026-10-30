import {
  applyLineStyle,
  prefixSvgIds,
  resolveLayout,
  RIG,
  sanitizeSvg,
  type LineStyle,
  type PlacedLayer,
  type RigPart,
  type Timeline,
  type VectorAnim,
  type VectorAnimType,
  type VectorExpression,
  type VectorAsset,
  type VectorLayer,
  type VectorMood,
  type VectorText,
  TEXT_RULES,
} from "@ys/core";
import { useMemo, type CSSProperties } from "react";
import { AbsoluteFill, Easing, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * Vektör sahne: Claude'un JSON tarifini deterministik olarak çizer. Bütün hareket burada hesaplanır;
 * karakter iskeleti, yazı efektleri ve kamera için model çağrısı yapılmaz.
 */

type Visual = Timeline["visuals"][number];
type Assets = Timeline["vectorAssets"];

const W = 1920;
const H = 1080;
const ease = Easing.inOut(Easing.cubic);

/** Animasyonun kendi penceresindeki ilerleme (0–1); pencere dışında sınırda kalır. */
function local(p: number, a: VectorAnim): number {
  const span = Math.max(0.0001, a.end - a.start);
  return Math.min(1, Math.max(0, (p - a.start) / span));
}

const active = (p: number, a: VectorAnim) => p >= a.start && p <= a.end;

/** Pencerenin başında ve sonunda yumuşak giriş/çıkış ağırlığı (0–1): jestler aniden başlayıp bitmesin. */
function envelope(p: number, a: VectorAnim, fade = 0.15): number {
  if (!active(p, a)) return 0;
  const q = local(p, a);
  const span = Math.max(0.0001, a.end - a.start);
  const f = Math.min(0.5, fade / span);
  return ease(Math.min(1, q / f, (1 - q) / f));
}

/** Kök <svg>'yi kutuyu dolduracak şekilde ayarlar. */
function fitSvg(svg: string, mode: "meet" | "slice"): string {
  return svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const clean = attrs.replace(/\s(width|height|preserveAspectRatio)="[^"]*"/g, "");
    return `<svg${clean} width="100%" height="100%" preserveAspectRatio="xMidYMid ${mode}" style="overflow:visible">`;
  });
}

interface Transform {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
}

/** Katman/yazı düzeyindeki animasyonlar: hepsi zaman ve tohumdan türetilir. */
function layerTransform(anims: VectorAnim[], p: number, t: number, seed: string, base: { x: number; y: number }): Transform {
  const tr: Transform = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };
  for (const a of anims) {
    const q = local(p, a);
    switch (a.type) {
      case "fade_in":
        tr.opacity *= p < a.start ? 0 : ease(q);
        break;
      case "fade_out":
        tr.opacity *= p > a.end ? 0 : 1 - ease(q);
        break;
      case "slide_in": {
        const k = 1 - Easing.out(Easing.cubic)(q);
        const d = a.from ?? "left";
        if (d === "left") tr.x -= k * (base.x + 400);
        if (d === "right") tr.x += k * (W - base.x + 400);
        if (d === "top") tr.y -= k * (base.y + 400);
        if (d === "bottom") tr.y += k * (H - base.y + 600);
        break;
      }
      case "pop":
        tr.scale *= p < a.start ? 0 : Easing.out(Easing.back(1.8))(q);
        break;
      case "float":
        if (active(p, a)) tr.y += Math.sin(t * 1.6 + random(seed) * 6) * 12;
        break;
      case "sway":
        if (active(p, a)) tr.rotate += Math.sin(t * 1.3 + random(seed) * 6) * 3;
        break;
      case "pulse":
        if (active(p, a)) tr.scale *= 1 + Math.sin(t * 4) * 0.04;
        break;
      case "spin":
        tr.rotate += 360 * q;
        break;
      case "shake":
        if (active(p, a)) {
          tr.x += Math.sin(t * 47) * 8;
          tr.rotate += Math.sin(t * 31) * 1.5;
        }
        break;
      case "cheer":
        tr.y -= Math.abs(Math.sin(t * 6)) * 18 * envelope(p, a);
        break;
      case "surprised":
        tr.y -= 10 * envelope(p, a, 0.08);
        break;
      case "move":
      case "walk": {
        const k = ease(q);
        if (a.toX !== undefined) tr.x += (a.toX - base.x) * k;
        if (a.toY !== undefined) tr.y += (a.toY - base.y) * k;
        if (a.type === "walk" && active(p, a)) tr.y -= Math.abs(Math.sin(t * 7)) * 8;
        break;
      }
      default:
        break;
    }
  }
  return tr;
}

interface PartPose {
  rotate: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

/** Kolu meşgul eden jestler; bunlardan biri sürerken kendiliğinden el hareketi yapılmaz. */
const ARM_GESTURES: VectorAnimType[] = ["wave", "point", "explain", "think", "cheer", "shrug", "surprised", "walk"];

/** İskelet parçalarının bu karedeki pozu: sürekli canlılık + Claude'un istediği jestler. */
/**
 * Yüz ifadeleri: kaş yüksekliği, göz açıklığı ve ağız eğrisi. Ağız gülümseme olarak çizilir; dikey ölçeği eksi olunca
 * ters döner ve somurtmaya dönüşür. head: başın öne düşmesi (px), droop: omuzların düşmesi (derece).
 */
const EXPRESSIONS: Record<VectorExpression, { brows: number; eyes: number; mouth: number; head: number; droop: number; lookX?: number }> = {
  neutral: { brows: 0, eyes: 1, mouth: 1, head: 0, droop: 0 },
  happy: { brows: -4, eyes: 0.9, mouth: 1.35, head: -1, droop: 0 },
  sad: { brows: 4, eyes: 0.75, mouth: -0.8, head: 6, droop: 6 },
  angry: { brows: 7, eyes: 0.8, mouth: -0.45, head: 2, droop: -3 },
  worried: { brows: -5, eyes: 1.1, mouth: -0.5, head: 3, droop: 3 },
  surprised: { brows: -10, eyes: 1.25, mouth: 1.6, head: -2, droop: 0 },
  thinking: { brows: -3, eyes: 0.9, mouth: 0.45, head: 0, droop: 0, lookX: 6 },
};

function rigPose(
  anims: VectorAnim[],
  p: number,
  t: number,
  seed: string,
  sitting = false,
  expression: VectorExpression = "neutral",
): Partial<Record<RigPart, PartPose>> {
  const pose: Partial<Record<RigPart, PartPose>> = {};
  const part = (k: RigPart) => (pose[k] ??= { rotate: 0, sx: 1, sy: 1, tx: 0, ty: 0 });
  const r = (k: string) => random(`${seed}-${k}`);
  const face = EXPRESSIONS[expression];

  // --- her zaman: nefes, baş salınımı, kolların doğal duruşu, göz kırpma ve göz gezdirme
  part("body").sy = 1 + Math.sin(t * 2.2 + r("br") * 6) * 0.01;
  part("head").rotate = Math.sin(t * 0.9 + r("h") * 6) * 2;
  part("head").ty = Math.sin(t * 2.2 + r("br") * 6) * 1.5;
  part("arm-l").rotate = 4 + Math.sin(t * 1.1 + r("al") * 6) * 2;
  part("arm-r").rotate = -4 - Math.sin(t * 1.0 + r("ar") * 6) * 2;
  part("forearm-l").rotate = -10 - Math.sin(t * 1.3 + r("fl") * 6) * 3;
  part("forearm-r").rotate = 10 + Math.sin(t * 1.2 + r("fr") * 6) * 3;
  // İfade taban pozdur; jestler bunun üstüne karışır.
  part("brows").ty = face.brows;
  part("eyes").sy = face.eyes;
  part("mouth").sy = face.mouth;
  part("head").ty += face.head;
  part("arm-l").rotate -= face.droop;
  part("arm-r").rotate += face.droop;
  const blinkEvery = 3 + r("b") * 2.5;
  if ((t + r("bp") * blinkEvery) % blinkEvery < 0.12) part("eyes").sy = 0.1;
  // Bakış her ~2,5 sn'de bir yön değiştirir; düşünürken bir yana sabitlenir.
  const look = Math.floor(t / 2.5 + r("lk") * 3);
  part("eyes").tx = face.lookX ?? (random(`${seed}-look-${look}`) - 0.5) * 8;

  // --- kendiliğinden jest: kolu meşgul eden bir animasyon yoksa ara ara anlatır gibi el hareketi
  const armsBusy = anims.some((a) => ARM_GESTURES.includes(a.type) && active(p, a));
  if (!armsBusy) {
    const every = 4 + r("g") * 2.5;
    const phase = (t + r("gp") * every) % every;
    if (phase < 1.4) {
      const k = Math.sin((phase / 1.4) * Math.PI);
      const right = random(`${seed}-gs-${Math.floor((t + r("gp") * every) / every)}`) < 0.6;
      if (right) {
        part("arm-r").rotate -= 18 * k;
        part("forearm-r").rotate += 75 * k + Math.sin(t * 5) * 6 * k;
      } else {
        part("arm-l").rotate += 18 * k;
        part("forearm-l").rotate -= 75 * k + Math.sin(t * 5) * 6 * k;
      }
      part("brows").ty = face.brows - 3 * k;
    }
  }

  if (sitting || anims.some((a) => a.type === "sit" && active(p, a))) {
    // Ön görünüşte oturuş: uyluk kısalır, baldır dik kalır (iç içe grup; ebeveynin ölçeği geri alınır).
    for (const side of ["l", "r"] as const) {
      part(`leg-${side}`).sy = SIT_THIGH;
      part(`shin-${side}`).sy = 1 / SIT_THIGH;
    }
  }

  // --- Claude'un istediği jestler; envelope ile yumuşak girip çıkar
  for (const a of anims) {
    const w = envelope(p, a);
    if (w <= 0) continue;
    const mix = (k: RigPart, field: keyof PartPose, target: number) => {
      const pp = part(k);
      pp[field] = pp[field] * (1 - w) + target * w;
    };
    switch (a.type) {
      case "wave":
        mix("arm-r", "rotate", -150);
        mix("forearm-r", "rotate", Math.sin(t * 9) * 28);
        mix("brows", "ty", -4);
        break;
      case "point":
        mix("arm-r", "rotate", -82);
        mix("forearm-r", "rotate", -6);
        mix("head", "rotate", -4);
        break;
      case "explain":
        mix("arm-r", "rotate", -22 + Math.sin(t * 3) * 6);
        mix("forearm-r", "rotate", 120 + Math.sin(t * 3.4) * 14);
        mix("arm-l", "rotate", 14 + Math.sin(t * 2.6 + 1) * 5);
        mix("forearm-l", "rotate", -60 - Math.sin(t * 3 + 1) * 12);
        mix("brows", "ty", -3 + Math.sin(t * 3) * 2);
        break;
      case "think":
        mix("arm-r", "rotate", -8);
        mix("forearm-r", "rotate", 162);
        mix("head", "rotate", 7);
        mix("brows", "ty", -5);
        mix("eyes", "tx", 5);
        break;
      case "cheer":
        mix("arm-l", "rotate", 150 + Math.sin(t * 6) * 8);
        mix("arm-r", "rotate", -150 - Math.sin(t * 6) * 8);
        mix("forearm-l", "rotate", -15);
        mix("forearm-r", "rotate", 15);
        mix("brows", "ty", -8);
        mix("mouth", "sy", 1.5);
        break;
      case "surprised":
        mix("arm-l", "rotate", 28);
        mix("arm-r", "rotate", -28);
        mix("forearm-l", "rotate", -45);
        mix("forearm-r", "rotate", 45);
        mix("brows", "ty", -10);
        mix("eyes", "sy", 1.25);
        mix("mouth", "sy", 1.6);
        break;
      case "shrug":
        mix("arm-l", "rotate", 22);
        mix("arm-r", "rotate", -22);
        mix("forearm-l", "rotate", -70);
        mix("forearm-r", "rotate", 70);
        mix("head", "rotate", -6);
        mix("brows", "ty", -6);
        break;
      case "nod":
        part("head").rotate += Math.sin(t * 6) * 7 * w;
        break;
      case "talk":
        // Konuşurken ağız açılıp kapanır; somurtan yüzde eğri ters kalır.
        part("mouth").sy = Math.sign(face.mouth) * (0.35 + Math.abs(Math.sin(t * 13)) * 0.9 * w + (1 - w) * 0.65);
        part("brows").ty += Math.sin(t * 4) * 2 * w;
        break;
      case "walk": {
        const s = Math.sin(t * 7);
        mix("leg-l", "rotate", s * 22);
        mix("leg-r", "rotate", -s * 22);
        // Diz yalnız bacak geriye giderken bükülür.
        mix("shin-l", "rotate", Math.max(0, -s) * -28);
        mix("shin-r", "rotate", Math.max(0, s) * -28);
        mix("arm-l", "rotate", -s * 16);
        mix("arm-r", "rotate", s * 16);
        mix("forearm-l", "rotate", -12);
        mix("forearm-r", "rotate", 12);
        break;
      }
      default:
        break;
    }
  }
  return pose;
}

/** Oturan karakter: uyluk kameraya doğru kısalır (ön görünüş), baldır dik kalır. */
const SIT_THIGH = 0.35;
/** Kısalan uyluk kadar karakter aşağı iner ki ayaklar yerde kalsın (iskelet pikseli). */
const SIT_DROP = (RIG.pivots["shin-l"][1] - RIG.pivots["leg-l"][1]) * (1 - SIT_THIGH);

const rot = ([x, y]: readonly [number, number], deg: number): [number, number] => {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
};

/** İskelet pozundan sağ elin tuval üzerindeki yeri: elde tutulan nesne her karede bunu izler. */
function handPoint(placed: PlacedLayer, layer: VectorLayer, p: number, t: number, prefix: string): [number, number] {
  const pose = rigPose(layer.anims, p, t, prefix, placed.sitting, layer.expression);
  const a = pose["arm-r"]?.rotate ?? 0;
  const f = pose["forearm-r"]?.rotate ?? 0;
  const [sx, sy] = RIG.pivots["arm-r"];
  const [ex, ey] = RIG.pivots["forearm-r"];
  const elbow = rot([ex - sx, ey - sy], a);
  const hand = rot([0, 112], a + f);
  let rx = sx + elbow[0] + hand[0];
  const ry = sy + elbow[1] + hand[1] + (placed.sitting ? SIT_DROP : 0);
  if (layer.flip) rx = RIG.width - rx;
  const k = placed.height / RIG.height;
  const tr = layerTransform(layer.anims, p, t, prefix, { x: placed.x, y: placed.y });
  return [placed.x - placed.width / 2 + rx * k + tr.x, placed.y - placed.height + ry * k + tr.y];
}

function Layer({
  layer,
  asset,
  placed,
  p,
  t,
  prefix,
  sketch,
}: {
  layer: VectorLayer;
  asset: VectorAsset;
  placed: PlacedLayer;
  p: number;
  t: number;
  prefix: string;
  sketch: boolean;
}) {
  const { width: w, height: h } = placed;
  // Elde tutulan nesne hareketi tutandan alır; kendi giriş animasyonları yine uygulanır.
  const tr = layerTransform(placed.heldBy === undefined ? layer.anims : layer.anims.filter((a) => a.type !== "move"), p, t, prefix, {
    x: placed.x,
    y: placed.y,
  });
  const svg = prefixSvgIds(fitSvg(asset.svg, "meet"), prefix);

  // İskeletli karakterde parça dönüşleri kimlik seçicisiyle uygulanır (dönme noktaları RIG'de sabit).
  let rigCss = "";
  if (asset.kind === "character") {
    // Ayakta dururken ağırlık aktarma: tüm gövde ayak hizasından hafifçe salınır.
    if (!placed.sitting) tr.rotate += Math.sin(t * 0.7 + random(prefix) * 6) * 0.9;
    if (placed.sitting) tr.y += SIT_DROP * (h / RIG.height);
    rigCss = Object.entries(rigPose(layer.anims, p, t, prefix, placed.sitting, layer.expression))
      .map(([k, v]) => {
        const [px, py] = RIG.pivots[k as RigPart];
        const transform = `translate(${v.tx.toFixed(2)}px, ${v.ty.toFixed(2)}px) rotate(${v.rotate.toFixed(2)}deg) scale(${v.sx.toFixed(3)}, ${v.sy.toFixed(3)})`;
        return `#${prefix}${k}{transform:${transform};transform-origin:${px}px ${py}px;transform-box:view-box}`;
      })
      .join("");
  }

  const style: CSSProperties = {
    position: "absolute",
    left: placed.x - w / 2,
    top: placed.y - h,
    width: w,
    height: h,
    opacity: layer.opacity * tr.opacity,
    transform: `translate(${tr.x}px, ${tr.y}px) rotate(${layer.rotate + tr.rotate}deg) scale(${tr.scale * (layer.flip ? -1 : 1)}, ${tr.scale})`,
    transformOrigin: "50% 100%",
    filter: sketch ? "url(#ys-sketch)" : undefined,
  };
  return (
    <div style={style}>
      {rigCss && <style>{rigCss}</style>}
      <div style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
const TEXT_SIZE: Record<VectorText["style"], number> = { title: 104, subtitle: 62, label: 46, number: 140, quote: 56 };

const TEXT_STYLES: Record<VectorText["style"], CSSProperties> = {
  title: { fontWeight: 900, letterSpacing: -1 },
  subtitle: { fontWeight: 700 },
  label: { fontWeight: 700 },
  number: { fontWeight: 900, fontVariantNumeric: "tabular-nums" },
  quote: { fontWeight: 600, fontStyle: "italic" },
};

/** Ekranda aynı anda en fazla bu kadar yazı; üst ve alt sınır (alttaki ~%25 altyazının). Stüdyo kurallarından. */
const { maxTexts: MAX_TEXTS, top: TEXT_TOP, bottom: TEXT_BOTTOM } = TEXT_RULES;
const TEXT_WIDTH = 1500;
const TEXT_GAP = 24;

interface PlacedText {
  text: VectorText;
  /** Bloğun merkez y'si (yerleşimden sonra). */
  y: number;
  size: number;
}

/**
 * Yazıları güvenli alana yerleştirir: en fazla iki yazı, birbirine binmez, altyazı bölgesine inmez.
 * Boyut, satır sayısının kaba tahmininden gelir (ortalama harf genişliği ~0,55 em).
 */
export function layoutTexts(texts: VectorText[]): PlacedText[] {
  const placed = texts.slice(0, MAX_TEXTS).map((text) => {
    let size = TEXT_SIZE[text.style];
    // Uzun metin küçülür: en fazla iki satıra sığsın.
    const lines = () => Math.max(1, Math.ceil((text.text.length * size * 0.55) / TEXT_WIDTH));
    while (lines() > 2 && size > 36) size -= 6;
    const height = lines() * size * 1.12;
    return { text, size, height, y: Math.min(TEXT_BOTTOM, Math.max(TEXT_TOP, text.y)) };
  });
  placed.sort((a, b) => a.y - b.y);
  let bottom = TEXT_TOP;
  for (const t of placed) {
    t.y = Math.max(t.y, bottom + t.height / 2);
    bottom = t.y + t.height / 2 + TEXT_GAP;
  }
  // Taşarsa tümünü yukarı kaydır.
  const overflow = bottom - TEXT_GAP - TEXT_BOTTOM;
  if (overflow > 0) for (const t of placed) t.y -= overflow;
  return placed.map(({ text, y, size }) => ({ text, y, size }));
}

/** #rgb/#rrggbb rengin bağıl parlaklığı (0–1); çözülemezse undefined. */
function luminance(color: string): number | undefined {
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  if (!m) return undefined;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((ch) => ch + ch).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * Yazı rengi yalnız açık renkse kullanılır; koyu konturlu yazı her zeminde açık renkle okunur
 * (30 Eki incelemesi: lacivert pencere üstünde teal rakamlar okunmuyordu).
 */
export function readable(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const l = luminance(color);
  return l !== undefined && l >= 0.35 ? color : undefined;
}

/** "1971" ya da "60.000 $" gibi metindeki ilk sayıyı sıfırdan sayarak gösterir. */
function countUp(text: string, k: number): string {
  const m = /\d[\d.,]*/.exec(text);
  if (!m) return text;
  const raw = m[0];
  const sep = raw.includes(".") && raw.split(".").at(-1)!.length === 3 ? "." : raw.includes(",") ? "," : "";
  const value = Number(raw.replace(/[.,]/g, ""));
  const now = Math.round(value * k);
  // Yıl gibi ayraçsız sayılar ayraçsız kalır.
  const shown = sep ? now.toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep) : String(now);
  return text.replace(raw, shown);
}

function Text({ placed, p, t, seed, accent }: { placed: PlacedText; p: number; t: number; seed: string; accent: string }) {
  const { text, y, size } = placed;
  const tr = layerTransform(text.anims, p, t, seed, { x: text.x, y });
  let shown = text.text;
  for (const a of text.anims) {
    if (a.type === "typewriter") shown = shown.slice(0, Math.round(shown.length * local(p, a)));
    if (a.type === "count_up") shown = countUp(shown, Easing.out(Easing.cubic)(local(p, a)));
  }
  const x = Math.min(W - TEXT_WIDTH / 2 - 40, Math.max(TEXT_WIDTH / 2 + 40, text.x));
  return (
    <div
      style={{
        position: "absolute",
        left: x - TEXT_WIDTH / 2,
        top: y,
        width: TEXT_WIDTH,
        textAlign: "center",
        transform: `translate(${tr.x}px, calc(-50% + ${tr.y}px)) rotate(${tr.rotate}deg) scale(${tr.scale})`,
        opacity: tr.opacity,
        color: readable(text.color) ?? (text.style === "number" ? (readable(accent) ?? "#ffd84d") : "white"),
        fontFamily: "Inter, 'Noto Sans', 'Segoe UI', sans-serif",
        fontSize: size,
        lineHeight: 1.1,
        // Koyu kontur: yazı hangi zeminde olursa olsun okunsun (30 Eki: turuncu duvarda turuncu başlık).
        textShadow: "0 4px 18px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.9)",
        WebkitTextStroke: "2px rgba(15,15,20,0.55)",
        paintOrder: "stroke fill",
        ...TEXT_STYLES[text.style],
      }}
    >
      {shown && (
        // Yarı saydam plaka: başlık raf, pencere gibi dolu bir duvarın üstüne düşse de okunur (30 Eki denemesi: 8 karede yazı çakışması).
        <span
          style={{
            display: "inline-block",
            padding: "0.1em 0.45em 0.16em",
            borderRadius: Math.round(size * 0.22),
            background: "rgba(14,16,22,0.58)",
            boxShadow: "0 6px 24px rgba(0,0,0,0.22)",
          }}
        >
          {shown}
        </span>
      )}
    </div>
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Rota i'nin çizilme aralığı (çekim oranı): rotalar sırayla, her biri çekimin ~%45'inde çizilir. */
const routeWindow = (i: number) => [0.1 + i * 0.15, 0.55 + i * 0.15] as const;

/**
 * Koddan üretilen haritanın canlı katmanı: rotalar çizilerek ilerler, ülke adları önce, şehir ve rota etiketleri
 * sırayla belirir. Etiketler React metni olarak çizilir (SVG'ye metin gömülmez; temizleyici metni siler).
 */
function MapOverlay({ meta, p, prefix }: { meta: VectorAsset["meta"]; p: number; prefix: string }) {
  const routes = meta.routes ?? 0;
  const css = Array.from({ length: routes }, (_, i) => {
    const [a, b] = routeWindow(i);
    const k = Easing.inOut(Easing.cubic)(clamp01((p - a) / (b - a)));
    return `#${prefix}route-${i}{stroke-dashoffset:${(1 - k).toFixed(4)}}`;
  }).join("");
  return (
    <>
      {css && <style>{css}</style>}
      {(meta.labels ?? []).map((l, i) => {
        const appear = l.kind === "country" ? 0.03 : l.kind === "route" ? routeWindow(l.order - 1)[1] : 0.12 + (l.order - routes - 1) * 0.07;
        const k = clamp01((p - appear) / 0.06);
        if (k <= 0) return null;
        const style: CSSProperties =
          l.kind === "country"
            ? { fontSize: 30, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase", color: "#3a3f48", textShadow: "0 0 6px #fff, 0 0 12px #fff" }
            : l.kind === "city"
              ? { fontSize: 26, fontWeight: 700, color: "#1f2430", background: "rgba(255,255,255,0.88)", padding: "2px 12px", borderRadius: 10 }
              : { fontSize: 26, fontWeight: 700, color: "#fff", background: "rgba(31,36,48,0.86)", padding: "3px 14px", borderRadius: 10 };
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: l.x,
              top: l.y,
              transform: `translate(-50%, calc(-50% + ${(1 - k) * 12}px))`,
              opacity: k,
              whiteSpace: "nowrap",
              fontFamily: "Inter, 'Noto Sans', 'Segoe UI', sans-serif",
              ...style,
            }}
          >
            {l.text}
          </div>
        );
      })}
    </>
  );
}

/** Çekimin ışık havası: aynı palet bütün videoda göz yormasın (30 Eki geri bildirimi). */
const MOOD_GRADE: Record<VectorMood, CSSProperties> = {
  neutral: {},
  day: { background: "rgba(255,246,225,0.12)", mixBlendMode: "soft-light" },
  warm: { background: "linear-gradient(180deg, rgba(255,160,70,0.34), rgba(255,95,45,0.22))", mixBlendMode: "soft-light" },
  cool: { background: "linear-gradient(180deg, rgba(70,150,255,0.30), rgba(40,90,200,0.22))", mixBlendMode: "soft-light" },
  night: { background: "linear-gradient(180deg, rgba(8,20,60,0.55), rgba(15,25,55,0.40))", mixBlendMode: "multiply" },
  dramatic: { background: "radial-gradient(ellipse at center, rgba(140,30,50,0.10) 30%, rgba(30,0,10,0.55) 100%)", mixBlendMode: "multiply" },
};

export function VectorScene({
  visual,
  assets,
  palette,
  lineStyle = "outline",
}: {
  visual: Visual;
  assets: Assets;
  palette: string[];
  lineStyle?: LineStyle;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const spec = visual.vector!;
  const p = Math.min(1, frame / Math.max(1, visual.durationInFrames));
  const t = frame / fps;
  const cam = spec.camera;
  const k = interpolate(p, [0, 1], [0, 1], { easing: ease });
  const scale = cam.zoomFrom + (cam.zoomTo - cam.zoomFrom) * k;
  const panX = (cam.panX * (k - 0.5) * (scale - 1) * 100) / scale;
  // Varlıklar üretimde temizlenir; gömmeden önce bir kez daha (savunma derinliği).
  const safe = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(assets).map(([id, a]) => [
          id,
          // Arka plan da dahil bütün varlıklar aynı çizgi stiline getirilir; gerçek veriden üretilenler (harita, bayrak) hariç.
          { ...a, svg: a.meta.exact ? sanitizeSvg(a.svg) : applyLineStyle(sanitizeSvg(a.svg), lineStyle) },
        ]),
      ),
    [assets, lineStyle],
  );
  const placed = useMemo(() => resolveLayout(spec, safe), [spec, safe]);
  const texts = useMemo(() => layoutTexts(spec.texts), [spec.texts]);
  const bg = spec.background ? safe[spec.background] : undefined;
  const [c0 = "#1d2433", c1 = "#3a4a66", accent = "#ffd84d"] = palette;

  return (
    <AbsoluteFill style={{ overflow: "hidden", background: `linear-gradient(160deg, ${c0}, ${c1})` }}>
      {lineStyle === "sketch" && (
        // El çizimi titreşimi: sabit gürültüyle konturlar hafifçe dalgalanır.
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id="ys-sketch">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves={1} seed={3} />
            <feDisplacementMap in="SourceGraphic" scale={3} />
          </filter>
        </svg>
      )}
      <AbsoluteFill
        style={{
          transform: `scale(${scale}) translateX(${panX}%)`,
          // Yakın çekim: odak noktasına doğru yaklaşır.
          transformOrigin: `${cam.focusX ?? W / 2}px ${cam.focusY ?? H / 2}px`,
        }}
      >
        {bg && (
          <AbsoluteFill
            // Arka plan geri çekilir: soluk, düşük kontrastlı ve hafif koyu; dolu duvar detayı karakterle yarışmasın.
            // Harita bilgi taşır: renkleri olduğu gibi kalır.
            style={{ filter: bg.meta.exact ? undefined : "saturate(0.78) contrast(0.86) brightness(0.94)" }}
            dangerouslySetInnerHTML={{ __html: prefixSvgIds(fitSvg(bg.svg, "slice"), `${visual.shotId}-bg-`) }}
          />
        )}
        {bg?.meta.exact && (
          // Harita 1920×1080 üretilir: etiket koordinatları tuvalle birebir, kamerayla birlikte yakınlaşır.
          <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H }}>
            <MapOverlay meta={bg.meta} p={p} prefix={`${visual.shotId}-bg-`} />
          </div>
        )}
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H }}>
          {placed.map((pl) => {
            const layer = spec.layers[pl.index]!;
            const asset = safe[layer.asset]!;
            let at = pl;
            if (pl.heldBy !== undefined) {
              // Tutan karakterin eli her karede yeniden hesaplanır; nesne avucun ortasından tutulur.
              const holder = placed.find((h) => h.index === pl.heldBy);
              if (holder) {
                const [hx, hy] = handPoint(holder, spec.layers[holder.index]!, p, t, `${visual.shotId}-${holder.index}-`);
                at = { ...pl, x: hx, y: hy + pl.height * 0.45 };
              }
            }
            return (
              <Layer
                key={pl.index}
                layer={layer}
                asset={asset}
                placed={at}
                p={p}
                t={t}
                prefix={`${visual.shotId}-${pl.index}-`}
                sketch={lineStyle === "sketch"}
              />
            );
          })}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={MOOD_GRADE[spec.mood]} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.32) 100%)" }} />
      {/* Yazılar kamera hareketinin dışında: zoom onları altyazı bölgesine itmesin. */}
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H }}>
        {texts.map((placed, i) => (
          <Text key={i} placed={placed} p={p} t={t} seed={`${visual.shotId}-t${i}`} accent={accent} />
        ))}
      </div>
    </AbsoluteFill>
  );
}
