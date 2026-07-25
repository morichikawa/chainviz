// FiftyOnePercentAttackDemoView のフラッシュ演出のタイマー境界に絞った補強
// テスト（Issue #414 のテスト強化）。基本の「光って消える」1件は
// FiftyOnePercentAttackDemoView.test.tsx が押さえているので、ここでは
// 取りこぼしやすい以下の観点だけを扱う（CLAUDE.md の1ファイル1責務）:
//   - 複数バリデーターのフラッシュが互いに独立して消えること
//   - 同じバリデーターを連続でトグルしたときにタイマーが張り直されること
//   - canonical が逆方向（枝B→枝A）へ戻るときもバッジがフラッシュすること
//   - リセットで進行中のフラッシュとタイマーが即座に片付くこと
//   - フラッシュ中にアンマウントしてもタイマーが残らないこと（リーク防止）
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { FiftyOnePercentAttackDemoView } from "./FiftyOnePercentAttackDemoView.js";

const HALF = NEW_ARRIVAL_HIGHLIGHT_DURATION_MS / 2;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <FiftyOnePercentAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function isValidatorFlashing(id: number): boolean {
  return screen
    .getByTestId(`attack51-demo-validator-${id}`)
    .className.includes("attack51-demo__validator--flash");
}

function isBadgeFlashing(branch: "a" | "b"): boolean {
  return screen
    .getByTestId(`attack51-demo-branch-${branch}-badge`)
    .className.includes("attack51-demo__branch-badge--flash");
}

describe("FiftyOnePercentAttackDemoView: per-validator flash timers are independent", () => {
  it("clears each validator's flash on its own schedule, not all at once", () => {
    renderView();
    fireEvent.click(screen.getByTestId("attack51-demo-validator-1"));
    advance(HALF);
    fireEvent.click(screen.getByTestId("attack51-demo-validator-2"));
    expect(isValidatorFlashing(1)).toBe(true);
    expect(isValidatorFlashing(2)).toBe(true);

    // V1 のフラッシュだけが先に切れる。
    advance(HALF);
    expect(isValidatorFlashing(1)).toBe(false);
    expect(isValidatorFlashing(2)).toBe(true);

    advance(HALF);
    expect(isValidatorFlashing(2)).toBe(false);
  });

  it("restarts the timer when the same validator is toggled again mid-flash", () => {
    renderView();
    fireEvent.click(screen.getByTestId("attack51-demo-validator-3"));
    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS - 1);
    expect(isValidatorFlashing(3)).toBe(true);

    // 消える直前に再クリック（枝Aへ戻る操作）。前のタイマーは破棄され、
    // ここから改めて全期間フラッシュする。
    fireEvent.click(screen.getByTestId("attack51-demo-validator-3"));
    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS - 1);
    expect(isValidatorFlashing(3)).toBe(true);
    advance(1);
    expect(isValidatorFlashing(3)).toBe(false);
  });
});

describe("FiftyOnePercentAttackDemoView: badge flash on the reverse flip", () => {
  it("flashes both badges when canonical goes back from branch B to branch A", () => {
    renderView();
    for (const id of [1, 2, 3, 4]) {
      fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
    }
    expect(isBadgeFlashing("a")).toBe(true);
    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    expect(isBadgeFlashing("a")).toBe(false);
    expect(isBadgeFlashing("b")).toBe(false);

    // 攻撃者を1人戻して枝Aが正準へ復帰する遷移でもバッジが光る。
    fireEvent.click(screen.getByTestId("attack51-demo-validator-4"));
    expect(isBadgeFlashing("a")).toBe(true);
    expect(isBadgeFlashing("b")).toBe(true);
    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    expect(isBadgeFlashing("a")).toBe(false);
  });

  it("restarts the badge timer when a second flip happens before the first flash ends", () => {
    renderView();
    for (const id of [1, 2, 3, 4]) {
      fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
    }
    advance(HALF);
    expect(isBadgeFlashing("b")).toBe(true);

    // フラッシュ中に逆方向へ逆転させる → タイマーが張り直される。
    fireEvent.click(screen.getByTestId("attack51-demo-validator-4"));
    advance(HALF);
    expect(isBadgeFlashing("b")).toBe(true);
    advance(HALF);
    expect(isBadgeFlashing("b")).toBe(false);
  });

  it("does not flash the badges for toggles that leave canonical unchanged", () => {
    renderView();
    // 1〜3人目（canonical は枝Aのまま）・5〜7人目（canonical は枝Bのまま）
    // ではバッジは光らない。
    for (const id of [1, 2, 3]) {
      fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
      expect(isBadgeFlashing("a")).toBe(false);
      expect(isBadgeFlashing("b")).toBe(false);
    }
    fireEvent.click(screen.getByTestId("attack51-demo-validator-4"));
    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    for (const id of [5, 6, 7]) {
      fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
      expect(isBadgeFlashing("a")).toBe(false);
      expect(isBadgeFlashing("b")).toBe(false);
    }
  });
});

describe("FiftyOnePercentAttackDemoView: reset while flashes are in flight", () => {
  it("clears the validator and badge flashes immediately", () => {
    renderView();
    for (const id of [1, 2, 3, 4]) {
      fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
    }
    expect(isValidatorFlashing(4)).toBe(true);
    expect(isBadgeFlashing("b")).toBe(true);

    fireEvent.click(screen.getByTestId("attack51-demo-reset"));
    for (const id of [1, 2, 3, 4]) expect(isValidatorFlashing(id)).toBe(false);
    expect(isBadgeFlashing("a")).toBe(false);
    expect(isBadgeFlashing("b")).toBe(false);
  });

  it("leaves no pending flash timer behind after a reset", () => {
    renderView();
    for (const id of [1, 2, 3, 4]) {
      fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
    }
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("attack51-demo-reset"));
    expect(vi.getTimerCount()).toBe(0);

    // 残骸タイマーが後から発火して状態を書き換えることもない。
    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS * 2);
    expect(screen.getByTestId("attack51-demo-branch-a-weight").textContent).toBe("7");
    for (const id of [1, 2, 3, 4]) expect(isValidatorFlashing(id)).toBe(false);
  });
});

describe("FiftyOnePercentAttackDemoView: unmount while flashing", () => {
  it("clears every pending timer so nothing fires against an unmounted tree", () => {
    const { unmount } = renderView();
    for (const id of [1, 2, 3, 4]) {
      fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
    }
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS * 2)).not.toThrow();
  });
});
