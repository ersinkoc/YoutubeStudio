import { z } from "zod";
import { MapLabel } from "./geo.ts";

/**
 * Vektör modu: Claude sahneyi kısa bir JSON olarak tarif eder, Remotion deterministik bileşenlerle çizer.
 * Tekrar eden her şey (iskelet animasyonu, yazı efektleri, kamera) koddadır; token harcanmaz.
 */

/**
 * Karakter iskeleti: Claude her karakteri bu sabit tuvale ve parça kimlikleriyle çizer. Sürüm 2 (30 Eki):
 * dirsek (forearm), diz (shin) ve kaş eklendi; iç içe gruplar ebeveynle birlikte döner.
 */
export const RIG = {
  version: 2,
  width: 400,
  height: 800,
  /** Parça kimliği → dönme noktası (tuval koordinatı). */
  pivots: {
    head: [200, 250],
    body: [200, 520],
    "arm-l": [140, 300],
    "arm-r": [260, 300],
    "forearm-l": [140, 400],
    "forearm-r": [260, 400],
    "leg-l": [175, 520],
    "leg-r": [225, 520],
    "shin-l": [175, 630],
    "shin-r": [225, 630],
    brows: [200, 140],
    eyes: [200, 170],
    mouth: [200, 215],
  },
  /** Olmazsa karakter reddedilir; diğer parçalar isteğe bağlı (yoksa o hareket görünmez). */
  required: ["head", "body", "arm-l", "arm-r", "leg-l", "leg-r"],
} as const;
export type RigPart = keyof typeof RIG.pivots;

/**
 * Yan görünüş iskeleti (31 Eki): önden çizilen karakter yana yürürken gerçekçi görünmüyordu. Aynı karakterin sağa
 * bakan ikinci çizimi; parça kimlikleri ön görünüşle aynı (kod aynı pozları uygular), "-l" uzak, "-r" yakın taraftır.
 * Kol ve bacaklar omuz/kalçadan öne-arkaya döner. Bölüm ayarı açıksa yalnız yürüyen karakterler için çizilir.
 */
export const RIG_SIDE = {
  width: RIG.width,
  height: RIG.height,
  pivots: {
    head: [205, 250],
    body: [200, 520],
    "arm-l": [200, 300],
    "arm-r": [200, 300],
    "forearm-l": [200, 400],
    "forearm-r": [200, 400],
    "leg-l": [200, 520],
    "leg-r": [200, 520],
    "shin-l": [200, 630],
    "shin-r": [200, 630],
    brows: [235, 140],
    eyes: [235, 170],
    mouth: [240, 215],
  },
  required: RIG.required,
} as const satisfies { pivots: Record<RigPart, readonly [number, number]> } & Record<string, unknown>;

/** Timeline'da karakterin yan görünüşünün varlık kimliği: `<karakter>~side`. */
export const sideAssetId = (id: string) => `${id}~side`;

export const VectorAssetKind = z.enum(["character", "background", "prop"]);
export type VectorAssetKind = z.infer<typeof VectorAssetKind>;

/**
 * Varlığın fiziksel bilgisi: sahne yerleşimi pikselle değil bunlarla hesaplanır (30 Eki: ayaklar masa üstünde
 * kalıyordu). Eski varlıklarda yoksa türe göre varsayılan kullanılır.
 */
/**
 * Çizim planı: tasarımcı çizmeden önce, referanslara bakan bir ajan tarifi varlık türüne uydurur ve somut bir plana
 * çevirir (30 Eki: "atın üstündeki binici" ayakta duran iskelete çizilemediği için 3 denemede de reddedildi).
 */
export const AssetPlan = z.object({
  /** Bu varlıkta tam olarak çizilecek tek özne (türün kısıtına uydurulmuş). */
  subject: z.string(),
  /** Tarifte olup bu varlığa girmeyenler (başka nesne/kişi, iskeletin yapamayacağı poz): ayrı çizilir ya da atlanır. */
  moved: z.array(z.string()).default([]),
  pose: z.string().default(""),
  silhouette: z.string().default(""),
  parts: z
    .array(z.object({ name: z.string(), count: z.number().int().nullable().default(null), shape: z.string(), colour: z.string(), where: z.string() }))
    .default([]),
  /** Tanınması için mutlaka görünmesi gerekenler; kapı bunlara bakar. */
  cues: z.array(z.string()).default([]),
  /** Bu tür öznede sık yapılan hatalar ("at iki ayak üstünde"). */
  avoid: z.array(z.string()).default([]),
});
export type AssetPlan = z.infer<typeof AssetPlan>;

