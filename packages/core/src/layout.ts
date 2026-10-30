import { READABLE_SIDE } from "./rules.ts";
import type { VectorAsset, VectorLayer, VectorShot } from "./vector.ts";

/**
 * Sahne fiziği: Claude katmanları derinlik ve ilişkilerle tarif eder, bu modül ayağın bastığı noktayı, perspektif
 * ölçeğini, gerçek boyu ve çizim sırasını hesaplar. Saf fonksiyondur (render ve doğrulama aynı sonucu görür).
 * 30 Eki geri bildirimi: "ayaklar masa üstünde kalıyor, katmanlar alt üst, her şey fiziğe uymalı".
 */

export const STAGE = {
  width: 1920,
  height: 1080,
  /** Derinlik 0'daki (kameraya en yakın) ayak çizgisi. */
  floorNear: 1050,
  /** Arka plan zemin çizgisini bildirmezse. */
  defaultFloorY: 700,
  /** Derinlik 0'da 1 metrenin piksel karşılığı: 1,7 m insan ≈ 680 px. */
  pxPerMeter: 400,
  /** Derinlik 1'deki (odanın dibi) ölçek. */
  farScale: 0.5,
} as const;

const DEFAULT_REAL_HEIGHT: Record<VectorAsset["kind"], number> = { character: 1.7, prop: 0.8, background: 0 };
/** Elde tutulan nesnenin varsayılan boyu (m). */
const HELD_REAL_HEIGHT = 0.3;

/** Nesnenin boyunu, en uzun kenarı okunabilir sınırın altına düşmeyecek şekilde büyütür. */
function readableHeight(h: number, aspect: number, minSide: number, fixes: string[]): number {
  const min = minSide / Math.max(aspect, 1);
  if (h >= min) return h;
  fixes.push("okunamayacak kadar küçüktü, büyütüldü");
  return min;
}

