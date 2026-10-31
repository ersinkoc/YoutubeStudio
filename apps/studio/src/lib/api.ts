import { errorText, formatText, type Text } from "@ys/core/messages";
import { isLocale, LOCALE_COOKIE, localeFromHeader, type Locale } from "./i18n";

/** API isteğinin dili: seçilen dil (çerez `ys-lang`), yoksa tarayıcının dili. */
export function requestLocale(req: Request): Locale {
  const cookie = req.headers.get("cookie") ?? "";
  const chosen = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`).exec(cookie)?.[1];
  return isLocale(chosen) ? chosen : localeFromHeader(req.headers.get("accept-language"));
}

/** İsteğin dilinde metin. */
export const localize = (req: Request, text: Text): string => formatText(requestLocale(req), text);

/** JSON hata yanıtı `{ error }` isteğin dilinde. */
export const apiError = (req: Request, text: Text, status = 400): Response =>
  Response.json({ error: localize(req, text) }, { status });

/** Yakalanan hatanın yanıtı: çevrilebilir hata seçili dilde, düz hata olduğu gibi. */
export const errorResponse = (req: Request, e: unknown, status = 400): Response => apiError(req, errorText(e), status);

/** Düz metin yanıtı (video, varlık uç noktaları) isteğin dilinde. */
export const textResponse = (req: Request, text: Text, status: number): Response => new Response(localize(req, text), { status });