/** Kalite kapısının sonucu (her SVG kullanılmadan önce). Gerçek özneyse referans görseller ve kaynaklar da tutulur. */
export const AssetCheck = z.object({
  kind: z.enum(["character", "prop", "background"]),
  name: z.string(),
  /** Adı bilmeden bakan denetçinin tahmini ("kahverengi bir köpek"). */
  guess: z.string().default(""),
  recognizable: z.number(),
  fidelity: z.number().optional(),
  passed: z.boolean(),
  defects: z.array(z.string()).default([]),
  attempts: z.number().int().default(1),
  /** Referans arama sorgusu (Wikipedia/Commons); yoksa referanssız denetlendi. */
  query: z.string().optional(),
  sources: z.array(z.object({ title: z.string(), url: z.string(), license: z.string().optional() })).default([]),
  /** Depodaki referans görsel anahtarları. */
  refs: z.array(z.string()).default([]),
  /** Reddedildiyse en iyi denemenin SVG'si (Stüdyo'da göstermek için; insan kabul etmedikçe üretimde kullanılmaz). */
  rejectedKey: z.string().optional(),
  /** Çizimden önce hazırlanan plan (Stüdyo'da gösterilir). */
  plan: AssetPlan.optional(),
  /**
   * Gerçeklik denetimi kapalı bir bölümde geçti (referans vardı ama sadakat bakılmadı). Gerçeklik açık bölümler bu
   * kaydı güvenmez, yeniden denetler: bir bölümün geçici ayarı paylaşılan kütüphaneye sızmasın.
   */
  fidelitySkipped: z.boolean().optional(),
  /** Varlığın sahibi: kadro kimliği (c1, l2) ya da nesne kimliği (p-horse); insan kararı buna uygulanır. */
  entityId: z.string().optional(),
  /** İnsan kararı her zaman son sözdür: sistemin reddettiğini kabul edebilir, geçirdiğini reddedebilir. */
  override: z
    .object({
      decision: z.enum(["accepted", "rejected"]),
      /** Reddederken tasarımcıya iletilen not. */
      note: z.string().optional(),
      at: z.string(),
    })
    .optional(),
});
export type AssetCheck = z.infer<typeof AssetCheck>;

export const VectorAssetMeta = z.object({
  /** Gerçek yükseklik (metre): insan ~1,7, masa ~0,75, sandalye ~0,9, kitap ~0,25. */
  realHeight: z.number().positive().optional(),
  /** Üstüne bir şey konabilen yüzeyin yüksekliği, varlık boyunun oranı (masa ~0,95, sandalye oturağı ~0,5). */
  surface: z.number().min(0).max(1).optional(),
  /** Yerde durur mu (masa, sandalye, insan) yoksa duvarda/havada mı (saat, pano, lamba). */
  grounded: z.boolean().optional(),
  /** Arka planda duvar ile zeminin birleştiği y (px, 1080 tuval). */
  floorY: z.number().optional(),
  /** Koddan üretilen haritada: varlık koordinatlarında etiketler ve sırayla çizilen rota sayısı. */
  labels: z.array(MapLabel).optional(),
  routes: z.number().int().nonnegative().optional(),
  /** Gerçek veriden üretildi (harita, bayrak): çizgi stili ve zemin temizliği uygulanmaz, olduğu gibi gösterilir. */
  exact: z.boolean().optional(),
  /** Kalite kapısı sonucu; olmayan (eski) varlık kullanılmadan önce denetlenir. */
  check: AssetCheck.optional(),
  /** Karakterin kimliği: kütüphaneden başka bölümlerde tekrar kullanmak için (aynı stil ve çizgi stilinde). */
  identity: z
    .object({
      name: z.string(),
      description: z.string(),
      reference: z.string().optional(),
      pack: z.string().optional(),
      artStyle: z.string(),
      lineStyle: z.string(),
      episodes: z.array(z.string()).default([]),
    })
    .optional(),
});
export type VectorAssetMeta = z.infer<typeof VectorAssetMeta>;

export const VectorAsset = z.object({
  id: z.string(),
  kind: VectorAssetKind,
  /** Temizlenmiş SVG (script, olay, dış bağlantı yok). */
  svg: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  meta: VectorAssetMeta.default({}),
});
export type VectorAsset = z.infer<typeof VectorAsset>;

