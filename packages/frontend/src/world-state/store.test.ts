import type {
  NodeEntity,
  OperationEdge,
  WalletEntity,
  WorkbenchEntity,
  WorldStateSnapshot,
} from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  applyDiff,
  applySnapshot,
  emptyWorldState,
  entityId,
  extractOperations,
  listEdges,
  listEntities,
} from "./store.js";

function node(id: string, overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id,
    containerName: `container-${id}`,
    ip: "172.20.0.2",
    ports: [8545],
    resources: { cpuPercent: 1, memMB: 100 },
    process: { name: "reth node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 10,
    headBlockHash: "0xabc",
    ...overrides,
  };
}

function workbench(id: string): WorkbenchEntity {
  return {
    kind: "workbench",
    id,
    containerName: `wb-${id}`,
    ip: "172.20.0.9",
    ports: [],
    resources: { cpuPercent: 0.5, memMB: 50 },
    process: { name: "sh" },
    label: "Alice",
    walletIds: ["0xwallet"],
  };
}

function wallet(address: string): WalletEntity {
  return {
    kind: "wallet",
    address,
    chainType: "ethereum",
    balance: "1000",
    nonce: 0,
    isSmartAccount: false,
    ownerWorkbenchId: "wb-1",
    recentTxHashes: [],
  };
}

describe("entityId", () => {
  it("uses id for infra entities", () => {
    expect(entityId(node("n1"))).toBe("n1");
    expect(entityId(workbench("wb-1"))).toBe("wb-1");
  });

  it("uses natural keys for chain-state entities", () => {
    expect(entityId(wallet("0xabc"))).toBe("0xabc");
    expect(
      entityId({
        kind: "block",
        hash: "0xblock",
        number: 1,
        parentHash: "0x0",
        timestamp: 0,
        receivedAt: {},
      }),
    ).toBe("0xblock");
  });
});

