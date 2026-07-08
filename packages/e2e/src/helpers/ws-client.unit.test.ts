// ws-client.ts の純粋ロジック（nodeLinkActivity の抽出。D層・Issue #191）の
// ユニットテスト。docker/collector には一切依存しないため
// vitest.unit.config.ts 側（pnpm test）で回る。CollectorTestClient 本体（実際の
// WebSocket 接続・畳み込み）は d-layer.test.ts 等の e2e テストで検証する。

import type { DiffEvent, NodeLinkActivity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { extractNodeLinkActivities } from "./ws-client.js";

function activity(overrides: Partial<NodeLinkActivity> = {}): NodeLinkActivity {
  return {
    fromNodeId: "chainviz-ethereum/beacon1",
    toNodeId: "chainviz-ethereum/reth1",
    calls: [{ method: "engine_newPayloadV3", count: 1 }],
    observedAt: 1_000,
    ...overrides,
  };
}

describe("extractNodeLinkActivities", () => {
  it("空配列からは空配列を返す", () => {
    expect(extractNodeLinkActivities([])).toEqual([]);
  });

  it("nodeLinkActivity 以外のイベントは無視する", () => {
    const events: DiffEvent[] = [
      { type: "entityRemoved", id: "x" },
      { type: "edgeRemoved", fromNodeId: "a", toNodeId: "b", networkId: "n" },
    ];
    expect(extractNodeLinkActivities(events)).toEqual([]);
  });

  it("nodeLinkActivity だけを順序を保って抜き出す", () => {
    const a1 = activity({ observedAt: 1_000 });
    const a2 = activity({ observedAt: 2_000, toNodeId: "chainviz-ethereum/reth2" });
    const events: DiffEvent[] = [
      { type: "entityAdded", entity: { kind: "node", id: "n" } as never },
      { type: "nodeLinkActivity", activity: a1 },
      { type: "operationObserved", edge: { kind: "operation" } as never },
      { type: "nodeLinkActivity", activity: a2 },
    ];
    expect(extractNodeLinkActivities(events)).toEqual([a1, a2]);
  });

  it("複数呼び出し種別を持つ calls をそのまま保持する（増分ゼロの種類は呼び出し側が既に除外している前提）", () => {
    const a = activity({
      calls: [
        { method: "engine_newPayloadV3", count: 3, latencyMs: 12 },
        { method: "engine_forkchoiceUpdatedV3", count: 1 },
      ],
    });
    const [result] = extractNodeLinkActivities([
      { type: "nodeLinkActivity", activity: a },
    ]);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]).toEqual({
      method: "engine_newPayloadV3",
      count: 3,
      latencyMs: 12,
    });
  });

  it("連続する複数の nodeLinkActivity をすべて順序どおり蓄積する", () => {
    // CollectorTestClient は 1 つの diff メッセージに複数の nodeLinkActivity が
    // 含まれるケース（複数ポーリング分がまとめて届く等）を linkActivities へ
    // 追記して扱う。連続イベントが取りこぼされないことを保証する。
    const inputs = [
      activity({ observedAt: 1_000 }),
      activity({ observedAt: 2_000 }),
      activity({ observedAt: 3_000, toNodeId: "chainviz-ethereum/reth2" }),
      activity({ observedAt: 4_000 }),
    ];
    const result = extractNodeLinkActivities(
      inputs.map((a) => ({ type: "nodeLinkActivity", activity: a })),
    );
    expect(result).toEqual(inputs);
  });

  it("entityUpdated / edgeAdded / edgeRemoved / operationObserved が混在しても正しく抽出する", () => {
    const a1 = activity({ observedAt: 1_000 });
    const a2 = activity({ observedAt: 2_000, toNodeId: "chainviz-ethereum/reth2" });
    const events: DiffEvent[] = [
      { type: "entityUpdated", id: "chainviz-ethereum/reth1", patch: {} },
      { type: "nodeLinkActivity", activity: a1 },
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "a", toNodeId: "b", networkId: "1" },
      },
      { type: "operationObserved", edge: { kind: "operation" } as never },
      { type: "nodeLinkActivity", activity: a2 },
      { type: "edgeRemoved", fromNodeId: "a", toNodeId: "b", networkId: "1" },
      { type: "entityRemoved", id: "x" },
    ];
    expect(extractNodeLinkActivities(events)).toEqual([a1, a2]);
  });

  it("calls が空配列の nodeLinkActivity もフィルタせずそのまま通す（フィルタは配信側の責務）", () => {
    // extractNodeLinkActivities は type だけで判定し calls の中身では絞らない。
    // 「増分ゼロの種類は載せない」契約は collector 側で保証される前提であり、
    // このテストクライアントは受信したものをそのまま蓄積する。
    const empty = activity({ calls: [] });
    expect(
      extractNodeLinkActivities([{ type: "nodeLinkActivity", activity: empty }]),
    ).toEqual([empty]);
  });

  it("未知の type を持つ不正なイベントが混ざっても無視して落ちない", () => {
    // 将来の互換性・破損フレームへの耐性: 想定外の type 文字列や必須
    // フィールドを欠いたイベントが来ても、nodeLinkActivity のみを拾い、
    // 例外を投げない。
    const a = activity();
    const events = [
      { type: "someFutureEvent", foo: 1 },
      { type: "nodeLinkActivity", activity: a },
      { type: undefined },
      {},
    ] as unknown as DiffEvent[];
    expect(extractNodeLinkActivities(events)).toEqual([a]);
  });

  it("抽出結果は activity オブジェクトの参照をそのまま保持する（複製しない）", () => {
    // CollectorTestClient は抽出結果を linkActivities へ push して受信履歴と
    // するため、抽出が activity を複製せず同一参照を返すことに依存する
    // （余計なコピーで別物になると getLinkActivities の同一性検証がぶれる）。
    const a = activity();
    const [result] = extractNodeLinkActivities([
      { type: "nodeLinkActivity", activity: a },
    ]);
    expect(result).toBe(a);
  });

  it("入力のイベント配列を変更しない", () => {
    const a = activity();
    const events: DiffEvent[] = [
      { type: "entityRemoved", id: "x" },
      { type: "nodeLinkActivity", activity: a },
    ];
    const snapshot = [...events];
    extractNodeLinkActivities(events);
    expect(events).toEqual(snapshot);
    expect(events).toHaveLength(2);
  });
});