/** Katman ve yazı animasyonları; zaman aralığı çekim süresinin oranı (0–1). */
export const VectorAnimType = z.enum([
  // tüm katman
  "fade_in",
  "fade_out",
  "slide_in",
  "pop",
  "float",
  "sway",
  "pulse",
  "spin",
  "shake",
  "move",
  // karakter iskeleti
  "walk",
  "wave",
  "nod",
  "talk",
  "point",
  "shrug",
  "explain",
  "think",
  "cheer",
  "surprised",
  "sit",
  // yazı
  "typewriter",
  "count_up",
]);
export type VectorAnimType = z.infer<typeof VectorAnimType>;

export const VectorAnim = z.object({
  type: VectorAnimType,
  start: z.number().min(0).max(1).default(0),
  end: z.number().min(0).max(1).default(1),
  /** slide_in yönü. */
  from: z.enum(["left", "right", "top", "bottom"]).optional(),
  /** move/walk hedefi (1920×1080 tuval). */
  toX: z.number().optional(),
  toY: z.number().optional(),
  /** point hedefi: aynı çekimdeki katmanın indeksi (yoksa yanındaki en yakın şey). */
  target: z.number().int().nonnegative().optional(),
});
export type VectorAnim = z.infer<typeof VectorAnim>;

/** Karakterin yüz ifadesi ve duruşu; kaş, göz, ağız ve baş koddan ayarlanır (jestlerle birlikte çalışır). */
export const VectorExpression = z.enum(["neutral", "happy", "sad", "angry", "worried", "surprised", "thinking"]);
export type VectorExpression = z.infer<typeof VectorExpression>;

export const VectorLayer = z.object({
  asset: z.string(),
  /** Katmanın alt-orta noktası (x), 1920×1080 tuvalde. */
  x: z.number(),
  /**
   * Sahnedeki derinlik: 0 kameraya en yakın, 1 odanın dibi. Verilirse ayağın bastığı y, perspektif ölçeği ve boy
   * koddan hesaplanır; yerdeki her şey (insan, mobilya) böyle yerleştirilir.
   */
  depth: z.number().min(0).max(1).optional(),
  /** Başka bir katmanın (indeks) üstünde: nesne masanın yüzeyinde, karakter sandalyede oturur. */
  on: z.number().int().nonnegative().optional(),
  /** Bu nesneyi elinde tutan karakter katmanı (indeks); nesne eli takip eder. */
  heldBy: z.number().int().nonnegative().optional(),
  /** Duvardaki/havadaki öğeler için alt-orta y ve boy (px). Yerdeki öğelerde kullanılmaz. */
  y: z.number().optional(),
  height: z.number().positive().optional(),
  /** Çizim sırasını elle belirlemek için; yoksa derinlikten. */
  z: z.number().optional(),
  flip: z.boolean().default(false),
  rotate: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  anims: z.array(VectorAnim).default([]),
  /** Sadece karakterler: çekim boyunca yüz ifadesi (anlatımın duygusu). */
  expression: VectorExpression.optional(),
});
export type VectorLayer = z.infer<typeof VectorLayer>;

export const VectorTextStyle = z.enum(["title", "subtitle", "label", "number", "quote"]);

export const VectorText = z.object({
  text: z.string(),
  /** Yazının merkezi, 1920×1080 tuvalde. */
  x: z.number(),
  y: z.number(),
  style: VectorTextStyle.default("label"),
  color: z.string().optional(),
  anims: z.array(VectorAnim).default([]),
});
export type VectorText = z.infer<typeof VectorText>;

/** Bölümün çizgi stili: tasarımcıya verilir ve render'da tüm varlıklarda kontur eşitlenir. */
export const LineStyle = z.enum(["outline", "flat", "sketch", "ink"]);
export type LineStyle = z.infer<typeof LineStyle>;

/** Çekimin ışık havası: aynı palet bütün videoda göz yormasın diye sahneye göre renk tonu. */
export const VectorMood = z.enum(["neutral", "day", "warm", "cool", "night", "dramatic"]);
export type VectorMood = z.infer<typeof VectorMood>;

