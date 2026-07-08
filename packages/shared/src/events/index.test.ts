import { describe, expect, it } from "vitest";
import type {
  NodeEntity,
  NodeLinkActivity,
  OperationEdge,
} from "../world-state/index.js";
import type { DiffEvent } from "./index.js";

describe("DiffEvent", () => {
  it("carries an OperationEdge in an operationObserved event", () => {
    const edge: OperationEdge = {
      kind: "operation",
      fromWorkbenchId: "workbench-alice",
      toNodeId: "node-1",
      operation: "sendRawTransaction",
      observedAt: 1_700_000_000_000,
    };
    const event: DiffEvent = { type: "operationObserved", edge };

    expect(event.type).toBe("operationObserved");
    expect(event.edge).toEqual(edge);
  });

  it("narrows operationObserved apart from edgeAdded by type", () => {
    const events: DiffEvent[] = [
      {
        type: "edgeAdded",
        edge: {
          kind: "peer",
          fromNodeId: "node-1",
          toNodeId: "node-2",
          networkId: "chainviz-net",
        },
      },
      {
        type: "operationObserved",
        edge: {
          kind: "operation",
          fromWorkbenchId: "workbench-alice",
          toNodeId: "node-1",
          operation: "call",
          observedAt: 1_700_000_000_000,
        },
      },
    ];

    // type による判別後、edge の型もそれぞれ PeerEdge / OperationEdge へ
    // 絞り込めること（コンパイル時の検証を兼ねる）。
    const summaries = events.map((event) => {
      switch (event.type) {
        case "edgeAdded":
          return `peer:${event.edge.networkId}`;
        case "operationObserved":
          return `operation:${event.edge.operation}@${event.edge.observedAt}`;
        default:
          return event.type;
      }
    });

    expect(summaries).toEqual([
      "peer:chainviz-net",
      "operation:call@1700000000000",
    ]);
  });

  it("carries a NodeLinkActivity in a nodeLinkActivity event (D層・揮発性)", () => {
    const activity: NodeLinkActivity = {
      fromNodeId: "beacon-1",
      toNodeId: "node-1",
      calls: [{ method: "engine_newPayload", count: 2 }],
      observedAt: 1_700_000_000_000,
    };
    const event: DiffEvent = { type: "nodeLinkActivity", activity };

    expect(event.type).toBe("nodeLinkActivity");
    expect(event.activity).toEqual(activity);
  });

  it("narrows nodeLinkActivity apart from operationObserved by type", () => {
    // どちらも揮発性の観測イベントだが、operationObserved は 1 回の呼び出し =
    // 1 イベント、nodeLinkActivity は観測間隔内の増分という粒度の違いがある。
    // type による判別でそれぞれのペイロードへ安全に絞り込めること
    // （コンパイル時の検証を兼ねる）。
    const events: DiffEvent[] = [
      {
        type: "operationObserved",
        edge: {
          kind: "operation",
          fromWorkbenchId: "workbench-alice",
          toNodeId: "node-1",
          operation: "call",
          observedAt: 1_700_000_000_000,
        },
      },
      {
        type: "nodeLinkActivity",
        activity: {
          fromNodeId: "beacon-1",
          toNodeId: "node-1",
          calls: [
            { method: "engine_newPayload", count: 1 },
            { method: "engine_forkchoiceUpdated", count: 2 },
          ],
          observedAt: 1_700_000_000_500,
        },
      },
    ];

    const summaries = events.map((event) => {
      switch (event.type) {
        case "operationObserved":
          return `operation:${event.edge.operation}`;
        case "nodeLinkActivity":
          return `link:${event.activity.calls
            .map((c) => `${c.method}x${c.count}`)
            .join(",")}`;
        default:
          return event.type;
      }
    });

    expect(summaries).toEqual([
      "operation:call",
      "link:engine_newPayloadx1,engine_forkchoiceUpdatedx2",
    ]);
  });

  it("does not collide with the entity/edge event kinds in an exhaustive switch", () => {
    // nodeLinkActivity の type 文字列が既存のイベント種別（entityAdded /
    // entityUpdated / entityRemoved / edgeAdded / edgeRemoved / operationObserved）
    // のどれとも衝突しないこと。全 7 種を 1 つの switch で網羅し、default 到達が
    // 無い（= 各分岐で never に絞り込める）ことをコンパイル時と実行時の両方で
    // 検証する。nodeLinkActivity 追加で共用体の網羅性が壊れていないことの確認。
    const events: DiffEvent[] = [
      {
        type: "entityAdded",
        entity: {
          kind: "node",
          id: "node-1",
          containerName: "chainviz-ethereum-reth1",
          ip: "172.28.1.1",
          ports: [8545],
          resources: { cpuPercent: 0, memMB: 0 },
          process: { name: "reth" },
          chainType: "ethereum",
          clientType: "reth",
          syncStatus: "synced",
          blockHeight: 100,
          headBlockHash: "0xabc",
        },
      },
      { type: "entityUpdated", id: "node-1", patch: { blockHeight: 101 } },
      { type: "entityRemoved", id: "node-1" },
      {
        type: "edgeAdded",
        edge: {
          kind: "peer",
          fromNodeId: "node-1",
          toNodeId: "node-2",
          networkId: "chainviz-net",
        },
      },
      {
        type: "edgeRemoved",
        fromNodeId: "node-1",
        toNodeId: "node-2",
        networkId: "chainviz-net",
      },
      {
        type: "operationObserved",
        edge: {
          kind: "operation",
          fromWorkbenchId: "workbench-alice",
          toNodeId: "node-1",
          operation: "call",
          observedAt: 1_700_000_000_000,
        },
      },
      {
        type: "nodeLinkActivity",
        activity: {
          fromNodeId: "beacon-1",
          toNodeId: "node-1",
          calls: [{ method: "engine_newPayload", count: 1 }],
          observedAt: 1_700_000_000_000,
        },
      },
    ];

    const kinds = events.map((event) => {
      switch (event.type) {
        case "entityAdded":
          return event.entity.kind;
        case "entityUpdated":
          return `patch:${event.id}`;
        case "entityRemoved":
          return `remove:${event.id}`;
        case "edgeAdded":
          return `peer:${event.edge.networkId}`;
        case "edgeRemoved":
          return `unpeer:${event.networkId}`;
        case "operationObserved":
          return `op:${event.edge.operation}`;
        case "nodeLinkActivity":
          return `link:${event.activity.toNodeId}`;
        default: {
          // 全 7 種を尽くしていれば event は never に絞られる。新しい type が
          // 増えてここに落ちるとコンパイルエラーになる（網羅性の番人）。
          const exhaustive: never = event;
          return exhaustive;
        }
      }
    });

    expect(kinds).toEqual([
      "node",
      "patch:node-1",
      "remove:node-1",
      "peer:chainviz-net",
      "unpeer:chainviz-net",
      "op:call",
      "link:node-1",
    ]);
  });

  it("carries a NodeEntity internals patch in an entityUpdated event (D層の store 反映)", () => {
    // D層の内部状態は store のパッチ（applyNodeInternals）経由で
    // entityUpdated として配信される（nodeLinkActivity は揮発性で別経路）。
    // Partial<WorldStateEntity> のパッチに internals / drivesNodeId を載せられ、
    // JSON 往復で保持されることを確認する（NodeEntity 由来のフィールドが
    // 差分パッチの型に含まれること）。
    const patch: Partial<NodeEntity> = {
      internals: {
        syncStages: [{ stage: "Execution", checkpoint: 118 }],
        mempool: { pending: 0, queued: 0 },
      },
      drivesNodeId: "node-1",
    };
    const event: DiffEvent = {
      type: "entityUpdated",
      id: "beacon-1",
      patch,
    };
    const roundTripped = JSON.parse(JSON.stringify(event)) as DiffEvent;
    expect(roundTripped.type).toBe("entityUpdated");
    if (roundTripped.type === "entityUpdated") {
      const p = roundTripped.patch as Partial<NodeEntity>;
      expect(p.internals?.syncStages?.[0].checkpoint).toBe(118);
      expect(p.internals?.mempool).toEqual({ pending: 0, queued: 0 });
      expect(p.drivesNodeId).toBe("node-1");
    }
  });
});
