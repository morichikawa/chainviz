import type {
  NodeEntity,
  PeerEdge,
  WalletEntity,
  WorkbenchEntity,
} from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  computeDiff,
  computeEdgeDiff,
  computeWalletDiff,
  edgeKey,
  entityId,
  type WalletObservation,
} from "./diff.js";

function wallet(overrides: Partial<WalletEntity> = {}): WalletEntity {
  return {
    kind: "wallet",
    address: "0xabc",
    chainType: "ethereum",
    balance: "100",
    nonce: 1,
    isSmartAccount: false,
    ownerWorkbenchId: "chainviz-ethereum/workbench",
    recentTxHashes: [],
    ...overrides,
  };
}

function node(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "chainviz-ethereum/reth1",
    containerName: "reth1",
    ip: "172.28.1.1",
    ports: [8545],
    resources: { cpuPercent: 10, memMB: 100 },
    process: { name: "reth" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "syncing",
    blockHeight: 0,
    headBlockHash: "",
    ...overrides,
  };
}

function workbench(overrides: Partial<WorkbenchEntity> = {}): WorkbenchEntity {
  return {
    kind: "workbench",
    id: "chainviz-ethereum/workbench",
    containerName: "workbench",
    ip: "172.28.3.1",
    ports: [],
    resources: { cpuPercent: 0, memMB: 5 },
    process: { name: "sh" },
    label: "workbench",
    walletIds: [],
    ...overrides,
  };
}

describe("entityId", () => {
  it("uses id for infra entities", () => {
    expect(entityId(node())).toBe("chainviz-ethereum/reth1");
    expect(entityId(workbench())).toBe("chainviz-ethereum/workbench");
  });

  it("uses address for wallet and contract", () => {
    expect(
      entityId({
        kind: "wallet",
        address: "0xabc",
        chainType: "ethereum",
        balance: "0",
        nonce: 0,
        isSmartAccount: false,
        ownerWorkbenchId: null,
        recentTxHashes: [],
      }),
    ).toBe("0xabc");
  });

  it("uses hash for block and transaction", () => {
    expect(
      entityId({
        kind: "block",
        hash: "0xdead",
        number: 1,
        parentHash: "0x0",
        timestamp: 0,
        receivedAt: {},
      }),
    ).toBe("0xdead");
  });
});