export const VectorShot = z.object({
  /** Arka plan varlığı; yoksa paletten degrade. */
  background: z.string().optional(),
  mood: VectorMood.default("neutral"),
  layers: z.array(VectorLayer).default([]),
  texts: z.array(VectorText).default([]),
  camera: z
    .object({
      zoomFrom: z.number().default(1),
      zoomTo: z.number().default(1.06),
      panX: z.number().min(-1).max(1).default(0),
      /** Yakın çekimde odak noktası (1920×1080 tuval); yoksa kadraj merkezi. */
      focusX: z.number().optional(),
      focusY: z.number().optional(),
    })
    .default({ zoomFrom: 1, zoomTo: 1.06, panX: 0 }),
});
export type VectorShot = z.infer<typeof VectorShot>;

/** İzin verilen SVG öğeleri: çizim, degrade, kırpma ve birkaç yumuşak filtre. Geri kalan her şey atılır. */
const ALLOWED_TAGS = new Set(
  [
    "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use", "symbol",
    "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "marker", "title", "desc",
    "filter", "fegaussianblur", "feoffset", "feblend", "fecolormatrix", "femerge", "femergenode", "feflood",
    "fecomposite", "fedropshadow",
  ],
);

const ALLOWED_ATTRS = new Set(
  [
    "id", "xmlns", "xmlns:xlink", "viewbox", "preserveaspectratio", "width", "height", "x", "y", "x1", "y1", "x2", "y2",
    "cx", "cy", "r", "rx", "ry", "fx", "fy", "d", "points", "transform", "fill", "fill-opacity", "fill-rule",
    "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
    "stroke-opacity", "stroke-miterlimit", "opacity", "clip-path", "clip-rule", "mask", "filter", "offset",
    "stop-color", "stop-opacity", "gradientunits", "gradienttransform", "spreadmethod", "href", "xlink:href",
    "patternunits", "patterntransform", "maskunits", "clippathunits", "stddeviation", "in", "in2", "result",
    "mode", "values", "type", "dx", "dy", "flood-color", "flood-opacity", "operator", "k1", "k2", "k3", "k4",
    "visibility", "display", "style",
    // Bayraklarda yıldız dizileri (ABD) ve harita rotalarının çizilerek ilerlemesi için.
    "marker-start", "marker-mid", "marker-end", "markerwidth", "markerheight", "markerunits", "refx", "refy", "orient",
    "pathlength",
  ],
);

/** style="" içinde izin verilen CSS özellikleri (sunum öznitelikleriyle aynı küme). */
const STYLE_PROPS = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  "stroke-dashoffset", "stroke-opacity", "stroke-miterlimit", "opacity", "stop-color", "stop-opacity", "display", "visibility",
  "clip-path", "mask", "filter",
]);

/**
 * Öznitelik değeri yalnız iç başvuru (#id) kullanabilir; betik, data: ve dış URL yasak. Varlık (&#..;) ve CSS kaçışı
 * (\75rl) içeren değerler reddedilir: düz metin denetimini atlatıp dış kaynak yükletebiliyorlardı (30 Eki incelemesi).
 */
