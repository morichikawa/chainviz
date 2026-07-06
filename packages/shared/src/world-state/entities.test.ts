import { describe, expect, it } from "vitest";
import type {
  NodeEntity,
  OperationEdge,
  PeerEdge,
  WalletEntity,
  WorkbenchEntity,
  WorldStateEdge,
  WorldStateSnapshot,
} from "./entities.js";

describe("world-state entities", () => {
  it("accepts a wallet with no owning workbench (deleted case)", () => {
    const wallet: WalletEntity = {
      kind: "wallet",
      address: "0x0000000000000000000000000000000000dEaD",
      chainType: "ethereum",
      balance: "0",
      nonce: 0,
      isSmartAccount: false,
      ownerWorkbenchId: null,
      recentTxHashes: [],
    };

    expect(wallet.ownerWorkbenchId).toBeNull();
  });

  it("builds an empty snapshot", () => {
    const snapshot: WorldStateSnapshot = {
      chainType: "ethereum",
      timestamp: Date.now(),
      entities: [],
      edges: [],
    };

    expect(snapshot.entities).toHaveLength(0);
  });

  it("marks an addNode-created node as removable", () => {
    const added: NodeEntity = {
      kind: "node",
      id: "node-3",
      containerName: "chainviz-node-3",
      ip: "172.28.1.3",
      ports: [8545],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "reth" },
      chainType: "ethereum",
      clientType: "reth",
      syncStatus: "syncing",
      blockHeight: 0,
      headBlockHash: "",
      removable: true,
    };

    expect(added.removable).toBe(true);
  });

  it("treats an entity without the removable flag as non-removable (omitted = false)", () => {
    // compose 起動時からある初期構成のコンテナ、またはフィールド追加前の
    // 旧スナップショット。省略は「削除不可」の安全側に倒す。
    const composeLaunched: WorkbenchEntity = {
      kind: "workbench",
      id: "workbench-1",
      containerName: "chainviz-workbench-1",
      ip: "172.28.3.1",
      ports: [],
      resources: { cpuPercent: 0, memMB: 0 },
      process: { name: "foundry" },
      label: "workbench",
      walletIds: [],
    };

    expect(composeLaunched.removable).toBeUndefined();
    expect(composeLaunched.removable ?? false).toBe(false);
  });

  it("represents a workbench-to-node call as an OperationEdge", () => {
    const edge: OperationEdge = {
      kind: "operation",
      fromWorkbenchId: "workbench-alice",
      toNodeId: "node-1",
      operation: "sendRawTransaction",
      observedAt: 1_700_000_000_000,
    };

    expect(edge.fromWorkbenchId).toBe("workbench-alice");
    expect(edge.toNodeId).toBe("node-1");
    expect(edge.operation).toBe("sendRawTransaction");
  });

  it("discriminates WorldStateEdge members by kind", () => {
    const peer: PeerEdge = {
      kind: "peer",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      networkId: "chainviz-net",
    };
    const operation: OperationEdge = {
      kind: "operation",
      fromWorkbenchId: "workbench-alice",
      toNodeId: "node-1",
      operation: "call",
      observedAt: 1_700_000_000_000,
    };
    const edges: WorldStateEdge[] = [peer, operation];

    const described = edges.map((edge) => {
      // kind による判別で各メンバーの固有フィールドへ安全に絞り込めること
      // （コンパイル時の検証を兼ねる）。
      switch (edge.kind) {
        case "peer":
          return `${edge.fromNodeId}->${edge.toNodeId}`;
        case "operation":
          return `${edge.fromWorkbenchId}->${edge.toNodeId}:${edge.operation}`;
      }
    });

    expect(described).toEqual([
      "node-1->node-2",
      "workbench-alice->node-1:call",
    ]);
  });
});
