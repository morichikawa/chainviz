// FiftyOnePercentAttackDemoView の操作フロー(トグル→重み再計算→canonical
// 反転→リセット)のコンポーネントテスト(Issue #414)。文言・a11y観点は
// 別ファイルに分ける(CLAUDE.md の1ファイル1責務)。
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { FiftyOnePercentAttackDemoView } from "./FiftyOnePercentAttackDemoView.js";

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <FiftyOnePercentAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function branchWeight(branch: "a" | "b"): string | null {
  return screen.getByTestId(`attack51-demo-branch-${branch}-weight`).textContent;
}

function branchBadge(branch: "a" | "b"): string | null {
  return screen.getByTestId(`attack51-demo-branch-${branch}-badge`).textContent;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("FiftyOnePercentAttackDemoView: pristine initial state", () => {
  it("starts with all 7 validators on branch A, none on branch B, A canonical", () => {
    renderView();
    expect(branchWeight("a")).toBe("7");
    expect(branchWeight("b")).toBe("0");
    expect(branchBadge("a")).toBe("正準");
    expect(branchBadge("b")).toBe("非正準（捨てられる枝）");
    expect(screen.getByTestId("attack51-demo-summary-value").textContent).toBe(
      "0 / 7人（0%）",
    );
    // 枝Bはまだ誰も支持していないので空状態文言が出る。
    expect(
      screen.getByTestId("attack51-demo-branch-b-validators").textContent,
    ).toContain("まだ誰もこの枝を支持していません");
  });
});

describe("FiftyOnePercentAttackDemoView: toggling validators moves them between branches", () => {
  it("moves validator 3 from branch A to branch B when its button is clicked", () => {
    renderView();
    fireEvent.click(screen.getByTestId("attack51-demo-validator-3"));
    expect(branchWeight("a")).toBe("6");
    expect(branchWeight("b")).toBe("1");
    // トグル後、ボタンは枝Bの箱の中に描画され直す(同じ testid のまま)。
    expect(screen.getByTestId("attack51-demo-branch-b-validators").textContent).toContain("V3");
  });

  it("toggling the same validator twice returns it to branch A", () => {
    renderView();
    fireEvent.click(screen.getByTestId("attack51-demo-validator-3"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-3"));
    expect(branchWeight("a")).toBe("7");
    expect(branchWeight("b")).toBe("0");
  });
});

describe("FiftyOnePercentAttackDemoView: canonical branch flips at the 4-of-7 boundary", () => {
  it("keeps branch A canonical with 3 attacker-controlled validators (margin: 1 more)", () => {
    renderView();
    fireEvent.click(screen.getByTestId("attack51-demo-validator-1"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-2"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-3"));
    expect(branchWeight("a")).toBe("4");
    expect(branchWeight("b")).toBe("3");
    expect(branchBadge("a")).toBe("正準");
    expect(branchBadge("b")).toBe("非正準（捨てられる枝）");
    expect(screen.getByTestId("attack51-demo-margin-hint").textContent).toBe(
      "枝Bが逆転するまであと1人",
    );
  });

  it("flips canonical to branch B once a 4th validator is turned (~57%)", () => {
    renderView();
    fireEvent.click(screen.getByTestId("attack51-demo-validator-1"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-2"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-3"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-4"));
    expect(branchWeight("a")).toBe("3");
    expect(branchWeight("b")).toBe("4");
    expect(branchBadge("a")).toBe("非正準（捨てられる枝）");
    expect(branchBadge("b")).toBe("正準");
    expect(screen.getByTestId("attack51-demo-margin-hint").textContent).toBe(
      "攻撃者はすでに枝Bを正準にしています",
    );
  });
});

describe("FiftyOnePercentAttackDemoView: validator flash", () => {
  it("flashes the toggled validator's button and clears it after the highlight duration", () => {
    renderView();
    fireEvent.click(screen.getByTestId("attack51-demo-validator-3"));
    expect(screen.getByTestId("attack51-demo-validator-3").className).toContain(
      "attack51-demo__validator--flash",
    );

    act(() => {
      vi.advanceTimersByTime(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    });
    expect(screen.getByTestId("attack51-demo-validator-3").className).not.toContain(
      "attack51-demo__validator--flash",
    );
  });

  it("flashes both branch badges only when the toggle actually flips canonical status", () => {
    renderView();
    // 3人目までは canonical は変わらない → バッジはフラッシュしない。
    fireEvent.click(screen.getByTestId("attack51-demo-validator-1"));
    expect(screen.getByTestId("attack51-demo-branch-a-badge").className).not.toContain(
      "attack51-demo__branch-badge--flash",
    );

    fireEvent.click(screen.getByTestId("attack51-demo-validator-2"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-3"));
    // 4人目で反転する → 両方の枝のバッジがフラッシュする。
    fireEvent.click(screen.getByTestId("attack51-demo-validator-4"));
    expect(screen.getByTestId("attack51-demo-branch-a-badge").className).toContain(
      "attack51-demo__branch-badge--flash",
    );
    expect(screen.getByTestId("attack51-demo-branch-b-badge").className).toContain(
      "attack51-demo__branch-badge--flash",
    );

    act(() => {
      vi.advanceTimersByTime(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    });
    expect(screen.getByTestId("attack51-demo-branch-a-badge").className).not.toContain(
      "attack51-demo__branch-badge--flash",
    );
  });
});

describe("FiftyOnePercentAttackDemoView: reset", () => {
  it("returns to the pristine state (all validators back on branch A) after toggles", () => {
    renderView();
    fireEvent.click(screen.getByTestId("attack51-demo-validator-1"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-2"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-3"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-4"));
    expect(branchBadge("b")).toBe("正準");

    fireEvent.click(screen.getByTestId("attack51-demo-reset"));
    expect(branchWeight("a")).toBe("7");
    expect(branchWeight("b")).toBe("0");
    expect(branchBadge("a")).toBe("正準");
    expect(screen.getByTestId("attack51-demo-summary-value").textContent).toBe(
      "0 / 7人（0%）",
    );
  });
});

describe("FiftyOnePercentAttackDemoView: extreme value (all validators attacker-controlled)", () => {
  it("shows the branch-A empty state once every validator has moved to branch B", () => {
    renderView();
    for (let id = 1; id <= 7; id++) {
      fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
    }
    expect(branchWeight("a")).toBe("0");
    expect(branchWeight("b")).toBe("7");
    expect(
      screen.getByTestId("attack51-demo-branch-a-validators").textContent,
    ).toContain("まだ誰もこの枝を支持していません");
  });
});