function safeValue(name: string, value: string): boolean {
  if (/[\\&]/.test(value)) return false;
  const v = value.toLowerCase().replace(/\s+/g, "");
  if (/javascript:|vbscript:|data:|expression\(|@import|behavior:|image-set|src\(|-moz-binding/.test(v)) return false;
  // Her url() yalnız iç başvuru: url(#id).
  for (const u of v.match(/url\([^)]*\)?/g) ?? []) if (!/^url\(['"]?#[\w.:-]+['"]?\)$/.test(u)) return false;
  if ((name === "href" || name === "xlink:href") && !value.trim().startsWith("#")) return false;
  return true;
}

/** style="" izin listesine göre yeniden kurulur; bilinmeyen özellik atılır. */
function safeStyle(value: string): string {
  return value
    .split(";")
    .map((decl) => decl.split(":"))
    .filter(([prop, val]) => prop && val !== undefined && STYLE_PROPS.has(prop.trim().toLowerCase()) && safeValue("style", val))
    .map(([prop, val]) => `${prop!.trim().toLowerCase()}:${val!.trim()}`)
    .join(";");
}

/** url('#a'), url( #a ) → url(#a): kimlik önekleme (prefixSvgIds) tek biçimi tanır. */
const normalizeUrls = (value: string) => value.replace(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g, "url(#$1)");

/**
 * Model çıktısı SVG'yi izin listesiyle yeniden kurar: yalnız bilinen öğe ve öznitelikler kalır; yorum,
 * CDATA, <style>, <script>, <foreignObject>, <image> ve metin düğümleri atılır. Sonuç innerHTML ile
 * gömülebilir. Yalnız ilk <svg>…</svg> bloğu işlenir.
 */
export function sanitizeSvg(raw: string): string {
  const start = raw.search(/<svg[\s>]/i);
  const end = raw.toLowerCase().lastIndexOf("</svg>");
  if (start < 0 || end < start) throw new Error("SVG bulunamadı");
  const body = raw
    .slice(start, end + "</svg>".length)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    // İçeriği olan tehlikeli öğeler içerikleriyle birlikte atılır.
    .replace(/<(script|style|foreignObject|text|textPath|iframe|object|embed|audio|video|animate\w*|set)\b[\s\S]*?<\/\1\s*>/gi, "");

  const out: string[] = [];
  // Tırnaksız değer tırnak içeremez: aksi halde kapanmamış bir etikette geri izleme üstel büyüyordu.
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:(?:\s+|(?<=["']))[^\s=>/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>/]+))?)*)\s*(\/?)>/g;
  const attr = /([^\s=>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>/]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(body))) {
    const [, closing, rawName, rawAttrs, selfClosing] = m;
    const name = rawName!.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) continue;
    if (closing) {
      out.push(`</${rawName}>`);
      continue;
    }
    const attrs: string[] = [];
    let a: RegExpExecArray | null;
    attr.lastIndex = 0;
    // Grup 3 bir `*` niceleyicisini sarar: eşleşmede her zaman (boş da olsa) vardır.
    while ((a = attr.exec(rawAttrs!))) {
      const attrName = a[1]!.toLowerCase();
      let value = a[2] ?? a[3] ?? a[4] ?? "";
      if (!ALLOWED_ATTRS.has(attrName)) continue;
      if (attrName === "style") {
        value = safeStyle(value);
        if (!value) continue;
      } else if (!safeValue(attrName, value)) continue;
      value = normalizeUrls(value);
      attrs.push(`${a[1]}="${value.replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`);
    }
    out.push(`<${rawName}${attrs.length ? ` ${attrs.join(" ")}` : ""}${selfClosing ? "/" : ""}>`);
  }
  const svg = out.join("");
  if (!/^<svg[\s>]/i.test(svg)) throw new Error("SVG bulunamadı");
  return svg;
}
const num = (attrs: string, name: string): number | undefined => {
  const m = new RegExp(`\\s${name}="([-\\d.]+)(%?)"`).exec(attrs);
  if (!m) return undefined;
  return m[2] ? Number.NaN : Number(m[1]);
};

/**
 * Karakter ve nesnelerin arkasına çizilmiş zemini atar: tuvali kaplayan dikdörtgen ya da öznenin arkasındaki
 * büyük daire/elips (30 Eki: sahneye "kutu içinde" giriyorlardı). Yere düşen ince gölge elipsi korunur.
 * Yalnız <defs> sonrası en baştaki üst düzey öğelere bakılır; temizlenmiş (sanitizeSvg) SVG bekler.
 */
export function stripBackdrop(svg: string, size: { width: number; height: number }): string {
  const { width: W, height: H } = size;
  const open = /^<svg[^>]*>/.exec(svg);
  if (!open) return svg;
  let rest = svg.slice(open[0].length);
  let head = open[0];
  const defs = /^<defs\b[\s\S]*?<\/defs>/.exec(rest);
  if (defs) {
    head += defs[0];
    rest = rest.slice(defs[0].length);
  }
  const kept: string[] = [];
  for (let i = 0; i < 4; i++) {
    const el = /^<(rect|circle|ellipse)\b([^>]*)\/>/.exec(rest);
    if (!el) break;
    const [whole, tag, attrs = ""] = el;
    const w = num(attrs, "width");
    const h = num(attrs, "height");
    const r = num(attrs, "r");
    const rx = num(attrs, "rx");
    const ry = num(attrs, "ry");
    const fullRect = tag === "rect" && (Number.isNaN(w) || (w ?? 0) >= W * 0.9) && (Number.isNaN(h) || (h ?? 0) >= H * 0.9);
    const bigCircle = tag === "circle" && (r ?? 0) >= Math.min(W, H) * 0.35;
    const bigEllipse = tag === "ellipse" && (rx ?? 0) >= W * 0.35 && (ry ?? 0) >= H * 0.2;
    const shadow = tag === "ellipse" && (ry ?? 0) < H * 0.06;
    if (fullRect || bigCircle || bigEllipse) {
      rest = rest.slice(whole.length);
      continue;
    }
    if (!shadow) break;
    kept.push(whole);
    rest = rest.slice(whole.length);
  }
  return head + kept.join("") + rest;
}
/**
 * Aynı SVG bir karede birden çok kez gömülünce kimlikler çakışır; her örneğin kimlik ve
 * başvurularına önek eklenir (url(#x), href="#x").
 */
export function prefixSvgIds(svg: string, prefix: string): string {
  return svg
    .replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`)
    .replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, `url(#${prefix}$2)`)
    .replace(/(href|xlink:href)="#([^"]+)"/g, `$1="#${prefix}$2"`);
}

/** viewBox'tan boyut; yoksa width/height özniteliklerinden. */
export function svgSize(svg: string): { width: number; height: number } {
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
  const w = /\bwidth="([\d.]+)/.exec(svg);
  const h = /\bheight="([\d.]+)/.exec(svg);
  if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
  throw new Error("SVG boyutu yok (viewBox gerekli)");
}

const darkColor = (value: string): boolean => {
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!m) return /^(black|#000)$/i.test(value.trim());
  const hex = m[1]!.length === 3 ? [...m[1]!].map((ch) => ch + ch).join("") : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! < 90;
};

/**
 * Çizgi stilini tüm varlıklarda eşitler (farklı çağrılarda çizilen karakterler aynı elden çıkmış gibi dursun).
 * Temizlenmiş SVG bekler. outline/sketch: koyu konturlar tek renge; ink: koyu konturlar siyah ve kalın;
 * flat: dolgulu şekillerin konturu atılır (yalnız fill="none" çizgiler — ağız, kaş gibi — kalır).
 */
export function applyLineStyle(svg: string, style: LineStyle): string {
  // Düz stilde grubun koyu konturu silinir; ama içindeki fill="none" çizgiler (ağız, kaş) konturu gruptan miras alır,
  // silinince görünmez olurlardı: grup konturu önce o çizgilere taşınır.
  const inherited: (string | undefined)[] = [];
  return svg.replace(/<(\/?)(path|rect|circle|ellipse|polygon|polyline|line|g)\b([^>]*?)(\/?)>/g, (whole, closing: string, tag: string, attrs: string, close: string) => {
    if (closing) {
      if (tag === "g") inherited.pop();
      return whole;
    }
    const parent = inherited.at(-1);
    const stroke = /\sstroke="([^"]*)"/.exec(attrs)?.[1];
    const fillNone = /\sfill="none"/.test(attrs);
    let next = attrs;
    if (style === "flat") {
      // Yalnız koyu stroke="" taşıyan grupta çağrılır: eşleşme her zaman vardır.
      const strokeAttrs = (a: string) => a.match(/\sstroke(-width|-linejoin|-linecap|-opacity)?="[^"]*"/g)!.join("");
      if (tag === "g") {
        const dark = stroke && stroke !== "none" && darkColor(stroke);
        const carried = dark ? strokeAttrs(attrs) : parent;
        if (!close) inherited.push(stroke === "none" ? undefined : carried);
        if (dark) next = next.replace(/\sstroke(-width|-linejoin|-linecap|-opacity)?="[^"]*"/g, "");
        return next === attrs ? whole : `<${tag}${next}${close}>`;
      }
      if (!stroke) return fillNone && parent ? `<${tag}${attrs}${parent}${close}>` : whole;
      if (stroke === "none" || fillNone || !darkColor(stroke)) return whole;
      next = next.replace(/\sstroke(-width|-linejoin|-linecap|-opacity)?="[^"]*"/g, "");
      return `<${tag}${next}${close}>`;
    }
    if (tag === "g" && !close) inherited.push(undefined);
    if (!stroke || stroke === "none") return whole;
    if (darkColor(stroke)) {
      const color = style === "ink" ? "#111014" : "#1d1a24";
      next = next.replace(/\sstroke="[^"]*"/, ` stroke="${color}"`);
      if (style === "ink") {
        next = next.replace(/\sstroke-width="([\d.]+)"/, (_m, w: string) => ` stroke-width="${(Number(w) * 1.5).toFixed(1)}"`);
        if (!/stroke-linecap/.test(next)) next += ' stroke-linecap="round"';
        if (!/stroke-linejoin/.test(next)) next += ' stroke-linejoin="round"';
      }
    }
    return `<${tag}${next}${close}>`;
  });
}
