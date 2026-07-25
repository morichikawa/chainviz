// LongRangeAttackDemoView の操作フロー(checkpoint を動かす→判定バナーが
// 実際に切り替わる→リセット)のコンポーネントテスト(Issue #415)。
// 文言・i18n観点・a11y観点・glossary アンカーは別ファイルに分ける
// (CLAUDE.md の1ファイル1責務)。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { LongRangeAttackDemoView } from "./LongRangeAttackDemoView.js";
import { ATTACKER_CHAIN, CANONICAL_CHAIN, DIVERGE_AT } from "./longRangeAttackDemo.js";

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <LongRangeAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

afterEach(cleanup);

describe("LongRangeAttackDemoView: pristine initial state (UX設計 §4 操作フロー1)", () => {
  it("starts with checkpoint 0 selected and the finality verdict already vulnerable", () => {
    renderView();
    expect(screen.getByTestId("long-range-demo-checkpoint-0").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByTestId("long-range-demo-verdict-finality").textContent,
    ).toContain("防げません");
  });

  it("shows all 4 canonical tiles and all 5 attacker tiles", () => {
    renderView();
    for (const number of [0, 1, 2, 3]) {
      expect(screen.getByTestId(`long-range-demo-canonical-tile-${number}`)).toBeTruthy();
    }
    for (const number of [0, 1, 2, 3, 4]) {
      expect(screen.getByTestId(`long-range-demo-attacker-tile-${number}`)).toBeTruthy();
    }
  });

  it("always shows the naive rule verdict as the attacker's history winning (fixed by the seed data)", () => {
    renderView();
    expect(screen.getByTestId("long-range-demo-verdict-naive").textContent).toContain("4");
  });

  it("keeps the naive verdict text and the computed naive verdict in agreement (Issue #415 テスト強化)", () => {
    // naive ルールの結果は `data-naive-verdict` に出るが、表示文言のほうは
    // 「攻撃者の履歴が採用される」で固定されている（疑似データ上、攻撃者が
    // 常に1ブロック長いため）。将来ブロック数の前提が変わって計算結果が
    // "canonical" になると文言と計算が食い違うため、その前提をここで固定する。
    renderView();
    expect(
      screen.getByTestId("long-range-demo").querySelector(".long-range-demo__intro")
        ?.getAttribute("data-naive-verdict"),
    ).toBe("attacker");
    expect(ATTACKER_CHAIN.length).toBeGreaterThan(CANONICAL_CHAIN.length);
    // 表示される番号は決め打ちではなく攻撃者チェーンの先端から導かれること。
    const attackerTip = ATTACKER_CHAIN[ATTACKER_CHAIN.length - 1]!.number;
    expect(screen.getByTestId("long-range-demo-verdict-naive").textContent).toContain(
      `#${attackerTip}`,
    );
  });
});

describe("LongRangeAttackDemoView: moving the finality checkpoint", () => {
  it("flips the finality verdict from vulnerable to protected exactly at the divergence point", () => {
    renderView();
    // divergeAt - 1: まだ防げない。
    fireEvent.click(screen.getByTestId(`long-range-demo-checkpoint-${DIVERGE_AT - 1}`));
    expect(screen.getByTestId("long-range-demo-verdict-finality").textContent).toContain(
      "防げません",
    );

    // divergeAt: 防げるようになる。
    fireEvent.click(screen.getByTestId(`long-range-demo-checkpoint-${DIVERGE_AT}`));
    expect(screen.getByTestId("long-range-demo-verdict-finality").textContent).toContain(
      "維持できます",
    );
  });

  it("marks canonical tiles up to the checkpoint as finalized, and no further", () => {
    renderView();
    fireEvent.click(screen.getByTestId("long-range-demo-checkpoint-1"));
    expect(screen.getByTestId("long-range-demo-canonical-tile-0").className).toContain(
      "--finalized",
    );
    expect(screen.getByTestId("long-range-demo-canonical-tile-1").className).toContain(
      "--finalized",
    );
    expect(screen.getByTestId("long-range-demo-canonical-tile-2").className).not.toContain(
      "--finalized",
    );
  });

  it("moves the active chip as the checkpoint changes (only one chip is aria-pressed at a time)", () => {
    renderView();
    fireEvent.click(screen.getByTestId("long-range-demo-checkpoint-2"));
    expect(screen.getByTestId("long-range-demo-checkpoint-0").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByTestId("long-range-demo-checkpoint-2").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});

describe("LongRangeAttackDemoView: reset", () => {
  it("returns the checkpoint to 0 after it has been moved", () => {
    renderView();
    fireEvent.click(screen.getByTestId("long-range-demo-checkpoint-3"));
    expect(screen.getByTestId("long-range-demo-checkpoint-3").getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByTestId("long-range-demo-reset"));
    expect(screen.getByTestId("long-range-demo-checkpoint-0").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("long-range-demo-checkpoint-3").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByTestId("long-range-demo-verdict-finality").textContent).toContain(
      "防げません",
    );
  });
});
