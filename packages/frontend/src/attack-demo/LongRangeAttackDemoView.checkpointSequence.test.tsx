// checkpoint を連続で動かしたときに、判定バナー・確定済みタイル・選択中の
// チップがすべて都度再計算される（古い結果が残らない）ことを固定する補強
// テスト（Issue #415 テスト強化）。1回だけ動かす基本ケースは
// LongRangeAttackDemoView.test.tsx が扱う（CLAUDE.md の1ファイル1責務）。
//
// 重点:
//   - 0→3 の前進 sweep と 3→0 の後退 sweep の両方で毎段の表示が正しいこと
//   - 後退時に確定済みタイル・バッジが縮むこと（前の判定の残留が無いこと）
//   - 同じチップの連打が冪等（トグルで解除されない）こと
//   - リセットの初期化が「チップ・タイル・バッジ・判定バナー」の全面に及ぶこと
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { LongRangeAttackDemoView } from "./LongRangeAttackDemoView.js";
import { CANONICAL_CHAIN, DIVERGE_AT } from "./longRangeAttackDemo.js";

afterEach(cleanup);

const CHECKPOINTS = CANONICAL_CHAIN.map((block) => block.number);
const VULNERABLE = "防げません";
const PROTECTED = "維持できます";

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <LongRangeAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function clickCheckpoint(number: number) {
  fireEvent.click(screen.getByTestId(`long-range-demo-checkpoint-${number}`));
}

/** 現在 `aria-pressed="true"` のチップの番号（常にちょうど1つである想定）。 */
function pressedCheckpoints(): number[] {
  return CHECKPOINTS.filter(
    (number) =>
      screen.getByTestId(`long-range-demo-checkpoint-${number}`).getAttribute("aria-pressed") ===
      "true",
  );
}

/** 確定済み表示（`--finalized` 修飾クラス）になっている正規タイルの番号。 */
function finalizedTiles(): number[] {
  return CHECKPOINTS.filter((number) =>
    screen.getByTestId(`long-range-demo-canonical-tile-${number}`).className.includes("--finalized"),
  );
}

/** 「確定済み」バッジが描かれている正規タイルの番号。 */
function badgedTiles(): number[] {
  return CHECKPOINTS.filter(
    (number) => screen.queryByTestId(`long-range-demo-canonical-finalized-${number}`) !== null,
  );
}

function finalityVerdictText(): string {
  return screen.getByTestId("long-range-demo-verdict-finality").textContent ?? "";
}

function expectStateFor(checkpoint: number) {
  expect(pressedCheckpoints()).toEqual([checkpoint]);
  const expectedFinalized = CHECKPOINTS.filter((number) => number <= checkpoint);
  expect(finalizedTiles()).toEqual(expectedFinalized);
  // 見た目（クラス）とバッジが常に同じ集合であること（片方だけ残らない）。
  expect(badgedTiles()).toEqual(expectedFinalized);
  expect(finalityVerdictText()).toContain(checkpoint >= DIVERGE_AT ? PROTECTED : VULNERABLE);
}

describe("LongRangeAttackDemoView: sweeping the checkpoint forward and back", () => {
  it("recomputes every visible piece of state at each step of the forward sweep", () => {
    renderView();
    expectStateFor(0);
    for (const checkpoint of CHECKPOINTS.slice(1)) {
      clickCheckpoint(checkpoint);
      expectStateFor(checkpoint);
    }
  });

  it("shrinks the finalized region again on the backward sweep (no stale verdict or badges)", () => {
    renderView();
    clickCheckpoint(CHECKPOINTS[CHECKPOINTS.length - 1]!);
    expectStateFor(CHECKPOINTS[CHECKPOINTS.length - 1]!);
    for (const checkpoint of [...CHECKPOINTS].reverse().slice(1)) {
      clickCheckpoint(checkpoint);
      expectStateFor(checkpoint);
    }
  });

  it("keeps up with a non-monotonic sequence of jumps", () => {
    renderView();
    // 行き来を混ぜても、毎回その時点の checkpoint だけから再計算されること。
    for (const checkpoint of [3, 0, 2, 1, 3, 2, 0]) {
      clickCheckpoint(checkpoint);
      expectStateFor(checkpoint);
    }
  });

  it("flips the finality verdict back and forth across the divergence boundary", () => {
    renderView();
    for (let round = 0; round < 3; round++) {
      clickCheckpoint(DIVERGE_AT);
      expect(finalityVerdictText()).toContain(PROTECTED);
      clickCheckpoint(DIVERGE_AT - 1);
      expect(finalityVerdictText()).toContain(VULNERABLE);
    }
  });

  it("treats repeated clicks on the same chip as a no-op (not a toggle)", () => {
    renderView();
    clickCheckpoint(DIVERGE_AT);
    clickCheckpoint(DIVERGE_AT);
    clickCheckpoint(DIVERGE_AT);
    expectStateFor(DIVERGE_AT);
  });

  it("leaves the naive rule verdict untouched at every checkpoint", () => {
    renderView();
    const naiveText = screen.getByTestId("long-range-demo-verdict-naive").textContent;
    for (const checkpoint of [1, 2, 3, 0]) {
      clickCheckpoint(checkpoint);
      expect(screen.getByTestId("long-range-demo-verdict-naive").textContent).toBe(naiveText);
    }
  });

  it("keeps the attacker's fork marking independent of the checkpoint", () => {
    renderView();
    function forkTiles(): number[] {
      return [0, 1, 2, 3, 4].filter((number) =>
        screen.getByTestId(`long-range-demo-attacker-tile-${number}`).className.includes("--fork"),
      );
    }
    const before = forkTiles();
    for (const checkpoint of CHECKPOINTS) {
      clickCheckpoint(checkpoint);
      expect(forkTiles()).toEqual(before);
    }
  });
});

describe("LongRangeAttackDemoView: reset restores the pristine state completely", () => {
  it.each(CHECKPOINTS)("returns everything to the initial state from checkpoint %i", (checkpoint) => {
    renderView();
    clickCheckpoint(checkpoint);
    fireEvent.click(screen.getByTestId("long-range-demo-reset"));
    expectStateFor(0);
  });

  it("is a no-op when the demo is already in its initial state", () => {
    renderView();
    fireEvent.click(screen.getByTestId("long-range-demo-reset"));
    fireEvent.click(screen.getByTestId("long-range-demo-reset"));
    expectStateFor(0);
  });

  it("can be replayed: move → reset → move again → reset", () => {
    renderView();
    clickCheckpoint(3);
    fireEvent.click(screen.getByTestId("long-range-demo-reset"));
    expectStateFor(0);
    clickCheckpoint(2);
    expectStateFor(2);
    fireEvent.click(screen.getByTestId("long-range-demo-reset"));
    expectStateFor(0);
  });
});
