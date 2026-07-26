// FiftyOnePercentAttackDemoView の境界値・逆方向の遷移に絞った補強テスト
// （Issue #414 のテスト強化）。
//   - サマリ行の割合表示（0〜7人の全段階。四捨五入と「約57%」注記の整合）
//   - 逆転ラインのヒント文が全段階で正しく更新されること
//   - 逆転後に攻撃者を1人戻すと canonical が枝Aへ戻る（逆方向の遷移）
//   - クリック順序を変えても結果が同じで、表示は常に昇順（個体の同一性）
// 基本の操作フロー（3人→4人の順方向・リセット・極端値）は
// FiftyOnePercentAttackDemoView.test.tsx、フラッシュのタイマー挙動は
// .flashTimers.test.tsx が扱う（CLAUDE.md の1ファイル1責務）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { FiftyOnePercentAttackDemoView } from "./FiftyOnePercentAttackDemoView.js";

afterEach(cleanup);

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <FiftyOnePercentAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function clickValidators(ids: readonly number[]) {
  for (const id of ids) {
    fireEvent.click(screen.getByTestId(`attack51-demo-validator-${id}`));
  }
}

function summaryValue(): string | null {
  return screen.getByTestId("attack51-demo-summary-value").textContent;
}

function marginHint(): string | null {
  return screen.getByTestId("attack51-demo-margin-hint").textContent;
}

function branchWeight(branch: "a" | "b"): string | null {
  return screen.getByTestId(`attack51-demo-branch-${branch}-weight`).textContent;
}

function branchBadge(branch: "a" | "b"): string | null {
  return screen.getByTestId(`attack51-demo-branch-${branch}-badge`).textContent;
}

/** 枝の箱に並んでいるバリデーターボタンのラベルを描画順に返す。 */
function branchValidatorLabels(branch: "a" | "b"): string[] {
  const box = screen.getByTestId(`attack51-demo-branch-${branch}-validators`);
  return [...box.querySelectorAll("button")].map((button) => button.textContent ?? "");
}

describe("FiftyOnePercentAttackDemoView: summary percentage at every attacker count", () => {
  it("rounds the share the same way the threshold note describes (4 of 7 = about 57%)", () => {
    renderView();
    // 0人時点の表示は既存テストが固定済み。1人ずつ増やしながら全段階を確認する。
    const expected = [
      "0 / 7人（0%）",
      "1 / 7人（14%）",
      "2 / 7人（29%）",
      "3 / 7人（43%）",
      "4 / 7人（57%）",
      "5 / 7人（71%）",
      "6 / 7人（86%）",
      "7 / 7人（100%）",
    ];
    expect(summaryValue()).toBe(expected[0]);
    for (let count = 1; count <= 7; count++) {
      clickValidators([count]);
      expect(summaryValue()).toBe(expected[count]);
    }
    // 逆転する4人目の表示（57%）が `thresholdNote` の「約57%」と一致している
    // ことが、この砂場の学習ポイントの整合性そのもの。
    expect(expected[4]).toContain("57%");
  });
});

describe("FiftyOnePercentAttackDemoView: margin-to-flip hint across the whole range", () => {
  it("counts down from 4 to 1 and then switches to the already-flipped sentence", () => {
    renderView();
    expect(marginHint()).toBe("枝Bが逆転するまであと4人");
    clickValidators([1]);
    expect(marginHint()).toBe("枝Bが逆転するまであと3人");
    clickValidators([2]);
    expect(marginHint()).toBe("枝Bが逆転するまであと2人");
    clickValidators([3]);
    expect(marginHint()).toBe("枝Bが逆転するまであと1人");
    clickValidators([4]);
    expect(marginHint()).toBe("攻撃者はすでに枝Bを正準にしています");
    // 逆転後はさらに増えても同じ文言のまま（「あと0人」「あと-1人」を出さない）。
    clickValidators([5, 6, 7]);
    expect(marginHint()).toBe("攻撃者はすでに枝Bを正準にしています");
    expect(marginHint()).not.toContain("0人");
  });
});

