/**
 * Sunucu tarafında üretilip arayüzde gösterilen metinler (etkinlik kaydı, hata, tahmin dayanağı…) anahtar + parametreyle
 * taşınır; Stüdyo seçili dilde biçimlendirir. Her anahtarın Türkçe ve İngilizcesi zorunludur. Değişkenler {ad} biçimindedir;
 * parametre başka bir mesaj olabilir (ör. hata nedeni), o da aynı dilde biçimlenir. Katalog saf veridir: Stüdyo istemci
 * bileşenleri de doğrudan import edebilir.
 */
import { CORE_MESSAGES } from "./core.ts";
import { COSTS_MESSAGES } from "./costs.ts";
import { GATEWAY_MESSAGES } from "./gateway.ts";
import { PIPELINE_MESSAGES } from "./pipeline.ts";
import { STUDIO_MESSAGES } from "./studio.ts";

export type MessageLocale = "tr" | "en";
export type MessageTexts = Readonly<Record<string, { readonly tr: string; readonly en: string }>>;

export const MESSAGES = {
  ...CORE_MESSAGES,
  ...PIPELINE_MESSAGES,
  ...COSTS_MESSAGES,
  ...GATEWAY_MESSAGES,
  ...STUDIO_MESSAGES,
} as const satisfies MessageTexts;

export type MessageId = keyof typeof MESSAGES;
export type MsgParam = string | number | Msg;
export interface Msg {
  key: MessageId;
  params?: Record<string, MsgParam>;
}
/** Kullanıcıya gösterilecek metin: düz (eski kayıtlar, model çıktısı) ya da çevrilebilir mesaj. */
export type Text = string | Msg;

export const msg = (key: MessageId, params?: Record<string, MsgParam>): Msg => (params ? { key, params } : { key });

export const isMsg = (v: unknown): v is Msg =>
  typeof v === "object" && v !== null && typeof (v as Msg).key === "string" && (v as Msg).key in MESSAGES;

/** Metni istenen dilde biçimlendirir; bilinmeyen anahtar (eski kayıt) anahtarın kendisini verir. */
export function formatText(locale: MessageLocale, text: Text | undefined): string {
  if (text === undefined) return "";
  if (typeof text === "string") return text;
  const entry = (MESSAGES as MessageTexts)[text.key];
  if (!entry) return text.key;
  const params = text.params;
  return params
    ? entry[locale].replace(/\{(\w+)\}/g, (m, name: string) => {
        const v = params[name];
        return v === undefined ? m : typeof v === "object" ? formatText(locale, v) : String(v);
      })
    : entry[locale];
}

/** Pipeline günlüğü ve CLI için Türkçe karşılık (kayıtlarda `msg` alanı olarak da durur). */
export const trText = (text: Text): string => formatText("tr", text);

/**
 * Çevrilebilir hata: `message` Türkçe (CLI, eski kayıtlar), `text` arayüzde seçili dilde gösterilir.
 * Alt sınıflar (ör. sağlayıcı hataları) aynı yapıyı kullanır.
 */
export class LocalizedError extends Error {
  readonly text: Msg;
  constructor(text: Msg, options?: ErrorOptions) {
    super(trText(text), options);
    this.text = text;
  }
}

/** Hatanın gösterilecek metni: çevrilebilirse mesajı, değilse düz `message`. */
export function errorText(e: unknown): Text {
  if (e instanceof LocalizedError) return e.text;
  if (e instanceof Error) return e.message;
  return String(e);
}
