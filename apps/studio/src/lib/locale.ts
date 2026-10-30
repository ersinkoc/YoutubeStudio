import "server-only";
import { cookies, headers } from "next/headers";
import { formatters, isLocale, LOCALE_COOKIE, localeFromHeader, translator, type Locale } from "./i18n";

/** Seçilen dil (çerez), yoksa tarayıcının dili. */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return localeFromHeader((await headers()).get("accept-language"));
}

/** Sunucu bileşenleri için çevirmen ve biçimlendiriciler. */
export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: translator(locale), fmt: formatters(locale) };
}
