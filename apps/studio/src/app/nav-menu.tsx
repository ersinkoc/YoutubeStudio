"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MessageKey } from "../lib/i18n";
import { useI18n } from "./locale-provider";

const ITEMS: { href: string; label: MessageKey }[] = [
  { href: "/", label: "nav.episodes" },
  { href: "/costs", label: "nav.costs" },
  { href: "/pricing", label: "nav.pricing" },
  { href: "/lessons", label: "nav.lessons" },
  { href: "/rules", label: "nav.rules" },
  { href: "/characters", label: "nav.characters" },
  { href: "/models", label: "nav.models" },
];

export const NEW_EPISODE = "/episodes/new";

/** Bu menü öğesi şu anki sayfa mı: "Bölümler" bölüm sayfalarında da seçili (yeni bölüm sayfası hariç). */
export function isActive(href: string, path: string): boolean {
  if (href === "/") return path === "/" || (path.startsWith("/episodes/") && path !== NEW_EPISODE);
  return path === href || path.startsWith(`${href}/`);
}

/** Üst menü: önde vurgulu "Yeni bölüm" düğmesi, ardından düğme görünümlü sayfa bağlantıları (seçili olan belirgin). */
export function NavMenu() {
  const { t } = useI18n();
  // Next dışında (sunucu testinde) yol bağlamı yoktur.
  const path = usePathname() ?? "";
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-sm">
      <Link href={NEW_EPISODE} className={`btn-primary px-3 py-1.5 ${path === NEW_EPISODE ? "ring-2 ring-accent/40" : ""}`}>
        <Plus size={15} /> {t("nav.new")}
      </Link>
      {ITEMS.map((item) => {
        const on = isActive(item.href, path);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 transition ${on ? "border-line bg-panel-2 text-white" : "border-transparent text-muted hover:border-line hover:text-white"}`}
          >
            {t(item.label)}
          </Link>
        );
      })}
    </nav>
  );
}
