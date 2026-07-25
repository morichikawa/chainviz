// EclipseAttackDemoView の操作フロー(攻撃者ピア追加→占有率メーター・
// 被害ノードのoutline・見ているチェーンの内容が実際に切り替わる→リセット)
// のコンポーネントテスト(Issue #416)。文言・i18n観点は
// EclipseAttackDemoView.i18n.test.tsx、a11y観点は
// EclipseAttackDemoView.a11y.test.tsx に分ける(CLAUDE.md の1ファイル1責務)。
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { ECLIPSE_DEMO_SLOT_COUNT } from "./eclipseAttackDemo.js";
import { EclipseAttackDemoView } from "./EclipseAttackDemoView.js";

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <EclipseAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function addAttacker() {
  fireEvent.click(screen.getByTestId("eclipse-demo-add-attacker"));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EclipseAttackDemoView: pristine initial state", () => {
  it("starts at 8/8 honest peers, victim outline is calm, and the real chain is shown", () => {
    renderView();
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("0 / 8");
    expect(screen.getByTestId("eclipse-demo-victim").getAttribute("class")).not.toContain(
      "eclipse-demo__victim--eclipsed",
    );
    expect(screen.getByTestId("eclipse-demo-badge").textContent).toBe(
      "ネットワーク全体と一致しています",
    );
    expect(screen.queryByTestId("eclipse-demo-warning")).toBeNull();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      expect(screen.getByTestId(`eclipse-demo-slot-${i}`).getAttribute("aria-label")).toBe(
        "正規ピア",
      );
    }
  });
});

describe("EclipseAttackDemoView: adding attacker peers one at a time", () => {
  it("replaces one slot per click, in fixed order, and updates the occupancy meter", () => {
    renderView();
    addAttacker();
    expect(screen.getByTestId("eclipse-demo-slot-0").getAttribute("aria-label")).toBe(
      "攻撃者ピア",
    );
    expect(screen.getByTestId("eclipse-demo-slot-1").getAttribute("aria-label")).toBe(
      "正規ピア",
    );
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("1 / 8");

    addAttacker();
    expect(screen.getByTestId("eclipse-demo-slot-1").getAttribute("aria-label")).toBe(
      "攻撃者ピア",
    );
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("2 / 8");
  });

  it("does not switch the visible chain to fake until the 8th (final) slot flips (boundary: 7/8 stays real)", () => {
    renderView();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT - 1; i += 1) addAttacker();
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("7 / 8");
    expect(screen.getByTestId("eclipse-demo-badge").textContent).toBe(
      "ネットワーク全体と一致しています",
    );
    expect(screen.getByTestId("eclipse-demo-victim").getAttribute("class")).not.toContain(
      "eclipse-demo__victim--eclipsed",
    );
    expect(screen.queryByTestId("eclipse-demo-warning")).toBeNull();
  });

  it("switches the victim outline, the visible chain, and shows the warning exactly at 8/8", () => {
    renderView();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) addAttacker();
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("8 / 8");
    expect(screen.getByTestId("eclipse-demo-victim").getAttribute("class")).toContain(
      "eclipse-demo__victim--eclipsed",
    );
    expect(screen.getByTestId("eclipse-demo-badge").textContent).toBe(
      "攻撃者だけが見せている内容です",
    );
    expect(screen.getByTestId("eclipse-demo-warning")).toBeTruthy();
    expect(screen.getByText("#1 Alice → 攻撃者: 50 ETH")).toBeTruthy();
  });

  it("disables the add-attacker button once all 8 slots are occupied", () => {
    renderView();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) addAttacker();
    const button = screen.getByTestId("eclipse-demo-add-attacker") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("すべてのスロットが攻撃者に占められました");

    // クリックしても状態は変わらない(disabled のため onClick は発火しないが、
    // 念のため回帰として確認する)。
    fireEvent.click(button);
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("8 / 8");
  });
});

describe("EclipseAttackDemoView: slot flash", () => {
  it("flashes the newly replaced slot's chip and clears the flash after the highlight duration", () => {
    renderView();
    addAttacker();
    expect(screen.getByTestId("eclipse-demo-slot-0").querySelector("circle")?.getAttribute(
      "class",
    )).toContain("eclipse-demo__slot-chip--flash");

    act(() => {
      vi.advanceTimersByTime(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    });
    expect(
      screen
        .getByTestId("eclipse-demo-slot-0")
        .querySelector("circle")
        ?.getAttribute("class"),
    ).not.toContain("eclipse-demo__slot-chip--flash");
  });

  it("moves the flash to the newly replaced slot on the next click (previous slot stops flashing)", () => {
    renderView();
    addAttacker();
    addAttacker();
    expect(
      screen.getByTestId("eclipse-demo-slot-0").querySelector("circle")?.getAttribute("class"),
    ).not.toContain("eclipse-demo__slot-chip--flash");
    expect(
      screen.getByTestId("eclipse-demo-slot-1").querySelector("circle")?.getAttribute("class"),
    ).toContain("eclipse-demo__slot-chip--flash");
  });
});

describe("EclipseAttackDemoView: reset", () => {
  it("returns to the pristine 8/8-honest, real-chain state after full eclipse", () => {
    renderView();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) addAttacker();
    expect(screen.getByTestId("eclipse-demo-warning")).toBeTruthy();

    fireEvent.click(screen.getByTestId("eclipse-demo-reset"));
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("0 / 8");
    expect(screen.getByTestId("eclipse-demo-victim").getAttribute("class")).not.toContain(
      "eclipse-demo__victim--eclipsed",
    );
    expect(screen.getByTestId("eclipse-demo-badge").textContent).toBe(
      "ネットワーク全体と一致しています",
    );
    expect(screen.queryByTestId("eclipse-demo-warning")).toBeNull();
    expect(
      (screen.getByTestId("eclipse-demo-add-attacker") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("is always clickable, even from the pristine state (no-op there)", () => {
    renderView();
    fireEvent.click(screen.getByTestId("eclipse-demo-reset"));
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("0 / 8");
  });
});
