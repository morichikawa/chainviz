// mockOperationObserved の outcome/durationMs 生成（Issue #352）。
// `mockData.test.ts` の operationObserved 基本ケース（フィールドの存在）とは
// 別に、決定的なパターン（大半 ok・時々 error、3ms〜45ms の範囲）を固定する
// 回帰テストとして分離する（CLAUDE.md のテスト分割方針）。
//
// `mockOperationObserved` は呼び出し順を数えるモジュールレベルの通し番号を
// 持つため、このファイル内の他のテストの実行順・回数に依存しないよう、
// 個々のテストでは「連続してN回呼んだ結果の性質」だけを検証し、通し番号の
// 絶対値には依存しない。
import type { OperationEdge } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { mockOperationObserved } from "./mockData.js";

function observeMany(count: number): OperationEdge[] {
  const edges: OperationEdge[] = [];
  for (let i = 0; i < count; i++) {
    const event = mockOperationObserved("eth_sendRawTransaction");
    if (event.type !== "operationObserved") throw new Error("unexpected event type");
    edges.push(event.edge);
  }
  return edges;
}

describe("mockOperationObserved: outcome/durationMs (Issue #352)", () => {
  it("mostly produces 'ok', with 'error' appearing sometimes (7周期に1回)", () => {
    const edges = observeMany(21); // 7の倍数。少なくとも3回の周期を含む
    const outcomes = edges.map((edge) => edge.outcome);
    expect(outcomes.every((outcome) => outcome === "ok" || outcome === "error")).toBe(true);
    const errorCount = outcomes.filter((outcome) => outcome === "error").length;
    const okCount = outcomes.filter((outcome) => outcome === "ok").length;
    expect(errorCount).toBeGreaterThan(0);
    expect(okCount).toBeGreaterThan(errorCount); // 「大半はok」
  });

  it("keeps durationMs within a few-ms-to-a-few-tens-of-ms range (3ms〜45ms)", () => {
    const edges = observeMany(30);
    for (const edge of edges) {
      expect(edge.durationMs).toBeGreaterThanOrEqual(3);
      expect(edge.durationMs).toBeLessThanOrEqual(45);
      expect(Number.isInteger(edge.durationMs)).toBe(true);
    }
  });
});
