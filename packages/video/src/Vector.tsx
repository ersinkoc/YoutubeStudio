import {
  applyLineStyle,
  prefixSvgIds,
  resolveLayout,
  RIG,
  RIG_SIDE,
  sideAssetId,
  sanitizeSvg,
  uniqueCharacters,
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
  type VectorShot,
  type VectorText,
  STAGE,
  TEXT_RULES,
} from "@ys/core";
import { useMemo, type CSSProperties } from "react";
import { AbsoluteFill, Easing, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { FOREARM_LAG, gaitOf, gestureWeight, hop, paceWalks, physicalAnims, type Gait } from "./motion.ts";

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

/** Katman/yazı düzeyindeki animasyonlar: hepsi zaman ve tohumdan türetilir. dur: çekim süresi (sn), height: katman boyu (px). */
function layerTransform(
  anims: VectorAnim[],
  p: number,
  t: number,
  seed: string,
  base: { x: number; y: number },
  size: { dur: number; height: number } = { dur: 0, height: 0 },
): Transform {
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
        // İrkilme: pencere başında bir kez boyunun ~%3,5'i kadar sıçrar ve yerçekimiyle iner (havada asılı kalmaz).
        tr.y -= hop(((p - a.start) * size.dur) / 0.45) * 0.035 * size.height;
        break;
      case "move":
      case "walk": {
        const k = ease(q);
        if (a.toX !== undefined) tr.x += (a.toX - base.x) * k;
        if (a.toY !== undefined) tr.y += (a.toY - base.y) * k;
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

/** Kolu meşgul eden jestler; bunlardan biri sürerken (ya da yürürken) kendiliğinden el hareketi yapılmaz. */
const ARM_GESTURES: VectorAnimType[] = ["wave", "point", "explain", "think", "cheer", "shrug", "surprised"];

const STILL: Gait = { steps: 0, amount: 0, dir: 0 };

/** Karakterin dikkati: işaret edeceği nokta ve gözlerinin yönü (iskelet koordinatı; aynalama hesaba katılmış). */
interface Attention {
  /** point hedefi (iskelet tuvali, 400×800). */
  aim?: readonly [number, number];
  /** Sahnedeki en yakın diğer karakterin yönü: −1 sol, 1 sağ. */
  lookDir?: number;
  /** Sağ elinde nesne var: yüze giden jest sol elle yapılır. */
  holding?: boolean;
}

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
  gait: Gait = STILL,
  flip = false,
  attention: Attention = {},
  dur = 1,
  /** Yan görünüş çizimi yürüyor (RIG_SIDE). */
  side = false,
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
  // Bakış her ~2,5 sn'de bir yön değiştirir; düşünürken bir yana sabitlenir. Sahnede başka biri varsa çoğunlukla ona
  // bakar (ara ara kameraya döner): rastgele gezinen gözler karakterleri birbirinden kopuk gösteriyordu.
  const look = Math.floor(t / 2.5 + r("lk") * 3);
  const glance = random(`${seed}-look-${look}`);
  part("eyes").tx = face.lookX ?? (attention.lookDir && glance < 0.75 ? attention.lookDir * 5 + (glance - 0.375) * 3 : (glance - 0.5) * 8);

  // --- kendiliğinden jest: kolu meşgul eden bir animasyon yoksa ara ara anlatır gibi el hareketi
  const armsBusy = gait.amount > 0.05 || anims.some((a) => ARM_GESTURES.includes(a.type) && active(p, a));
  if (!armsBusy) {
    const every = 4 + r("g") * 2.5;
    const phase = (t + r("gp") * every) % every;
    if (phase < 1.4) {
      const k = Math.sin((phase / 1.4) * Math.PI);
      const right = random(`${seed}-gs-${Math.floor((t + r("gp") * every) / every)}`) < 0.6;
      // El dışa, avuç yukarı açılır. (Eski işaretler ters: el karna gidiyordu.) Dönüş ekranda saat yönü artıdır; sarkan
      // kol artıda ekranın soluna döner, yani sağdaki kol (arm-r) eksiyle, soldaki artıyla dışa açılır.
      if (right) {
        part("arm-r").rotate -= 14 * k;
        part("forearm-r").rotate -= 62 * k + Math.sin(t * 5) * 6 * k;
      } else {
        part("arm-l").rotate += 14 * k;
        part("forearm-l").rotate += 62 * k + Math.sin(t * 5) * 6 * k;
      }
      part("brows").ty = face.brows - 3 * k;
    }
  }

  if (sitting) {
    // Ön görünüşte oturuş: uyluk kısalır, baldır dik kalır (iç içe grup; ebeveynin ölçeği geri alınır).
    for (const leg of ["l", "r"] as const) {
      part(`leg-${leg}`).sy = SIT_THIGH;
      part(`shin-${leg}`).sy = 1 / SIT_THIGH;
    }
  }

  if (side) {
    // Yan görünüşte yürüyüş (sağa bakan çizim; öne = eksi dönüş): bacaklar kalçadan öne-arkaya salınır, arkada kalan
    // bacağın dizi bükülür, kollar karşı bacakla salınır. Profilde göz kaymaz.
    const s = Math.sin(Math.PI * gait.steps);
    const k = gait.amount;
    part("leg-r").rotate = -24 * s * k;
    part("leg-l").rotate = 24 * s * k;
    part("shin-r").rotate = 30 * Math.max(0, -s) * k;
    part("shin-l").rotate = 30 * Math.max(0, s) * k;
    part("arm-r").rotate = 20 * s * k;
    part("arm-l").rotate = -20 * s * k;
    part("forearm-r").rotate = -14 * k;
    part("forearm-l").rotate = -14 * k;
    part("eyes").tx = 0;
  } else if (gait.amount > 0) {
    // Ön görünüşte adım: diz öne gelir, uyluk kısalır ve ayak yerden kalkar (baldır boyunu korur); bacak gidiş yönüne
    // hafifçe açılır. Eski makas salınımı (±22°) bacakları çaprazlıyor ve hızdan bağımsız olduğu için ayak kayıyordu.
    const s = Math.sin(Math.PI * gait.steps);
    const toward = gait.dir * (flip ? -1 : 1);
    for (const [leg, lift] of [
      ["l", Math.max(0, s)],
      ["r", Math.max(0, -s)],
    ] as const) {
      const k = lift * gait.amount;
      part(`leg-${leg}`).sy = 1 - 0.3 * k;
      part(`shin-${leg}`).sy = 1 / (1 - 0.3 * k);
      part(`leg-${leg}`).rotate = toward * 7 * k;
    }
    // Kollar karşı bacakla birlikte salınır.
    part("arm-l").rotate -= 6 * s * gait.amount;
    part("arm-r").rotate -= 6 * s * gait.amount;
  }

  // --- Claude'un istediği jestler: hazırlık + taşmayla girer (gestureWeight), ön kol üst kolu geriden izler.
  for (const a of anims) {
    const arm = gestureWeight(p, a, dur);
    const fore = gestureWeight(p, a, dur, FOREARM_LAG);
    if (arm === 0 && fore === 0) continue;
    // Baş sallama ve konuşma genliği taşmaz.
    const w = Math.min(1, Math.max(0, arm));
    const mix = (k: RigPart, field: keyof PartPose, target: number) => {
      // Yan görünüşte kollar yürür; ön görünüş için tasarlanmış kol jestleri uygulanmaz (yüz ve baş jestleri sürer).
      if (side && /arm-/.test(k)) return;
      const pp = part(k);
      const wk = k.startsWith("forearm-") ? fore : arm;
      pp[field] = pp[field] * (1 - wk) + target * wk;
    };
    switch (a.type) {
      case "wave":
        mix("arm-r", "rotate", -150);
        mix("forearm-r", "rotate", Math.sin(t * 9) * 28);
        mix("brows", "ty", -4);
        break;
      case "point": {
        // Hedefe doğru: hedef hangi yandaysa o yandaki kol, omuzdan hedefe uzanır; baş ve gözler de hedefe döner.
        // Hedef yoksa (boş sahne) öne-yana yatay.
        const [ax, ay] = attention.aim ?? [RIG.width * 3, RIG.pivots["arm-r"][1]];
        const hand = ax >= RIG.width / 2 ? "r" : "l";
        const [sx, sy] = RIG.pivots[`arm-${hand}`];
        const toward = hand === "r" ? 1 : -1;
        mix(`arm-${hand}`, "rotate", (Math.atan2(-(ax - sx), ay - sy) * 180) / Math.PI);
        mix(`forearm-${hand}`, "rotate", -6 * toward);
        mix("head", "rotate", -4 * toward);
        mix("eyes", "tx", 5 * toward);
        break;
      }
      case "explain": {
        // Anlatırken baskın el konuşulan kişiye (yoksa sağa) avuç yukarı açılır ve konuşma ritmiyle iner kalkar; öbür el
        // kalça hizasında küçük bir eşlik yapar. İki kolun birden omuz hizasında açılması "ta-da" gibi duruyordu.
        const dom = (attention.lookDir ?? 1) >= 0 ? "r" : "l";
        const other = dom === "r" ? "l" : "r";
        // Sağdaki kol (r) eksiyle, soldaki artıyla dışa açılır.
        const out = dom === "r" ? -1 : 1;
        mix(`arm-${dom}`, "rotate", out * (20 + Math.sin(t * 3) * 5));
        mix(`forearm-${dom}`, "rotate", out * (60 + Math.sin(t * 3.4) * 12));
        mix(`arm-${other}`, "rotate", -out * (8 + Math.sin(t * 2.6 + 1) * 3));
        mix(`forearm-${other}`, "rotate", -out * (28 + Math.sin(t * 3 + 1) * 8));
        mix("brows", "ty", -3 + Math.sin(t * 3) * 2);
        break;
      }
      case "think": {
        // Sağ el nesne tutuyorsa sol el çeneye gider; yoksa tutulan defter yüzü kapatıyordu.
        const hand = attention.holding ? -1 : 1;
        mix(hand > 0 ? "arm-r" : "arm-l", "rotate", -8 * hand);
        mix(hand > 0 ? "forearm-r" : "forearm-l", "rotate", 162 * hand);
        mix("head", "rotate", 7);
        mix("brows", "ty", -5);
        mix("eyes", "tx", 5);
        break;
      }
      case "cheer":
        mix("arm-l", "rotate", 150 + Math.sin(t * 6) * 8);
        mix("arm-r", "rotate", -150 - Math.sin(t * 6) * 8);
        mix("forearm-l", "rotate", -15);
        mix("forearm-r", "rotate", 15);
        mix("brows", "ty", -8);
        mix("mouth", "sy", 1.5);
        break;
      case "surprised":
        // Eller omuz hizasına kalkar, avuçlar dışa.
        mix("arm-l", "rotate", 30);
        mix("arm-r", "rotate", -30);
        mix("forearm-l", "rotate", 115);
        mix("forearm-r", "rotate", -115);
        mix("brows", "ty", -10);
        mix("eyes", "sy", 1.25);
        mix("mouth", "sy", 1.6);
        break;
      case "shrug":
        // Omuzlar kalkar, ön kollar dışa yatay açılır (avuç yukarı), baş yana eğilir.
        mix("arm-l", "rotate", 16);
        mix("arm-r", "rotate", -16);
        mix("arm-l", "ty", -7);
        mix("arm-r", "ty", -7);
        mix("forearm-l", "rotate", 62);
        mix("forearm-r", "rotate", -62);
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

/** Karakterin sahnedeki ilgi noktaları (tuval koordinatı): işaret hedefi ve bakacağı diğer karakterin x'i. */
export interface Focus {
  aim?: readonly [number, number];
  lookX?: number;
  /** Elinde bir şey tutuyor (nesne sağ eli izler). */
  holding?: boolean;
}

/**
 * point hedefi: animasyonda "target" verilmişse o katman; yoksa yanında (gövdesinin dışında) duran en yakın nesne ya da
 * karakter; o da yoksa ekrandaki yazı. Kendi tuttuğu nesne ve arka plan hedef olmaz.
 */
export function focusOf(spec: VectorShot, placed: PlacedLayer[], index: number, kinds: (i: number) => string | undefined): Focus {
  const self = placed.find((pl) => pl.index === index)!;
  const center = (pl: PlacedLayer): [number, number] => [pl.x, pl.y - pl.height / 2];
  const others = placed.filter((pl) => pl.index !== index && pl.heldBy !== index);
  const near = (list: PlacedLayer[]) =>
    list.sort((a, b) => Math.abs(a.x - self.x) - Math.abs(b.x - self.x))[0];
  const people = others.filter((pl) => kinds(pl.index) === "character");
  const target = spec.layers[index]!.anims.find((a) => a.type === "point" && a.target !== undefined)?.target;
  const explicit = others.find((pl) => pl.index === target);
  const beside = near(others.filter((pl) => Math.abs(pl.x - self.x) > self.width * 0.4));
  const text = spec.texts[0];
  const aim = explicit ? center(explicit) : beside ? center(beside) : text ? ([text.x, text.y] as const) : undefined;
  return { aim, lookX: near(people)?.x, holding: placed.some((pl) => pl.heldBy === index) };
}

/** Katmanın bu karedeki hareketi: katman dönüşümü ve (karakterse) iskelet pozu. */
interface Motion {
  tr: Transform;
  pose?: Partial<Record<RigPart, PartPose>>;
  /** Yürürken çizilen yan görünüş (varsa); iskelet RIG_SIDE'a göre pozlanır. */
  side?: VectorAsset;
  /** Çizim aynalı mı: yan görünüşte gidiş yönünden gelir (çizim sağa bakar). */
  flip: boolean;
  /** Önden yana dönüşte yatay daralma (1 = yok): karakter dönüyormuş gibi görünür. */
  squash: number;
}

/**
 * Katmanın hareketi fiziğe uydurulmuş animasyonlardan hesaplanır (motion.ts): yerdeki şey havalanmaz, elde tutulan
 * süzülmez. Yürüyen karakterin adımları alınan yoldan gelir; gövde adımla hafifçe yükselir ve gidiş yönüne eğilir.
 */
function motionOf(
  layer: VectorLayer,
  asset: VectorAsset,
  placed: PlacedLayer,
  p: number,
  t: number,
  prefix: string,
  dur: number,
  focus: Focus = {},
  sideAsset?: VectorAsset,
): Motion {
  const pxPerMeter = STAGE.pxPerMeter * placed.scale;
  const anims = paceWalks(
    physicalAnims(layer.anims, { kind: asset.kind, grounded: placed.grounded, held: placed.heldBy !== undefined, sitting: placed.sitting }),
    placed.x,
    pxPerMeter,
    dur,
    asset.kind === "character",
  );
  const tr = layerTransform(anims, p, t, prefix, { x: placed.x, y: placed.y }, { dur, height: placed.height });
  const walks = (asset.kind === "character" && !placed.sitting) || anims.some((a) => a.type === "walk");
  const gait = walks ? gaitOf(anims, p, t, placed.x, pxPerMeter, dur) : STILL;
  // Gövde, salınan bacak altından geçerken en yüksekte (adım başına bir kez).
  tr.y -= Math.abs(Math.sin(Math.PI * gait.steps)) * 0.012 * placed.height * gait.amount;
  if (asset.kind !== "character") return { tr, flip: layer.flip, squash: 1 };
  tr.rotate += gait.dir * 2.5 * gait.amount;
  // Yan görünüş: adım genliği yarıyı geçince yan çizime geçilir; geçişin çevresinde çizim yatayda daralıp açılır (dönüş).
  let squash = 1;
  if (sideAsset && !placed.sitting && gait.amount > 0.2) {
    squash = 0.6 + 0.4 * Math.min(1, Math.abs(gait.amount - 0.5) / 0.3);
    if (gait.amount >= 0.5) {
      const flip = gait.dir ? gait.dir < 0 : layer.flip;
      return { tr, flip, squash, side: sideAsset, pose: rigPose(anims, p, t, prefix, false, layer.expression, gait, flip, {}, dur, true) };
    }
  }
  // Ayakta dururken ağırlık aktarma: tüm gövde ayak hizasından hafifçe salınır (yürürken adım bunun yerini alır).
  // Aynalanan karakterde salınım da aynalanır (iskelet pozu gibi).
  const mirror = layer.flip ? -1 : 1;
  if (!placed.sitting) tr.rotate += Math.sin(t * 0.7 + random(prefix) * 6) * 0.9 * (1 - gait.amount) * mirror;
  else tr.y += SIT_DROP * (placed.height / RIG.height);
  // Tuval noktası → iskelet tuvali (katmanın o anki kayması dahil, aynalama geri alınır).
  const k = placed.height / RIG.height;
  const toRigX = (x: number) => {
    const rx = (x - tr.x - (placed.x - placed.width / 2)) / k;
    return layer.flip ? RIG.width - rx : rx;
  };
  const attention: Attention = {
    aim: focus.aim ? [toRigX(focus.aim[0]), (focus.aim[1] - tr.y - (placed.y - placed.height)) / k] : undefined,
    lookDir: focus.lookX === undefined ? undefined : Math.sign(toRigX(focus.lookX) - RIG.width / 2),
    holding: focus.holding,
  };
  return { tr, flip: layer.flip, squash, pose: rigPose(anims, p, t, prefix, placed.sitting, layer.expression, gait, layer.flip, attention, dur) };
}

/**
 * İskelet pozundan sağ elin tuval üzerindeki yeri: elde tutulan nesne her karede bunu izler. Katmanın bütün dönüşümü
 * (yürüme, eğilme, ölçek, aynalama) uygulanır; yoksa nesne yürürken elden ayrılıyordu.
 */
function handPoint(placed: PlacedLayer, layer: VectorLayer, m: Motion): [number, number] {
  // Karakter hareketinde poz her zaman vardır; "?? 0" yalnız tip için (Partial).
  /* v8 ignore next */
  const a = m.pose?.["arm-r"]?.rotate ?? 0;
  /* v8 ignore next */
  const f = m.pose?.["forearm-r"]?.rotate ?? 0;
  const [sx, sy] = (m.side ? RIG_SIDE : RIG).pivots["arm-r"];
  const [ex, ey] = (m.side ? RIG_SIDE : RIG).pivots["forearm-r"];
  const elbow = rot([ex - sx, ey - sy], a);
  const hand = rot([0, 112], a + f);
  let rx = sx + elbow[0] + hand[0];
  const ry = sy + elbow[1] + hand[1];
  if (m.flip) rx = RIG.width - rx;
  // Katman dönüşümünün merkezi alt-orta noktadır (transformOrigin 50% 100%).
  const k = (placed.height / RIG.height) * m.tr.scale;
  const kx = k * m.squash;
  const [dx, dy] = rot([(rx - RIG.width / 2) * kx, (ry - RIG.height) * k], layer.rotate + m.tr.rotate);
  return [placed.x + m.tr.x + dx, placed.y + m.tr.y + dy];
}

function Layer({
  layer,
  asset,
  placed,
  motion,
  prefix,
  sketch,
}: {
  layer: VectorLayer;
  asset: VectorAsset;
  placed: PlacedLayer;
  motion: Motion;
  prefix: string;
  sketch: boolean;
}) {
  const { width: w, height: h } = placed;
  const { tr, pose } = motion;
  const svg = prefixSvgIds(fitSvg((motion.side ?? asset).svg, "meet"), prefix);

  // İskeletli karakterde parça dönüşleri kimlik seçicisiyle uygulanır (dönme noktaları RIG'de sabit).
  const rigCss = pose
    ? Object.entries(pose)
        .map(([k, v]) => {
          const [px, py] = (motion.side ? RIG_SIDE : RIG).pivots[k as RigPart];
          const transform = `translate(${v.tx.toFixed(2)}px, ${v.ty.toFixed(2)}px) rotate(${v.rotate.toFixed(2)}deg) scale(${v.sx.toFixed(3)}, ${v.sy.toFixed(3)})`;
          return `#${prefix}${k}{transform:${transform};transform-origin:${px}px ${py}px;transform-box:view-box}`;
        })
        .join("")
    : "";

  const style: CSSProperties = {
    position: "absolute",
    left: placed.x - w / 2,
    top: placed.y - h,
    width: w,
    height: h,
    opacity: layer.opacity * tr.opacity,
    transform: `translate(${tr.x}px, ${tr.y}px) rotate(${layer.rotate + tr.rotate}deg) scale(${tr.scale * motion.squash * (motion.flip ? -1 : 1)}, ${tr.scale})`,
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
  const raw = m[0].replace(/[.,]+$/, "");
  // Son ayraçtan sonra tam 3 hane yoksa ondalıktır ("3.14", "1,5", "%2,5"); 3 hane binliktir ("60.000").
  const last = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  const decimal = last >= 0 && raw.length - last - 1 !== 3 ? raw[last]! : "";
  const decimals = decimal ? raw.length - last - 1 : 0;
  const intPart = decimal ? raw.slice(0, last) : raw;
  const group = /[.,]/.exec(intPart)?.[0] ?? "";
  const value = Number(intPart.replace(/[.,]/g, "") + (decimal ? `.${raw.slice(last + 1)}` : ""));
  const now = (value * k).toFixed(decimals);
  const [whole, frac] = now.split(".");
  // Yıl gibi ayraçsız sayılar ayraçsız kalır.
  const grouped = group ? whole!.replace(/\B(?=(\d{3})+(?!\d))/g, group) : whole!;
  return text.replace(raw, frac ? `${grouped}${decimal}${frac}` : grouped);
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
  const { fps, width, height } = useVideoConfig();
  // Eski planlarda aynı karakterin kopyaları olabilir; render'da da tek kalır.
  const spec = useMemo(() => uniqueCharacters(visual.vector!, (id) => assets[id]?.kind === "character"), [visual.vector, assets]);
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
        Object.entries(assets).flatMap(([id, a]) => {
          // Arka plan da dahil bütün varlıklar aynı çizgi stiline getirilir; gerçek veriden üretilenler (harita, bayrak) hariç.
          // Bozuk tek varlık bütün vektör çekimlerini düşürmesin: o varlık atlanır.
          try {
            return [[id, { ...a, svg: a.meta.exact ? sanitizeSvg(a.svg) : applyLineStyle(sanitizeSvg(a.svg), lineStyle) }]];
          } catch {
            return [];
          }
        }),
      ),
    [assets, lineStyle],
  );
  const placed = useMemo(() => resolveLayout(spec, safe), [spec, safe]);
  const texts = useMemo(() => layoutTexts(spec.texts), [spec.texts]);
  const bg = spec.background ? safe[spec.background] : undefined;
  const dur = visual.durationInFrames / fps;
  const motions = new Map(
    placed.map((pl) => {
      const layer = spec.layers[pl.index]!;
      const asset = safe[layer.asset]!;
      const focus = asset.kind === "character" ? focusOf(spec, placed, pl.index, (i) => safe[spec.layers[i]!.asset]?.kind) : {};
      return [pl.index, motionOf(layer, asset, pl, p, t, `${visual.shotId}-${pl.index}-`, dur, focus, safe[sideAssetId(layer.asset)])] as const;
    }),
  );
  const [c0 = "#1d2433", c1 = "#3a4a66", accent = "#ffd84d"] = palette;

  const stage = (
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
              // resolveLayout heldBy'ı yalnız yerleştirilmiş bir karakter için yazar; tutan bulunamaması savunma amaçlı.
              /* v8 ignore else */
              if (holder) {
                const [hx, hy] = handPoint(holder, spec.layers[holder.index]!, motions.get(holder.index)!);
                at = { ...pl, x: hx, y: hy + pl.height * 0.45 };
              }
            }
            return (
              <Layer
                key={pl.index}
                layer={layer}
                asset={asset}
                placed={at}
                motion={motions.get(pl.index)!}
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

  if (width === W && height === H) return stage;
  // Başka en-boy oranı (9:16 Shorts): sahne 1920×1080 tuvalde çizilir ve kırpılmadan ortaya sığdırılır; boşluğu aynı
  // arka planın bulanık, büyütülmüş kopyası doldurur. Yerleşim, yazı ve harita koordinatları değişmez.
  // Dikeyde tam sığdırma sahneyi çok küçültür: 1,3 kat yakın çekim (kenarlardan ~%12 kırpılır). İçerik zaten orta
  // bantta (x 420–1500, arka plan kuralı) yerleşir; yatay/kareye yakın oranlarda büyütme yapılmaz.
  const fit = Math.min(height / H, (width / W) * (width < height ? 1.3 : 1));
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: `linear-gradient(160deg, ${c0}, ${c1})` }}>
      {bg && (
        <AbsoluteFill
          style={{ filter: "blur(28px) brightness(0.7) saturate(0.9)", transform: "scale(1.15)" }}
          dangerouslySetInnerHTML={{ __html: prefixSvgIds(fitSvg(bg.svg, "slice"), `${visual.shotId}-bd-`) }}
        />
      )}
      <div
        style={{
          position: "absolute",
          width: W,
          height: H,
          left: (width - W * fit) / 2,
          top: (height - H * fit) / 2,
          transform: `scale(${fit})`,
          transformOrigin: "0 0",
        }}
      >
        {stage}
      </div>
    </AbsoluteFill>
  );
}
