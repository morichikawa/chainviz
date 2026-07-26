// EclipseAttackDemoView の異常系・境界値の補強テスト（Issue #416 テスト強化）。
// 基本の操作フローは EclipseAttackDemoView.test.tsx、文言は .i18n.test.tsx、
// a11y は .a11y.test.tsx が扱う。ここは以下に絞る（CLAUDE.md の1ファイル1責務）:
//   - 8/8 到達後に追加操作を繰り返しても表示が壊れないこと（9回目以降）
//   - 占有率の丸め（1/8 = 13% など .5 の境界）とメーター幅の対応
//   - 7/8 境界で「見ているチェーン」の中身そのものが正規のままであること
//   - リセット後に再び満杯まで進められること（サイクルを2周できる）
//   - フラッシュ用タイマーの後始末（リセット時・アンマウント時）
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

function addButton(): HTMLButtonElement {
  return screen.getByTestId("eclipse-demo-add-attacker") as HTMLButtonElement;
}

function resetButton(): HTMLButtonElement {
  return screen.getByTestId("eclipse-demo-reset") as HTMLButtonElement;
}

function addAttacker(times = 1) {
  for (let i = 0; i < times; i += 1) fireEvent.click(addButton());
}

function meterText(): string {
  return screen.getByTestId("eclipse-demo-meter").textContent ?? "";
}

function blockTexts(): string[] {
  return [...screen.getByTestId("eclipse-demo-view").querySelectorAll("li")].map(
    (li) => li.textContent ?? "",
  );
}

const REAL_BLOCK_TEXTS = [
  "#1 Alice → Bob: 3 ETH",
  "#2 Bob → Carol: 1 ETH",
  "#3 Carol → Dave: 2 ETH",
];
const FAKE_BLOCK_TEXTS = [
  "#1 Alice → 攻撃者: 50 ETH",
  "#2 攻撃者 → 攻撃者: 999 ETH",
  "#3 Carol → 攻撃者: 50 ETH",
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EclipseAttackDemoView: interacting past the 8/8 boundary", () => {
  it("keeps 8/8 and a single warning after four further clicks on the disabled add button", () => {
    renderView();
    addAttacker(ECLIPSE_DEMO_SLOT_COUNT);
    expect(addButton().disabled).toBe(true);

    // disabled なボタンへのクリックは onClick を発火しないが、万一 disabled
    // が外れた場合でも addAttackerPeer 側が no-op であることの二重ガード。
    expect(() => addAttacker(4)).not.toThrow();

    expect(meterText()).toContain("8 / 8");
    expect(meterText()).toContain("100%");
    expect(meterText()).not.toContain("9 / 8");
    expect(screen.getAllByTestId("eclipse-demo-warning").length).toBe(1);
    expect(screen.getByTestId("eclipse-demo-badge").textContent).toBe(
      "攻撃者だけが見せている内容です",
    );
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      expect(screen.getByTestId(`eclipse-demo-slot-${i}`).getAttribute("aria-label")).toBe(
        "攻撃者ピア",
      );
    }
    expect(blockTexts()).toEqual(FAKE_BLOCK_TEXTS);
  });

  it("keeps the reset button enabled and focusable once the add button is disabled", () => {
    // 追加ボタンが disabled になるとタブ順から外れるため、初期状態へ戻る
    // 手段（リセット）が常にキーボードで到達できることを固定する。
    renderView();
    addAttacker(ECLIPSE_DEMO_SLOT_COUNT);
    expect(addButton().disabled).toBe(true);

    const reset = resetButton();
    expect(reset.disabled).toBe(false);
    reset.focus();
    expect(document.activeElement).toBe(reset);
  });
});

describe("EclipseAttackDemoView: occupancy meter rounding and width", () => {
  // 1/8 = 12.5% → 13%、3/8 = 37.5% → 38% のように .5 の丸めが起きる段階を
  // すべて通す（表示とメーター幅が同じ値から導出されていることの確認）。
  const expectedPercents = [0, 13, 25, 38, 50, 63, 75, 88, 100];

  it("shows the rounded percentage and matching bar width at every step 0..8", () => {
    renderView();
    for (let clicks = 0; clicks <= ECLIPSE_DEMO_SLOT_COUNT; clicks += 1) {
      if (clicks > 0) addAttacker();
      const percent = expectedPercents[clicks];
      expect(meterText()).toContain(`${clicks} / 8`);
      expect(meterText()).toContain(`${percent}%`);
      const fill = screen
        .getByTestId("eclipse-demo-meter")
        .querySelector<HTMLElement>(".eclipse-demo__meter-fill");
      expect(fill?.style.width).toBe(`${percent}%`);
    }
  });
});

