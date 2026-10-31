import type { VectorAnim, VectorAnimType, VectorAssetKind } from "@ys/core";
import { Easing } from "remotion";

/**
 * Hareket fiziği (31 Eki geri bildirimi: "karakterlerin hareketleri ve fizik dikkatsiz"). Yönetmenin istediği
 * animasyonlar render'dan önce fiziğe uydurulur ve yürüyüş adımları alınan yoldan hesaplanır. Bölüm verisinde görülen
 * hatalar: yerdeki at/araba `toY: 0` ile ekranın tepesine uçuyordu, masa süzülüyordu, insan çizilmiş nesneler
 * "cheer" ile zıplıyordu, elde tutulan nesne süzülüp elden kopuyordu, bacaklar hızdan bağımsız makas gibi açılıp
 * kapanıyordu (ayak kayması), "surprised" karakteri saniyelerce yerden 10 px yukarıda tutuyordu.
 */

/** Yalnız iskeletli karakterin yapabildiği jestler; nesnede anlamsızdır (nesne çizilmiş insan olsa da). */
const RIG_ONLY: VectorAnimType[] = ["wave", "nod", "talk", "point", "shrug", "explain", "think", "cheer", "surprised", "sit"];
/** Nesneyi yerinden oynatan animasyonlar: elde tutulan nesnede hareket tutandan gelir. */
const DISPLACING: VectorAnimType[] = ["move", "walk", "slide_in", "float", "sway", "shake"];

export interface Body {
  kind: VectorAssetKind;
  /** Yerde/yüzeyde duruyor (yerçekimi). */
  grounded: boolean;
  /** Bir karakterin elinde. */
  held: boolean;
  /** Sandalyede oturuyor. */
  sitting: boolean;
}

