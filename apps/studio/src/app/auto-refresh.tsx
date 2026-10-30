"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Sunucu sayfasını belirli aralıkla yeniden çizer (ör. çalışan bölüm varken liste canlı kalsın). */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