describe("FiftyOnePercentAttackDemoView: canonical flips back when an attacker is released", () => {
  it("returns canonical to branch A as soon as the 4th attacker is toggled back (3 of 7)", () => {
    renderView();
    clickValidators([1, 2, 3, 4]);
    expect(branchBadge("b")).toBe("正準");

    // 枝Bの箱に並んでいる V4 をもう一度クリック（誠実へ戻す）。
    clickValidators([4]);
    expect(branchWeight("a")).toBe("4");
    expect(branchWeight("b")).toBe("3");
    expect(branchBadge("a")).toBe("正準");
    expect(branchBadge("b")).toBe("非正準（捨てられる枝）");
    expect(marginHint()).toBe("枝Bが逆転するまであと1人");
  });

  it("survives repeated flips across the boundary without drifting", () => {
    renderView();
    clickValidators([1, 2, 3]);
    for (let round = 0; round < 3; round++) {
      clickValidators([4]);
      expect(branchBadge("b")).toBe("正準");
      expect(marginHint()).toBe("攻撃者はすでに枝Bを正準にしています");
      clickValidators([4]);
      expect(branchBadge("a")).toBe("正準");
      expect(marginHint()).toBe("枝Bが逆転するまであと1人");
    }
    expect(branchWeight("a")).toBe("4");
    expect(branchWeight("b")).toBe("3");
    expect(summaryValue()).toBe("3 / 7人（43%）");
  });
});

describe("FiftyOnePercentAttackDemoView: click order does not change the outcome", () => {
  it("shows the same weights/canonical branch and an ascending roster for a shuffled click order", () => {
    renderView();
    clickValidators([7, 5, 2, 1]);
    expect(branchWeight("a")).toBe("3");
    expect(branchWeight("b")).toBe("4");
    expect(branchBadge("b")).toBe("正準");
    // どのバリデーターが寝返ったかが保たれ、並びはクリック順ではなく昇順。
    expect(branchValidatorLabels("b")).toEqual(["V1", "V2", "V5", "V7"]);
    expect(branchValidatorLabels("a")).toEqual(["V3", "V4", "V6"]);
  });

  it("keeps each validator's aria-pressed in sync with the box it is drawn in", () => {
    renderView();
    clickValidators([6, 2]);
    for (const id of [2, 6]) {
      const button = screen.getByTestId(`attack51-demo-validator-${id}`);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.closest("[data-testid='attack51-demo-branch-b-validators']")).toBeTruthy();
    }
    for (const id of [1, 3, 4, 5, 7]) {
      const button = screen.getByTestId(`attack51-demo-validator-${id}`);
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.closest("[data-testid='attack51-demo-branch-a-validators']")).toBeTruthy();
    }
  });
});

describe("FiftyOnePercentAttackDemoView: empty-state text appears only for the empty branch", () => {
  it("shows it on branch B initially and on branch A after every validator defects", () => {
    renderView();
    expect(screen.getByTestId("attack51-demo-branch-b-validators").textContent).toBe(
      "まだ誰もこの枝を支持していません",
    );
    expect(screen.getByTestId("attack51-demo-branch-a-validators").textContent).not.toContain(
      "まだ誰もこの枝を支持していません",
    );

    clickValidators([1, 2, 3, 4, 5, 6, 7]);
    expect(screen.getByTestId("attack51-demo-branch-a-validators").textContent).toBe(
      "まだ誰もこの枝を支持していません",
    );
    expect(branchValidatorLabels("a")).toEqual([]);
    expect(branchValidatorLabels("b")).toEqual(["V1", "V2", "V3", "V4", "V5", "V6", "V7"]);

    // 1人戻すと空状態文言も消える（片方だけが空になる遷移の往復）。
    clickValidators([4]);
    expect(screen.getByTestId("attack51-demo-branch-a-validators").textContent).not.toContain(
      "まだ誰もこの枝を支持していません",
    );
    expect(branchValidatorLabels("a")).toEqual(["V4"]);
  });
});
