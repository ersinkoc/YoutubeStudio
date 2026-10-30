"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { formatters, LOCALE_COOKIE, LOCALES, translator, type Locale } from "../lib/i18n";

const LocaleContext = createContext<Locale>("tr");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** İstemci bileşenleri için çevirmen ve biçimlendiriciler. */
export function useI18n() {
  const locale = useContext(LocaleContext);
  return useMemo(() => ({ locale, t: translator(locale), fmt: formatters(locale) }), [locale]);
}

export function LanguageSwitch() {
  const { locale } = useI18n();
  const router = useRouter();
  const choose = (next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div className="flex overflow-hidden rounded-lg border border-line text-xs">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => choose(l)}
          className={`px-2 py-1 uppercase ${l === locale ? "bg-panel-2 text-white" : "text-muted hover:text-white"}`}
          aria-pressed={l === locale}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
