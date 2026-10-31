// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = { refresh: vi.fn(), push: vi.fn() };
const nav = { path: "/" as string | null };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => nav.path }));

import { AutoRefresh } from "../../src/app/auto-refresh.tsx";
import { LanguageSwitch, useI18n } from "../../src/app/locale-provider.tsx";
import { isActive, NavMenu } from "../../src/app/nav-menu.tsx";
import { renderIn } from "./fixtures.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  router.refresh.mockReset();
});

describe("AutoRefresh", () => {
  it("verilen aralıkla sayfayı yeniler, kaldırılınca durur", () => {
    vi.useFakeTimers();
    const view = render(<AutoRefresh everyMs={1000} />);
    expect(view.container.innerHTML).toBe("");
    act(() => void vi.advanceTimersByTime(3000));
    expect(router.refresh).toHaveBeenCalledTimes(3);
    view.unmount();
    act(() => void vi.advanceTimersByTime(5000));
    expect(router.refresh).toHaveBeenCalledTimes(3);
  });
});

describe("LanguageSwitch / useI18n", () => {
  it("geçerli dili basılı gösterir; başka dil seçilince çerez yazılır ve sayfa yenilenir", () => {
    renderIn(<LanguageSwitch />, "tr");
    const trBtn = screen.getByRole("button", { name: "tr" });
    const enBtn = screen.getByRole("button", { name: "en" });
    expect(trBtn.getAttribute("aria-pressed")).toBe("true");
    expect(enBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(enBtn);
    expect(document.cookie).toContain("ys-lang=en");
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("İngilizce sağlayıcıda EN basılıdır", () => {
    renderIn(<LanguageSwitch />, "en");
    expect(screen.getByRole("button", { name: "en" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sağlayıcı yoksa varsayılan dil Türkçe", () => {
    function Probe() {
      const { locale, t } = useI18n();
      return (
        <span>
          {locale}:{t("common.loading")}
        </span>
      );
    }
    render(<Probe />);
    expect(screen.getByText("tr:Yükleniyor…")).toBeTruthy();
  });
});

describe("NavMenu", () => {
  it("önde Yeni bölüm düğmesi; bulunulan sayfa işaretli", () => {
    nav.path = "/costs";
    renderIn(<NavMenu />, "tr");
    const links = screen.getAllByRole("link");
    expect(links[0]!.getAttribute("href")).toBe("/episodes/new");
    expect(links[0]!.textContent).toContain("Yeni bölüm");
    expect(links[0]!.className).not.toContain("ring-2");
    expect(screen.getByRole("link", { name: "Maliyetler" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Bölümler" }).getAttribute("aria-current")).toBeNull();
    cleanup();
    nav.path = "/episodes/new";
    renderIn(<NavMenu />, "en");
    expect(screen.getAllByRole("link")[0]!.className).toContain("ring-2");
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
    cleanup();
    // Next dışında yol yoksa hiçbir öğe seçili değil.
    nav.path = null;
    renderIn(<NavMenu />, "tr");
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("isActive: Bölümler bölüm sayfalarını da kapsar, yeni bölüm hariç; alt sayfalar üst öğeyi seçer", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/", "/episodes/e1")).toBe(true);
    expect(isActive("/", "/episodes/new")).toBe(false);
    expect(isActive("/", "/costs")).toBe(false);
    expect(isActive("/characters", "/characters/x")).toBe(true);
    expect(isActive("/costs", "/costsx")).toBe(false);
  });
});
