import { describe, expect, it } from "vitest";
import { shouldPerformInitialFit } from "./initialFit.js";

/** 全条件が揃った基準入力(各テストで1項目だけ崩して境界を確認する)。 */
function baseInput() {
  return {
    alreadyFitted: false,
    hasReceivedSnapshot: true,
    nodesInitialized: true,
    expectedNodeIds: ["ribbon", "node-a", "node-b"],
    storeNodeIds: ["ribbon", "node-a", "node-b"],
  };
}

describe("shouldPerformInitialFit", () => {
  it("全条件が揃っていればフィットしてよい", () => {
    expect(shouldPerformInitialFit(baseInput())).toBe(true);
  });

  it("スナップショット未受信ならフィットしない", () => {
    expect(
      shouldPerformInitialFit({ ...baseInput(), hasReceivedSnapshot: false }),
    ).toBe(false);
  });

  it(
    "スナップショット受信直後で内部ストアに全ノードがまだ揃っていない" +
      "(設計メモ§7のコミット1相当)場合はフィットしない",
    () => {
      // nodes prop は3件に再計算済みだが、React Flow 内部ストアはまだ
      // チェーンリボン1枚のまま(旧状態)というレースを再現する。
      expect(
        shouldPerformInitialFit({
          ...baseInput(),
          storeNodeIds: ["ribbon"],
        }),
      ).toBe(false);
    },
  );

  it("ノードの計測が完了していなければフィットしない", () => {
    expect(
      shouldPerformInitialFit({ ...baseInput(), nodesInitialized: false }),
    ).toBe(false);
  });

  it("既にフィット済みなら再度フィットしない", () => {
    expect(
      shouldPerformInitialFit({ ...baseInput(), alreadyFitted: true }),
    ).toBe(false);
  });

  it(
    "スナップショットが実質空(チェーンリボンのみ)の世界でも" +
      "全ノードが揃っていればフィットする",
    () => {
      expect(
        shouldPerformInitialFit({
          ...baseInput(),
          expectedNodeIds: ["ribbon"],
          storeNodeIds: ["ribbon"],
        }),
      ).toBe(true);
    },
  );

  it("内部ストアに expectedNodeIds 以外の余分な id があってもフィットする", () => {
    // ゴーストカードの残骸等、期待集合に無い id が混ざっていても
    // 「期待した id が全部揃っているか」だけを見るため影響しない。
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        storeNodeIds: ["ribbon", "node-a", "node-b", "ghost-stale"],
      }),
    ).toBe(true);
  });

  it("expectedNodeIds が空でもフィットする(every は空配列に対して true)", () => {
    expect(
      shouldPerformInitialFit({
        ...baseInput(),
        expectedNodeIds: [],
        storeNodeIds: [],
      }),
    ).toBe(true);
  });
});
