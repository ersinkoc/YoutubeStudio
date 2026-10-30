import { NextResponse, type NextRequest } from "next/server";

/**
 * Stüdyo API'sine yalnız Stüdyo sayfası yazabilir. Tarayıcıda açık başka bir site localhost:3100'e "basit" bir POST
 * gönderip bölüm oluşturabiliyor ve ücretli iş başlatabiliyordu (30 Eki incelemesi): yazma istekleri aynı kökenden ve
 * JSON olmalı (JSON gövdeli çapraz istek tarayıcıda önce izin sorar, izin verilmez).
 */
export function proxy(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return NextResponse.next();
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  let sameOrigin = site === null || site === "same-origin" || site === "none";
  if (origin) {
    try {
      sameOrigin &&= new URL(origin).host === host;
    } catch {
      sameOrigin = false;
    }
  }
  if (!sameOrigin) return NextResponse.json({ error: "Yalnız Stüdyo sayfasından" }, { status: 403 });
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    return NextResponse.json({ error: "JSON gerekli" }, { status: 415 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