describe("computeDiff", () => {
  it("emits entityAdded for new entities", () => {
    const events = computeDiff([], [node()]);
    expect(events).toEqual([{ type: "entityAdded", entity: node() }]);
  });

  it("emits entityRemoved for entities that disappeared", () => {
    const events = computeDiff([node()], []);
    expect(events).toEqual([
      { type: "entityRemoved", id: "chainviz-ethereum/reth1" },
    ]);
  });

  it("emits no events when nothing changed", () => {
    const events = computeDiff([node()], [node()]);
    expect(events).toEqual([]);
  });

  it("emits entityUpdated with only the changed fields", () => {
    const before = node({ resources: { cpuPercent: 10, memMB: 100 } });
    const after = node({ resources: { cpuPercent: 55, memMB: 120 } });
    const events = computeDiff([before], [after]);
    expect(events).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { resources: { cpuPercent: 55, memMB: 120 } },
      },
    ]);
  });

  it("detects changes in nested arrays", () => {
    const before = node({ ports: [8545] });
    const after = node({ ports: [8545, 8546] });
    const events = computeDiff([before], [after]);
    expect(events).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { ports: [8545, 8546] },
      },
    ]);
  });

  it("handles a combination of add, update and remove in one pass", () => {
    const reth1 = node();
    const reth1Updated = node({ resources: { cpuPercent: 99, memMB: 100 } });
    const wb = workbench();
    const events = computeDiff([reth1, wb], [reth1Updated]);

    expect(events).toContainEqual({
      type: "entityUpdated",
      id: "chainviz-ethereum/reth1",
      patch: { resources: { cpuPercent: 99, memMB: 100 } },
    });
    expect(events).toContainEqual({
      type: "entityRemoved",
      id: "chainviz-ethereum/workbench",
    });
    expect(events).toHaveLength(2);
  });

  it("emits all add/update events before any remove event", () => {
    const keep = node();
    const keepUpdated = node({ resources: { cpuPercent: 42, memMB: 100 } });
    const gone = node({ id: "chainviz-ethereum/reth2" });
    const fresh = node({ id: "chainviz-ethereum/reth3" });

    const events = computeDiff([keep, gone], [keepUpdated, fresh]);
    const lastEvent = events[events.length - 1];
    expect(lastEvent?.type).toBe("entityRemoved");
    // remove は末尾にまとまる（add/update が先）
    const removeIndex = events.findIndex((e) => e.type === "entityRemoved");
    const nonRemoveAfter = events
      .slice(removeIndex)
      .some((e) => e.type !== "entityRemoved");
    expect(nonRemoveAfter).toBe(false);
  });

  it("returns no events for two empty inputs", () => {
    expect(computeDiff([], [])).toEqual([]);
  });

  it("collapses duplicate ids in next, keeping the last occurrence", () => {
    // 安定 ID が重複するケース（compose service ラベルの重複など）。
    // Map で後勝ちになり、1 エンティティとして 1 イベントに畳まれる。
    const first = node({ resources: { cpuPercent: 1, memMB: 1 } });
    const second = node({ resources: { cpuPercent: 2, memMB: 2 } });
    const events = computeDiff([], [first, second]);
    expect(events).toEqual([
      {
        type: "entityAdded",
        entity: node({ resources: { cpuPercent: 2, memMB: 2 } }),
      },
    ]);
  });

  it("collapses duplicate ids in prev into a single remove", () => {
    const dupA = node();
    const dupB = node({ resources: { cpuPercent: 9, memMB: 9 } });
    const events = computeDiff([dupA, dupB], []);
    expect(events).toEqual([
      { type: "entityRemoved", id: "chainviz-ethereum/reth1" },
    ]);
  });

  it("reports a full patch when many fields change at once", () => {
    const before = node();
    const after = node({
      ip: "10.0.0.9",
      ports: [8545, 8546],
      syncStatus: "synced",
      blockHeight: 128,
      headBlockHash: "0xabc",
    });
    const events = computeDiff([before], [after]);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.type).toBe("entityUpdated");
    if (event.type === "entityUpdated") {
      expect(event.patch).toEqual({
        ip: "10.0.0.9",
        ports: [8545, 8546],
        syncStatus: "synced",
        blockHeight: 128,
        headBlockHash: "0xabc",
      });
    }
  });

  it("distinguishes entities that differ only by kind-specific keys", () => {
    const before = workbench({ label: "Alice" });
    const after = workbench({ label: "Bob" });
    const events = computeDiff([before], [after]);
    expect(events).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/workbench",
        patch: { label: "Bob" },
      },
    ]);
  });

  it("carries p2pRole in the patch when a node's P2P role changes", () => {
    // Issue #123 / #124: peer から bootnode への遷移が更新差分に載ること。
    const before = node({ p2pRole: "peer" });
    const after = node({ p2pRole: "bootnode" });
    const events = computeDiff([before], [after]);
    expect(events).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { p2pRole: "bootnode" },
      },
    ]);
  });

  it("reports a newly appearing p2pRole (unknown -> bootnode) as a patch", () => {
    // 旧 collector が p2pRole 未付与で送っていたノードに、後から役割が
    // 判明した場合。省略 -> "bootnode" は差分として検出される。
    const before = node();
    const after = node({ p2pRole: "bootnode" });
    const events = computeDiff([before], [after]);
    expect(events).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { p2pRole: "bootnode" },
      },
    ]);
  });

  it("carries rpcTargetNodeId in the patch when the workbench's RPC target changes", () => {
    // Issue #123: 操作先ノードの解決結果が更新差分に載ること。
    const before = workbench({ rpcTargetNodeId: "chainviz-ethereum/reth1" });
    const after = workbench({ rpcTargetNodeId: "chainviz-ethereum/reth2" });
    const events = computeDiff([before], [after]);
    expect(events).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/workbench",
        patch: { rpcTargetNodeId: "chainviz-ethereum/reth2" },
      },
    ]);
  });

  it("does not emit a clearing patch when an optional field disappears (known limitation)", () => {
    // fieldPatch は after 側のキーだけを走査するため、before にあって after に
    // 無くなったフィールド（p2pRole を省略に戻す）は差分に現れない。この方針は
    // 全 optional フィールド共通で、store には旧値が残る。bootnode/peer は
    // 一度確定すると消えない運用のため実害は無いが、#123/#124 の実装で
    // 「役割の取り消し」を扱う場合はこの制約に留意する。
    const before = node({ p2pRole: "bootnode" });
    const after = node();
    const events = computeDiff([before], [after]);
    expect(events).toEqual([]);
  });
});