export interface PlacedLayer {
  index: number;
  /** Alt-orta nokta ve boyut (px). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Perspektif ölçeği (derinlik 0 = 1). */
  scale: number;
  /** Çizim sırası: büyük olan önde. */
  z: number;
  /** Karakter bir şeyin üstünde oturuyor. */
  sitting: boolean;
  /** Bu nesneyi tutan karakter katmanı; konum her karede eline göre hesaplanır. */
  heldBy?: number;
  /** Yerleşimi koddan düzeltildiyse nedeni (inceleme ve testler için). */
  fixes: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Arka planın zemin çizgisi (duvar–zemin birleşimi). */
export function floorYOf(spec: VectorShot, assets: Record<string, VectorAsset>): number {
  const bg = spec.background ? assets[spec.background] : undefined;
  return clamp(bg?.meta.floorY ?? STAGE.defaultFloorY, 480, 900);
}

/** Derinlikten ayak çizgisi ve ölçek. */
export function depthToFloor(depth: number, floorY: number): { y: number; scale: number } {
  const d = clamp(depth, 0, 1);
  return {
    y: STAGE.floorNear - (STAGE.floorNear - (floorY + 20)) * d,
    scale: 1 - (1 - STAGE.farScale) * d,
  };
}

/** Ayak çizgisinden derinlik (eski, pikselle verilmiş katmanları fiziğe çevirmek için). */
export function floorToDepth(y: number, floorY: number): number {
  return clamp((STAGE.floorNear - y) / (STAGE.floorNear - (floorY + 20)), 0, 1);
}

const isGrounded = (layer: VectorLayer, asset: VectorAsset, floorY: number) =>
  asset.kind === "character" ||
  asset.meta.grounded === true ||
  (asset.meta.grounded === undefined && layer.depth !== undefined) ||
  (asset.meta.grounded === undefined && layer.y !== undefined && layer.y > floorY);

const entering = (layer: VectorLayer) => layer.anims.some((a) => a.type === "walk" || a.type === "slide_in" || a.type === "move");

export function resolveLayout(spec: VectorShot, assets: Record<string, VectorAsset>): PlacedLayer[] {
  const floorY = floorYOf(spec, assets);
  const placed = new Map<number, PlacedLayer>();
  const resolving = new Set<number>();

  const resolve = (i: number): PlacedLayer | undefined => {
    if (placed.has(i)) return placed.get(i);
    const layer = spec.layers[i];
    const asset = layer ? assets[layer.asset] : undefined;
    if (!layer || !asset || resolving.has(i)) return undefined;
    resolving.add(i);

    const aspect = asset.width / asset.height;
    const real = asset.meta.realHeight ?? DEFAULT_REAL_HEIGHT[asset.kind];
    const fixes: string[] = [];
    let out: Omit<PlacedLayer, "width">;

    const holder = layer.heldBy !== undefined && layer.heldBy !== i ? resolve(layer.heldBy) : undefined;
    const holderAsset = holder ? assets[spec.layers[holder.index]!.asset] : undefined;
    const base = layer.on !== undefined && layer.on !== i ? resolve(layer.on) : undefined;

    if (holder && holderAsset?.kind === "character") {
      // Elde: boy tutanın ölçeğiyle; konum render'da elden gelir, burada el hizası yaklaşık.
      const real = readableHeight(asset.meta.realHeight ?? HELD_REAL_HEIGHT, aspect, READABLE_SIDE.held, fixes);
      const h = real * STAGE.pxPerMeter * holder.scale;
      out = { index: i, x: holder.x, y: holder.y - holder.height * 0.3, height: h, scale: holder.scale, z: holder.z + 0.3, sitting: false, heldBy: holder.index, fixes };
    } else if (base) {
      const baseAsset = assets[spec.layers[base.index]!.asset]!;
      const sized = asset.kind === "character" ? real : readableHeight(real, aspect, READABLE_SIDE.surface, fixes);
      const h = sized * STAGE.pxPerMeter * base.scale;
      if (asset.kind === "character") {
        // Sandalyede/bankta oturur: ayaklar yerde, oturağın önünde.
        out = { index: i, x: base.x, y: base.y + 2, height: h, scale: base.scale, z: base.z + 0.5, sitting: true, fixes };
      } else {
        // Yüzeyin üstünde: yüzey yüksekliği tabanın boyundan; yüzeyden taşmasın.
        const surfaceY = base.y - base.height * (baseAsset.meta.surface ?? (baseAsset.kind === "character" ? 0.5 : 1));
        const halfBase = base.width / 2;
        const x = clamp(layer.x, base.x - halfBase * 0.8, base.x + halfBase * 0.8);
        if (x !== layer.x) fixes.push("yüzeyin dışına taşıyordu, içeri alındı");
        out = { index: i, x, y: surfaceY, height: h, scale: base.scale, z: base.z + 0.4, sitting: false, fixes };
      }
    } else if (isGrounded(layer, asset, floorY)) {
      let depth = layer.depth;
      if (depth === undefined) {
        depth = layer.y !== undefined ? floorToDepth(layer.y, floorY) : 0.3;
        fixes.push("piksel konumu derinliğe çevrildi");
      }
      const { y, scale } = depthToFloor(depth, floorY);
      const sized = asset.kind === "prop" ? readableHeight(real, aspect, READABLE_SIDE.floor, fixes) : real;
      out = { index: i, x: layer.x, y, height: sized * STAGE.pxPerMeter * scale, scale, z: 100 * (1 - depth), sitting: false, fixes };
      if (layer.height !== undefined && Math.abs(layer.height - out.height) > out.height * 0.15) fixes.push("boy gerçek ölçüye göre düzeltildi");
    } else {
      // Duvarda/havada: verilen y ve boy; hepsi yerdeki öğelerin arkasında.
      const h = layer.height ?? real * STAGE.pxPerMeter * 0.8;
      out = { index: i, x: layer.x, y: layer.y ?? floorY - 60, height: h, scale: 1, z: -10 + i * 0.01, sitting: false, fixes };
    }
    if (layer.z !== undefined) out.z = layer.z;
    const result: PlacedLayer = { ...out, width: out.height * aspect };
    placed.set(i, result);
    resolving.delete(i);
    return result;
  };

  spec.layers.forEach((_, i) => resolve(i));
  const list = [...placed.values()];

  // Aynı derinlikte üst üste binen ayaktaki karakterleri ayır; kadraj dışına taşanları içeri al.
  const standing = list.filter((p) => !p.sitting && p.heldBy === undefined && assets[spec.layers[p.index]!.asset]?.kind === "character");
  standing.sort((a, b) => a.x - b.x);
  for (let k = 1; k < standing.length; k++) {
    const a = standing[k - 1]!;
    const b = standing[k]!;
    const minGap = (a.width + b.width) * 0.32;
    if (Math.abs(a.z - b.z) < 10 && b.x - a.x < minGap) {
      const push = (minGap - (b.x - a.x)) / 2;
      a.x -= push;
      b.x += push;
      a.fixes.push("yanındaki karakterle üst üste biniyordu");
      b.fixes.push("yanındaki karakterle üst üste biniyordu");
    }
  }
  for (const p of standing) {
    if (entering(spec.layers[p.index]!)) continue;
    const half = p.width / 2;
    const x = clamp(p.x, half + 20, STAGE.width - half - 20);
    if (x !== p.x) {
      p.x = x;
      p.fixes.push("kadraj dışına taşıyordu");
    }
  }

  return list.sort((a, b) => a.z - b.z || a.index - b.index);
}
