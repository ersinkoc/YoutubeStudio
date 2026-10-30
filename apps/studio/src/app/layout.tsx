import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getI18n } from "../lib/locale";
import { LanguageSwitch, LocaleProvider } from "./locale-provider";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: "YoutubeStudio", description: t("app.tagline") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, t } = await getI18n();
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <LocaleProvider locale={locale}>
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <span className="inline-block h-3 w-3 rounded-full bg-accent" />
                YoutubeStudio
              </Link>
              <nav className="flex items-center gap-5 text-sm text-muted">
                <Link href="/" className="hover:text-white">{t("nav.episodes")}</Link>
                <Link href="/costs" className="hover:text-white">{t("nav.costs")}</Link>
                <Link href="/pricing" className="hover:text-white">{t("nav.pricing")}</Link>
                <Link href="/lessons" className="hover:text-white">{t("nav.lessons")}</Link>
                <LanguageSwitch />
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        </LocaleProvider>
      </body>
    </html>
  );
}