function edge(overrides: Partial<PeerEdge> = {}): PeerEdge {
  return {
    kind: "peer",
    fromNodeId: "p/beacon1",
    toNodeId: "p/beacon2",
    networkId: "p-consensus",
    ...overrides,
  };
}

describe("edgeKey", () => {
  it("combines from, to and networkId", () => {
    expect(edgeKey(edge())).toBe("p/beacon1|p/beacon2|p-consensus");
  });

  it("differs when networkId differs", () => {
    expect(edgeKey(edge())).not.toBe(edgeKey(edge({ networkId: "other" })));
  });
});

describe("computeEdgeDiff", () => {
  it("emits edgeAdded for new edges", () => {
    expect(computeEdgeDiff([], [edge()])).toEqual([
      { type: "edgeAdded", edge: edge() },
    ]);
  });

  it("emits edgeRemoved carrying the full edge key for edges that disappeared", () => {
    expect(computeEdgeDiff([edge()], [])).toEqual([
      {
        type: "edgeRemoved",
        fromNodeId: "p/beacon1",
        toNodeId: "p/beacon2",
        networkId: "p-consensus",
      },
    ]);
  });

  it("emits nothing when the edge set is unchanged", () => {
    expect(computeEdgeDiff([edge()], [edge()])).toEqual([]);
  });

  it("handles add and remove together in one pass", () => {
    const kept = edge();
    const gone = edge({ toNodeId: "p/beacon3" });
    const fresh = edge({ toNodeId: "p/beacon4" });
    const events = computeEdgeDiff([kept, gone], [kept, fresh]);
    expect(events).toContainEqual({ type: "edgeAdded", edge: fresh });
    expect(events).toContainEqual({
      type: "edgeRemoved",
      fromNodeId: "p/beacon1",
      toNodeId: "p/beacon3",
      networkId: "p-consensus",
    });
    expect(events).toHaveLength(2);
  });

  it("treats a networkId change as a remove plus add", () => {
    const before = edge({ networkId: "net-a" });
    const after = edge({ networkId: "net-b" });
    const events = computeEdgeDiff([before], [after]);
    expect(events).toContainEqual({ type: "edgeAdded", edge: after });
    expect(events).toContainEqual({
      type: "edgeRemoved",
      fromNodeId: "p/beacon1",
      toNodeId: "p/beacon2",
      networkId: "net-a",
    });
  });

  it("returns no events for two empty inputs", () => {
    expect(computeEdgeDiff([], [])).toEqual([]);
  });

  it("treats a from/to-swapped edge as a different edge (caller must normalize)", () => {
    // computeEdgeDiff は無向化しない。生成側（toPeerEdges）で from<=to に
    // 正規化する前提なので、逆順のエッジは別物として扱われる。
    const forward = edge({ fromNodeId: "p/beacon1", toNodeId: "p/beacon2" });
    const reversed = edge({ fromNodeId: "p/beacon2", toNodeId: "p/beacon1" });
    const events = computeEdgeDiff([forward], [reversed]);
    expect(events).toContainEqual({ type: "edgeAdded", edge: reversed });
    expect(events).toContainEqual({
      type: "edgeRemoved",
      fromNodeId: "p/beacon1",
      toNodeId: "p/beacon2",
      networkId: "p-consensus",
    });
    expect(events).toHaveLength(2);
  });

  it("collapses duplicate edges in the inputs via the edge key", () => {
    // 同一キーのエッジが重複していても Map で畳まれ、二重の add は出ない。
    expect(computeEdgeDiff([], [edge(), edge()])).toEqual([
      { type: "edgeAdded", edge: edge() },
    ]);
    expect(computeEdgeDiff([edge(), edge()], [edge()])).toEqual([]);
  });
});

