import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getI18n } from "../lib/locale";
import { updateInfo } from "../lib/update";
import { LanguageSwitch, LocaleProvider } from "./locale-provider";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: "YoutubeStudio", description: t("app.tagline") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [{ locale, t }, update] = await Promise.all([getI18n(), updateInfo()]);
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <LocaleProvider locale={locale}>
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <span className="inline-block h-3 w-3 rounded-full bg-accent" />
                YoutubeStudio
                <span className="text-xs font-normal text-muted">v{update.current}</span>
              </Link>
              <nav className="flex items-center gap-5 text-sm text-muted">
                <Link href="/" className="hover:text-white">{t("nav.episodes")}</Link>
                <Link href="/costs" className="hover:text-white">{t("nav.costs")}</Link>
                <Link href="/pricing" className="hover:text-white">{t("nav.pricing")}</Link>
                <Link href="/lessons" className="hover:text-white">{t("nav.lessons")}</Link>
                <Link href="/rules" className="hover:text-white">{t("nav.rules")}</Link>
                <Link href="/models" className="hover:text-white">{t("nav.models")}</Link>
                <LanguageSwitch />
              </nav>
            </div>
          </header>
          {update.available && update.latest && (
            <div className="border-b border-accent/40 bg-accent/10">
              <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="font-medium text-accent">{t("update.available", { latest: update.latest.version, current: update.current })}</span>
                <span className="text-muted">
                  {t("update.how")} <code className="rounded bg-panel-2 px-1.5 py-0.5 text-xs">git pull &amp;&amp; pnpm install &amp;&amp; pnpm studio:build</code>
                </span>
                <a className="ml-auto underline decoration-line hover:text-white" href={update.latest.url} target="_blank" rel="noreferrer noopener">
                  {t("update.notes")}
                </a>
              </div>
            </div>
          )}
          <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        </LocaleProvider>
      </body>
    </html>
  );
}
