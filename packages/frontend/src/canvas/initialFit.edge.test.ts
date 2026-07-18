// shouldPerformInitialFit の異常系・境界値のテスト強化(Issue #373)。
//
// initialFit.test.ts が「全条件を1つずつ崩す」真理値表を押さえているのに
// 対し、こちらは「部分的にしかノードが計測されていない中間状態」を中心に、
// 部分集合判定の境界(off-by-one・順序非依存・完全一致・重複 id・空集合)と、
// 初期フィット後の1回きりガードを固定する。設計メモ §7 のレース
// (スナップショット到着直後に nodes prop は全件だが内部ストアはまだ旧状態)で
// 誤って true を返さないことが眼目。

import { describe, expect, it } from "vitest";
import { shouldPerformInitialFit } from "./initialFit.js";

/** 全条件が揃った基準入力(各テストで一部だけ崩して境界を確認する)。 */
function baseInput() {
  return {
    alreadyFitted: false,
    hasReceivedSnapshot: true,
    nodesInitialized: true,
    expectedNodeIds: ["ribbon", "node-a", "node-b"],
    storeNodeIds: ["ribbon", "node-a", "node-b"],
  };
}

describe("shouldPerformInitialFit: 部分計測の中間状態(設計メモ §7)", () => {
  it("末尾1件だけ内部ストアに未反映ならフィットしない(off-by-one)", () => {
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        storeNodeIds: ["ribbon", "node-a"],
      }),
    ).toBe(false);
  });

  it("先頭1件だけ未反映でもフィットしない(判定は順序に依らない)", () => {
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        storeNodeIds: ["node-a", "node-b"],
      }),
    ).toBe(false);
  });

  it("中間の1件が欠けてもフィットしない", () => {
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        storeNodeIds: ["ribbon", "node-b"],
      }),
    ).toBe(false);
  });

  it("内部ストアが空で expected が非空なら(スナップショット直後の極端な中間状態)フィットしない", () => {
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        storeNodeIds: [],
      }),
    ).toBe(false);
  });

  it("大規模スナップショットで1件でも未計測ならフィットせず、全件揃えばフィットする", () => {
    const ids = Array.from({ length: 17 }, (_, i) => `n-${i}`);
    // 16/17 件だけ内部ストアに反映済み(最後の1件がまだ)の中間状態。
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        expectedNodeIds: ids,
        storeNodeIds: ids.slice(0, 16),
      }),
    ).toBe(false);
    // 全 17 件が揃った計測完了コミット。
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        expectedNodeIds: ids,
        storeNodeIds: ids,
      }),
    ).toBe(true);
  });
});

describe("shouldPerformInitialFit: id 集合判定の境界", () => {
  it("id は完全一致で判定する(大文字小文字違いは別 id とみなしフィットしない)", () => {
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        expectedNodeIds: ["Node-A"],
        storeNodeIds: ["node-a"],
      }),
    ).toBe(false);
  });

  it("expected に重複 id があっても、その id が内部ストアに存在すればフィットする", () => {
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        expectedNodeIds: ["node-a", "node-a", "node-b"],
        storeNodeIds: ["node-a", "node-b"],
      }),
    ).toBe(true);
  });

  it("expected に重複 id があり、その id が未反映ならフィットしない", () => {
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        expectedNodeIds: ["node-a", "node-a", "node-b"],
        storeNodeIds: ["node-b"],
      }),
    ).toBe(false);
  });

  it("expected が空なら内部ストアに残骸だけあってもフィットする(every は空配列に対して true)", () => {
    // initialFit.test.ts は expected/store とも空のケースを持つが、こちらは
    // 「期待集合だけが空で、ストアには余分な id が残っている」区別を固定する。
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        expectedNodeIds: [],
        storeNodeIds: ["ribbon", "stale-ghost"],
      }),
    ).toBe(true);
  });
});

describe("shouldPerformInitialFit: 1回きりガード(点検観点2)", () => {
  it("初期フィット後は、2回目のスナップショットで全ノードが計測完了しても再フィットしない", () => {
    // alreadyFitted=true 以外の条件はすべて「フィットしてよい」状態に揃えて
    // おき、それでも false になる(= 1回きりガードが他条件より優先される)
    // ことを固定する。実配線(useInitialFit)では firedRef がこの値を担う。
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        alreadyFitted: true,
      }),
    ).toBe(false);
  });

  it("フィット後に再計測(nodesInitialized が false→true)が起きても再フィットしない", () => {
    // 新規ワークベンチ追加などで内部ストアが増え計測が回り直しても、
    // alreadyFitted が立っていればフィットしない。
    expect(
      shouldPerformInitialFit({
        alreadyFitted: true,
        hasReceivedSnapshot: true,
        nodesInitialized: true,
        expectedNodeIds: ["ribbon", "node-a", "node-b", "workbench-1"],
        storeNodeIds: ["ribbon", "node-a", "node-b", "workbench-1"],
      }),
    ).toBe(false);
  });
});
