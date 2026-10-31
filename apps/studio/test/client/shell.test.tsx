// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { AutoRefresh } from "../../src/app/auto-refresh.tsx";
import { LanguageSwitch, useI18n } from "../../src/app/locale-provider.tsx";
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