/** Katmanın animasyonlarını fiziğe uydurur. Saf fonksiyon: aynı girdi her karede aynı sonucu verir. */
export function physicalAnims(anims: readonly VectorAnim[], body: Body): VectorAnim[] {
  const out: VectorAnim[] = [];
  for (const a of anims) {
    if (body.kind !== "character" && RIG_ONLY.includes(a.type)) continue;
    if (body.held && DISPLACING.includes(a.type)) continue;
    // Oturacak yer yoksa oturmak havada çömelmek olur; sandalyedeki karakter zaten oturur.
    if (a.type === "sit" && !body.sitting) continue;
    if (body.grounded) {
      // Yerdeki şey süzülmez, dikeyde yer değiştirmez: hedefin yalnız yatayı kalır (yükseklik derinlikten gelir).
      if (a.type === "float") continue;
      if ((a.type === "move" || a.type === "walk") && a.toY !== undefined) {
        const { toY: _drop, ...rest } = a;
        if (rest.toX === undefined && a.type === "move") continue;
        out.push(rest);
        continue;
      }
      // Yukarıdan düşen ya da yerin altından çıkan masa olmaz: yerinde belirir.
      if (a.type === "slide_in" && (a.from === "top" || a.from === "bottom")) {
        out.push({ type: "fade_in", start: a.start, end: a.end });
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

const ease = Easing.inOut(Easing.cubic);
const easeOut = Easing.out(Easing.cubic);

function local(p: number, a: VectorAnim): number {
  const span = Math.max(0.0001, a.end - a.start);
  return Math.min(1, Math.max(0, (p - a.start) / span));
}

/** Çekim başından bu ana dek yatayda alınan yol (px); geri dönüşler de yola eklenir. */
export function travelled(anims: readonly VectorAnim[], p: number, baseX: number): number {
  let d = 0;
  for (const a of anims) {
    if ((a.type === "move" || a.type === "walk") && a.toX !== undefined) d += Math.abs(a.toX - baseX) * ease(local(p, a));
    if (a.type === "slide_in" && (a.from ?? "left") === "left") d += (baseX + 400) * easeOut(local(p, a));
    if (a.type === "slide_in" && a.from === "right") d += (1920 - baseX + 400) * easeOut(local(p, a));
  }
  return d;
}

/** Yatay yer değiştirme (px): yönü bulmak için. */
function shiftX(anims: readonly VectorAnim[], p: number, baseX: number): number {
  let x = 0;
  for (const a of anims) {
    if ((a.type === "move" || a.type === "walk") && a.toX !== undefined) x += (a.toX - baseX) * ease(local(p, a));
    if (a.type === "slide_in" && (a.from ?? "left") === "left") x -= (baseX + 400) * (1 - easeOut(local(p, a)));
    if (a.type === "slide_in" && a.from === "right") x += (1920 - baseX + 400) * (1 - easeOut(local(p, a)));
  }
  return x;
}

export interface Gait {
  /** Atılan adım sayısı (kesirli): bir adım = bir bacağın kalkıp inmesi. */
  steps: number;
  /** Adım genliği 0–1: yürürken 1, dururken 0; hızlanıp yavaşlarken arada. */
  amount: number;
  /** Yürüme yönü ekranda: +1 sağa, −1 sola. */
  dir: number;
}

/** Bir adımın gerçek uzunluğu (m) ve rahat yürüme hızı (m/sn). */
const STRIDE_M = 0.7;
const WALK_SPEED = 1.3;

/**
 * Yürüyüşü doğal hıza getirir: yönetmen kısa bir yola uzun pencere verince (5 sn'de 200 px) karakter yerinde
 * sürünür gibi kayıyordu. İnsan o yolu rahat temposunda yürür ve varınca durur; pencerenin sonu buna göre öne çekilir.
 * Kısa pencere uzatılmaz (acele eden hızlı yürür). Karakterin "move"u da yürüyüştür.
 */
export function paceWalks(anims: readonly VectorAnim[], baseX: number, pxPerMeter: number, dur: number, character: boolean): VectorAnim[] {
  return anims.map((a) => {
    const walking = a.type === "walk" || (character && a.type === "move");
    if (!walking || a.toX === undefined || dur <= 0) return a;
    // Yumuşak kalkış/duruşta tepe hız ortalamanın ~1,5 katı: ortalama rahat hızın 2/3'ü.
    const sec = Math.abs(a.toX - baseX) / ((WALK_SPEED * pxPerMeter * 2) / 3);
    const end = Math.max(a.start + 0.6 / dur, a.start + sec / dur);
    return end < a.end ? { ...a, end } : a;
  });
}

/**
 * Yürüyüş: adımlar alınan yoldan sayılır (adım uzunluğu ölçeğe göre), böylece ayak zeminde kaymaz ve hızlanıp
 * yavaşlarken adımlar da yavaşlar; durunca bacaklar iner. Hedefsiz "walk" yerinde yürür (rahat temposunda).
 * pxPerMeter: bu katmanın ölçeğinde 1 metrenin pikseli; dur: çekim süresi (sn).
 */
export function gaitOf(anims: readonly VectorAnim[], p: number, t: number, baseX: number, pxPerMeter: number, dur: number): Gait {
  const stride = STRIDE_M * pxPerMeter;
  const dp = 0.004;
  const speed = (travelled(anims, Math.min(1, p + dp), baseX) - travelled(anims, Math.max(0, p - dp), baseX)) / (2 * dp * Math.max(0.1, dur));
  // Rahat yürüme hızının üçte birinde adımlar tam genliğe ulaşır.
  let amount = Math.min(1, speed / ((WALK_SPEED * pxPerMeter) / 3));
  let steps = travelled(anims, p, baseX) / stride;
  for (const a of anims) {
    if (a.type !== "walk" || a.toX !== undefined || p < a.start || p > a.end) continue;
    steps += (t * WALK_SPEED) / STRIDE_M;
    amount = Math.max(amount, 1);
  }
  const dx = shiftX(anims, Math.min(1, p + dp), baseX) - shiftX(anims, Math.max(0, p - dp), baseX);
  return { steps, amount: ease(Math.max(0, amount)), dir: dx > 0.01 ? 1 : dx < -0.01 ? -1 : 0 };
}

/**
 * Sıçrayış: yerden kalkıp yerçekimiyle geri iner (parabol). u 0–1 havada geçen süre; dönüş yükseklik oranı.
 * "surprised" irkilmesi pencere başında bir kez zıplar, sonra ayaklar yerdedir.
 */
export const hop = (u: number) => (u <= 0 || u >= 1 ? 0 : 4 * u * (1 - u));