describe("applySnapshot", () => {
  it("indexes entities by stable id and copies edges", () => {
    const snapshot: WorldStateSnapshot = {
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1"), node("n2"), workbench("wb-1")],
      edges: [{ kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" }],
    };
    const state = applySnapshot(snapshot);
    expect(Object.keys(state.entities).sort()).toEqual(["n1", "n2", "wb-1"]);
    expect(state.edges).toHaveLength(1);
    // 元スナップショットの配列を共有していないこと。
    expect(state.edges).not.toBe(snapshot.edges);
  });

  it("preserves optional p2pRole and rpcTargetNodeId fields", () => {
    // Issue #123 / #124: 新しい optional フィールドがスナップショット取り込みで
    // 欠落しないこと。省略されたエンティティは undefined のまま安全に残る。
    const snapshot: WorldStateSnapshot = {
      chainType: "ethereum",
      timestamp: 1,
      entities: [
        node("boot", { p2pRole: "bootnode" }),
        node("legacy"),
        {
          ...workbench("wb-1"),
          rpcTargetNodeId: "boot",
        },
      ],
      edges: [],
    };
    const state = applySnapshot(snapshot);
    expect((state.entities.boot as NodeEntity).p2pRole).toBe("bootnode");
    expect((state.entities.legacy as NodeEntity).p2pRole).toBeUndefined();
    expect((state.entities["wb-1"] as WorkbenchEntity).rpcTargetNodeId).toBe(
      "boot",
    );
  });

  it("later entity with same id wins", () => {
    const snapshot: WorldStateSnapshot = {
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1", { blockHeight: 1 }), node("n1", { blockHeight: 5 })],
      edges: [],
    };
    const state = applySnapshot(snapshot);
    expect((state.entities.n1 as NodeEntity).blockHeight).toBe(5);
  });
});

describe("applyDiff", () => {
  it("returns the same reference for an empty event list", () => {
    const state = applySnapshot({
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1")],
      edges: [],
    });
    expect(applyDiff(state, [])).toBe(state);
  });

  it("adds, updates and removes entities without mutating the input", () => {
    const state = applySnapshot({
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1", { blockHeight: 1 })],
      edges: [],
    });
    const next = applyDiff(state, [
      { type: "entityAdded", entity: node("n2") },
      { type: "entityUpdated", id: "n1", patch: { blockHeight: 42 } },
    ]);
    expect((next.entities.n1 as NodeEntity).blockHeight).toBe(42);
    expect(next.entities.n2).toBeDefined();
    // 入力は不変。
    expect((state.entities.n1 as NodeEntity).blockHeight).toBe(1);
    expect(state.entities.n2).toBeUndefined();

    const removed = applyDiff(next, [{ type: "entityRemoved", id: "n2" }]);
    expect(removed.entities.n2).toBeUndefined();
    expect(next.entities.n2).toBeDefined();
  });

  it("does not resurrect an entity removed earlier in the same batch", () => {
    // ARCHITECTURE.md §2: entityRemoved の後に同一 id の entityUpdated が来ても
    // 復活させない（存在しない id への update は無視）。
    const state = applySnapshot({
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1", { blockHeight: 1 })],
      edges: [],
    });
    const next = applyDiff(state, [
      { type: "entityRemoved", id: "n1" },
      { type: "entityUpdated", id: "n1", patch: { blockHeight: 99 } },
    ]);
    expect(next.entities.n1).toBeUndefined();
  });

  it("applies add then update within the same batch", () => {
    const next = applyDiff(emptyWorldState, [
      { type: "entityAdded", entity: node("n1", { blockHeight: 1 }) },
      { type: "entityUpdated", id: "n1", patch: { blockHeight: 7 } },
    ]);
    expect((next.entities.n1 as NodeEntity).blockHeight).toBe(7);
  });

  it("applies add then remove within the same batch", () => {
    const next = applyDiff(emptyWorldState, [
      { type: "entityAdded", entity: node("n1") },
      { type: "entityRemoved", id: "n1" },
    ]);
    expect(next.entities.n1).toBeUndefined();
  });

  it("merges successive patches and preserves untouched fields", () => {
    const state = applySnapshot({
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1", { blockHeight: 1, syncStatus: "syncing" })],
      edges: [],
    });
    const next = applyDiff(state, [
      { type: "entityUpdated", id: "n1", patch: { blockHeight: 5 } },
      { type: "entityUpdated", id: "n1", patch: { syncStatus: "synced" } },
    ]);
    const n1 = next.entities.n1 as NodeEntity;
    expect(n1.blockHeight).toBe(5);
    expect(n1.syncStatus).toBe("synced");
    // patch に含めなかったフィールドは維持される。
    expect(n1.clientType).toBe("reth");
  });

  it("merges a p2pRole patch without clobbering other node fields", () => {
    // Issue #123 / #124: 役割が後から判明した場合の entityUpdated。既存の
    // blockHeight などは patch に含まれないので維持される。
    const state = applySnapshot({
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1", { blockHeight: 5 })],
      edges: [],
    });
    const next = applyDiff(state, [
      { type: "entityUpdated", id: "n1", patch: { p2pRole: "bootnode" } },
    ]);
    const n1 = next.entities.n1 as NodeEntity;
    expect(n1.p2pRole).toBe("bootnode");
    expect(n1.blockHeight).toBe(5);
    expect(n1.clientType).toBe("reth");
    // 入力は不変。
    expect((state.entities.n1 as NodeEntity).p2pRole).toBeUndefined();
  });

  it("keeps a wallet and nulls its owner via entityUpdated (workbench removal case)", () => {
    // ARCHITECTURE.md §2: ワークベンチ削除時、ウォレットは消さず
    // ownerWorkbenchId を null に更新する。
    const state = applySnapshot({
      chainType: "ethereum",
      timestamp: 1,
      entities: [wallet("0xabc")],
      edges: [],
    });
    const next = applyDiff(state, [
      { type: "entityUpdated", id: "0xabc", patch: { ownerWorkbenchId: null } },
    ]);
    const w = next.entities["0xabc"] as WalletEntity;
    expect(w).toBeDefined();
    expect(w.ownerWorkbenchId).toBeNull();
  });

  it("entityAdded overwrites an existing entity with the same id", () => {
    const state = applySnapshot({
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1", { blockHeight: 1 })],
      edges: [],
    });
    const next = applyDiff(state, [
      { type: "entityAdded", entity: node("n1", { blockHeight: 50 }) },
    ]);
    expect((next.entities.n1 as NodeEntity).blockHeight).toBe(50);
    expect(Object.keys(next.entities)).toEqual(["n1"]);
  });

  it("removing from an empty store does not throw", () => {
    expect(() =>
      applyDiff(emptyWorldState, [{ type: "entityRemoved", id: "ghost" }]),
    ).not.toThrow();
  });

  it("ignores updates and removes for unknown ids", () => {
    const state = applySnapshot({
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1")],
      edges: [],
    });
    const next = applyDiff(state, [
      { type: "entityUpdated", id: "ghost", patch: { blockHeight: 99 } },
      { type: "entityRemoved", id: "ghost" },
    ]);
    expect(Object.keys(next.entities)).toEqual(["n1"]);
  });

  it("dedupes edgeAdded and removes edges", () => {
    const edge = {
      kind: "peer" as const,
      fromNodeId: "n1",
      toNodeId: "n2",
      networkId: "1",
    };
    const state = { entities: {}, edges: [] };
    const added = applyDiff(state, [
      { type: "edgeAdded", edge },
      { type: "edgeAdded", edge },
    ]);
    expect(added.edges).toHaveLength(1);

    const removed = applyDiff(added, [
      { type: "edgeRemoved", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
    ]);
    expect(removed.edges).toHaveLength(0);
  });

  it("removes only the matching edge and keeps the rest", () => {
    const state = {
      entities: {},
      edges: [
        { kind: "peer" as const, fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
        { kind: "peer" as const, fromNodeId: "n2", toNodeId: "n3", networkId: "1" },
      ],
    };
    const next = applyDiff(state, [
      { type: "edgeRemoved", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
    ]);
    expect(next.edges).toEqual([
      { kind: "peer", fromNodeId: "n2", toNodeId: "n3", networkId: "1" },
    ]);
  });

  it("treats the reverse direction as a distinct edge", () => {
    const forward = {
      kind: "peer" as const,
      fromNodeId: "n1",
      toNodeId: "n2",
      networkId: "1",
    };
    const reverse = {
      kind: "peer" as const,
      fromNodeId: "n2",
      toNodeId: "n1",
      networkId: "1",
    };
    const next = applyDiff(
      { entities: {}, edges: [] },
      [
        { type: "edgeAdded", edge: forward },
        { type: "edgeAdded", edge: reverse },
      ],
    );
    expect(next.edges).toHaveLength(2);
  });

  it("keeps the same edges reference when edgeRemoved matches nothing", () => {
    const state = {
      entities: {},
      edges: [
        {
          kind: "peer" as const,
          fromNodeId: "n1",
          toNodeId: "n2",
          networkId: "1",
        },
      ],
    };
    const next = applyDiff(state, [
      { type: "edgeRemoved", fromNodeId: "x", toNodeId: "y", networkId: "1" },
    ]);
    expect(next.edges).toBe(state.edges);
  });

  it("does not mutate the input edges array when adding an edge", () => {
    const state = {
      entities: {},
      edges: [
        { kind: "peer" as const, fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      ],
    };
    const next = applyDiff(state, [
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "n2", toNodeId: "n3", networkId: "1" },
      },
    ]);
    // 入力配列は不変で、返り値は新しい配列。
    expect(state.edges).toHaveLength(1);
    expect(next.edges).toHaveLength(2);
    expect(next.edges).not.toBe(state.edges);
  });

  it("does not remove an edge when edgeRemoved gives the reverse direction", () => {
    // 差分は向き付きで届く前提。edgeRemoved は from/to をそのまま照合するため
    // 逆向き指定では一致しない。
    const state = {
      entities: {},
      edges: [
        { kind: "peer" as const, fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      ],
    };
    const next = applyDiff(state, [
      { type: "edgeRemoved", fromNodeId: "n2", toNodeId: "n1", networkId: "1" },
    ]);
    expect(next.edges).toHaveLength(1);
    expect(next.edges).toBe(state.edges);
  });

  it("edgeRemoved removes only the edge on the matching network", () => {
    // エッジの同一性キーは from/to/networkId の3つ組（ARCHITECTURE.md §2）。
    // 同一ノードペアが複数ネットワークでピア接続していても、指定した
    // networkId のエッジだけが消える。
    const state = {
      entities: {},
      edges: [
        { kind: "peer" as const, fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
        { kind: "peer" as const, fromNodeId: "n1", toNodeId: "n2", networkId: "2" },
      ],
    };
    const next = applyDiff(state, [
      { type: "edgeRemoved", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
    ]);
    expect(next.edges).toEqual([
      { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "2" },
    ]);
  });

  it("keeps the same edges reference when edgeRemoved names a different networkId", () => {
    // ペアは一致しても networkId が違えば別エッジなので何も消えない。
    const state = {
      entities: {},
      edges: [
        { kind: "peer" as const, fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      ],
    };
    const next = applyDiff(state, [
      { type: "edgeRemoved", fromNodeId: "n1", toNodeId: "n2", networkId: "9" },
    ]);
    expect(next.edges).toBe(state.edges);
  });

  it("edgeAdded keeps same-pair edges on different networks as distinct edges", () => {
    // 重複判定も from/to/networkId の3つ組で行うため、networkId 違いの
    // 同一ペアは両方保持される。描画側 peerEdgesToFlowEdges が networkId
    // 違いを別の紐として2本描く設計と整合する。
    const state = { entities: {}, edges: [] };
    const next = applyDiff(state, [
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      },
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "2" },
      },
    ]);
    expect(next.edges).toHaveLength(2);
    expect(next.edges.map((e) => e.networkId).sort()).toEqual(["1", "2"]);
  });

  it("applies edge and entity events together in one batch", () => {
    const next = applyDiff(emptyWorldState, [
      { type: "entityAdded", entity: node("n1") },
      { type: "entityAdded", entity: node("n2") },
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      },
    ]);
    expect(Object.keys(next.entities).sort()).toEqual(["n1", "n2"]);
    expect(next.edges).toHaveLength(1);
  });

  it("removes an edge added in a previous batch", () => {
    const added = applyDiff(emptyWorldState, [
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      },
    ]);
    const removed = applyDiff(added, [
      { type: "edgeRemoved", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
    ]);
    expect(removed.edges).toHaveLength(0);
  });
});

describe("listEntities", () => {
  it("returns all entities of an empty and non-empty store", () => {
    expect(listEntities(emptyWorldState)).toEqual([]);
    const state = applySnapshot({
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1"), workbench("wb-1")],
      edges: [],
    });
    expect(listEntities(state)).toHaveLength(2);
  });
});

describe("listEdges", () => {
  it("returns an empty array for a store without edges", () => {
    expect(listEdges(emptyWorldState)).toEqual([]);
  });

  it("returns the peer edges held in the store", () => {
    const state = applySnapshot({
      chainType: "ethereum",
      timestamp: 1,
      entities: [node("n1"), node("n2")],
      edges: [{ kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" }],
    });
    expect(listEdges(state)).toEqual([
      { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
    ]);
  });

  it("reflects edges added via a diff", () => {
    const state = applyDiff(emptyWorldState, [
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      },
    ]);
    expect(listEdges(state)).toHaveLength(1);
  });

  it("returns an empty array again after the last edge is removed", () => {
    const added = applyDiff(emptyWorldState, [
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      },
    ]);
    const removed = applyDiff(added, [
      { type: "edgeRemoved", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
    ]);
    expect(listEdges(removed)).toEqual([]);
  });
});

describe("operationObserved (volatile, not folded into world state)", () => {
  const opEdge: OperationEdge = {
    kind: "operation",
    fromWorkbenchId: "workbench-alice",
    toNodeId: "reth-node-1",
    operation: "eth_sendRawTransaction",
    observedAt: 1_000,
  };

  it("applyDiff ignores operationObserved (no entities/edges added)", () => {
    const next = applyDiff(emptyWorldState, [
      { type: "operationObserved", edge: opEdge },
    ]);
    expect(listEntities(next)).toEqual([]);
    expect(listEdges(next)).toEqual([]);
  });

  it("extractOperations pulls out only operationObserved edges", () => {
    const ops = extractOperations([
      { type: "entityAdded", entity: node("n1") },
      { type: "operationObserved", edge: opEdge },
      { type: "operationObserved", edge: { ...opEdge, operation: "eth_call" } },
    ]);
    expect(ops).toEqual([opEdge, { ...opEdge, operation: "eth_call" }]);
  });

  it("extractOperations returns an empty array when there are none", () => {
    expect(
      extractOperations([{ type: "entityRemoved", id: "n1" }]),
    ).toEqual([]);
  });

  it("extractOperations returns an empty array for an empty event list", () => {
    expect(extractOperations([])).toEqual([]);
  });

  it("extractOperations does not pick up any non-operation DiffEvent kind", () => {
    // entityAdded / entityUpdated / entityRemoved / edgeAdded / edgeRemoved は
    // 操作イベントではないので一切拾わない。
    const ops = extractOperations([
      { type: "entityAdded", entity: node("n1") },
      { type: "entityUpdated", id: "n1", patch: { blockHeight: 9 } },
      { type: "entityRemoved", id: "n1" },
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      },
      { type: "edgeRemoved", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
    ]);
    expect(ops).toEqual([]);
  });

  it("extractOperations preserves order and count with interleaved events", () => {
    const op1 = opEdge;
    const op2: OperationEdge = { ...opEdge, operation: "eth_call" };
    const op3: OperationEdge = { ...opEdge, toNodeId: "reth-node-2" };
    const ops = extractOperations([
      { type: "operationObserved", edge: op1 },
      { type: "entityAdded", entity: node("n1") },
      { type: "operationObserved", edge: op2 },
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      },
      { type: "operationObserved", edge: op3 },
    ]);
    expect(ops).toEqual([op1, op2, op3]);
  });

  it("applyDiff ignores operationObserved even when mixed with real state changes", () => {
    const next = applyDiff(emptyWorldState, [
      { type: "entityAdded", entity: node("n1") },
      { type: "operationObserved", edge: opEdge },
      {
        type: "edgeAdded",
        edge: { kind: "peer", fromNodeId: "n1", toNodeId: "n2", networkId: "1" },
      },
    ]);
    // entity / edge は反映されるが、operationObserved は畳み込まれない。
    expect(Object.keys(next.entities)).toEqual(["n1"]);
    expect(next.edges).toHaveLength(1);
  });
});