describe("EclipseAttackDemoView: the 7/8 boundary keeps the real chain contents", () => {
  it("shows the real block texts and none of the fake ones at 7/8", () => {
    renderView();
    addAttacker(ECLIPSE_DEMO_SLOT_COUNT - 1);
    expect(meterText()).toContain("7 / 8");
    expect(blockTexts()).toEqual(REAL_BLOCK_TEXTS);
    for (const fake of FAKE_BLOCK_TEXTS) {
      expect(screen.queryByText(fake)).toBeNull();
    }
  });

  it("replaces every block, and only at the 8th click, keeping the list at three entries", () => {
    renderView();
    addAttacker(ECLIPSE_DEMO_SLOT_COUNT - 1);
    expect(blockTexts().length).toBe(3);

    addAttacker();
    expect(blockTexts()).toEqual(FAKE_BLOCK_TEXTS);
    expect(blockTexts().length).toBe(3);
    for (const real of REAL_BLOCK_TEXTS) {
      expect(screen.queryByText(real)).toBeNull();
    }
  });
});

describe("EclipseAttackDemoView: reset then fill up again", () => {
  it("can be driven to a full eclipse again after a reset (two complete rounds)", () => {
    renderView();
    for (let round = 0; round < 2; round += 1) {
      addAttacker(ECLIPSE_DEMO_SLOT_COUNT);
      expect(meterText()).toContain("8 / 8");
      expect(blockTexts()).toEqual(FAKE_BLOCK_TEXTS);
      expect(screen.getByTestId("eclipse-demo-warning")).toBeTruthy();

      fireEvent.click(resetButton());
      expect(meterText()).toContain("0 / 8");
      expect(blockTexts()).toEqual(REAL_BLOCK_TEXTS);
      expect(screen.queryByTestId("eclipse-demo-warning")).toBeNull();
      expect(addButton().disabled).toBe(false);
    }
  });

  it("restarts the replacement order from slot 0 after a mid-progress reset", () => {
    renderView();
    addAttacker(3);
    expect(screen.getByTestId("eclipse-demo-slot-2").getAttribute("aria-label")).toBe(
      "攻撃者ピア",
    );

    fireEvent.click(resetButton());
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      expect(screen.getByTestId(`eclipse-demo-slot-${i}`).getAttribute("aria-label")).toBe(
        "正規ピア",
      );
    }

    addAttacker();
    expect(screen.getByTestId("eclipse-demo-slot-0").getAttribute("aria-label")).toBe(
      "攻撃者ピア",
    );
    expect(screen.getByTestId("eclipse-demo-slot-1").getAttribute("aria-label")).toBe("正規ピア");
    expect(meterText()).toContain("1 / 8");
  });
});

describe("EclipseAttackDemoView: flash timer teardown", () => {
  function flashClassOf(index: number): string {
    return (
      screen
        .getByTestId(`eclipse-demo-slot-${index}`)
        .querySelector("circle")
        ?.getAttribute("class") ?? ""
    );
  }

  it("clears a pending flash on reset and does not re-flash after the timer elapses", () => {
    renderView();
    addAttacker();
    expect(flashClassOf(0)).toContain("eclipse-demo__slot-chip--flash");

    fireEvent.click(resetButton());
    expect(flashClassOf(0)).not.toContain("eclipse-demo__slot-chip--flash");

    act(() => {
      vi.advanceTimersByTime(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS * 2);
    });
    expect(flashClassOf(0)).not.toContain("eclipse-demo__slot-chip--flash");
  });

  it("does not leave a live timer behind when unmounted mid-flash", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderView();
    addAttacker();
    expect(vi.getTimerCount()).toBe(1); // フラッシュ解除待ちのタイマーが1本
    unmount();
    // アンマウント時のクリーンアップでタイマーが破棄されること（残っていると
    // 解除済みコンポーネントへの setState を試みる）。
    expect(vi.getTimerCount()).toBe(0);

    expect(() =>
      act(() => {
        vi.advanceTimersByTime(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS * 2);
      }),
    ).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps only the most recently replaced slot flashing when clicks come in quick succession", () => {
    renderView();
    // 連打（同一フレーム内での連続クリック）でもフラッシュ対象は1つに保たれる。
    addAttacker(3);
    expect(flashClassOf(0)).not.toContain("eclipse-demo__slot-chip--flash");
    expect(flashClassOf(1)).not.toContain("eclipse-demo__slot-chip--flash");
    expect(flashClassOf(2)).toContain("eclipse-demo__slot-chip--flash");

    act(() => {
      vi.advanceTimersByTime(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    });
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      expect(flashClassOf(i)).not.toContain("eclipse-demo__slot-chip--flash");
    }
  });
});