describe("computeWalletDiff", () => {
  const observed = (
    overrides: Partial<WalletObservation> = {},
  ): WalletObservation => ({
    address: "0xabc",
    ownerWorkbenchId: "chainviz-ethereum/workbench",
    balance: "100",
    nonce: 1,
    ...overrides,
  });

  it("adds a new wallet when balance and nonce are available", () => {
    const events = computeWalletDiff([], [observed()], "ethereum");
    expect(events).toEqual([{ type: "entityAdded", entity: wallet() }]);
  });

  it("defers adding a new wallet while balance is not yet fetched", () => {
    // 残高がまだ取れていない新規ウォレットは、暫定の 0 を見せないよう追加を保留。
    const events = computeWalletDiff(
      [],
      [observed({ balance: undefined, nonce: undefined })],
      "ethereum",
    );
    expect(events).toEqual([]);
  });

  it("defers adding when only nonce is missing", () => {
    const events = computeWalletDiff(
      [],
      [observed({ nonce: undefined })],
      "ethereum",
    );
    expect(events).toEqual([]);
  });

  it("emits an update only for the changed fields", () => {
    const prev = [wallet({ balance: "100", nonce: 1 })];
    const events = computeWalletDiff(
      prev,
      [observed({ balance: "250", nonce: 2 })],
      "ethereum",
    );
    expect(events).toEqual([
      { type: "entityUpdated", id: "0xabc", patch: { balance: "250", nonce: 2 } },
    ]);
  });

  it("emits nothing when the wallet is unchanged", () => {
    const prev = [wallet({ balance: "100", nonce: 1 })];
    expect(computeWalletDiff(prev, [observed()], "ethereum")).toEqual([]);
  });

  it("keeps the existing balance/nonce when the observation omits them", () => {
    // RPC が一時的に取れなかったケース。既存値を維持し差分は出さない。
    const prev = [wallet({ balance: "100", nonce: 1 })];
    const events = computeWalletDiff(
      prev,
      [observed({ balance: undefined, nonce: undefined })],
      "ethereum",
    );
    expect(events).toEqual([]);
  });

  it("orphans a wallet (owner -> null) when its workbench disappears, not removes it", () => {
    const prev = [wallet({ ownerWorkbenchId: "chainviz-ethereum/workbench" })];
    const events = computeWalletDiff(prev, [], "ethereum");
    expect(events).toEqual([
      { type: "entityUpdated", id: "0xabc", patch: { ownerWorkbenchId: null } },
    ]);
    // 削除イベントは決して出さない（チェーン側の状態なので残す）。
    expect(events.some((e) => e.type === "entityRemoved")).toBe(false);
  });

  it("does not re-orphan an already orphaned wallet", () => {
    const prev = [wallet({ ownerWorkbenchId: null })];
    expect(computeWalletDiff(prev, [], "ethereum")).toEqual([]);
  });

  it("re-attaches an orphaned wallet when a workbench claims it again", () => {
    const prev = [wallet({ ownerWorkbenchId: null })];
    const events = computeWalletDiff(
      prev,
      [observed({ ownerWorkbenchId: "chainviz-ethereum/reborn" })],
      "ethereum",
    );
    expect(events).toEqual([
      {
        type: "entityUpdated",
        id: "0xabc",
        patch: { ownerWorkbenchId: "chainviz-ethereum/reborn" },
      },
    ]);
  });
});
