import type {
  BlockEntity,
  ContractEntity,
  NodeEntity,
  PeerEdge,
  TransactionEntity,
  WorkbenchEntity,
} from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { WorldStateStore } from "./store.js";

function workbench(overrides: Partial<WorkbenchEntity> = {}): WorkbenchEntity {
  return {
    kind: "workbench",
    id: "chainviz-ethereum/workbench1",
    containerName: "workbench1",
    ip: "172.28.2.5",
    ports: [],
    resources: { cpuPercent: 1, memMB: 10 },
    process: { name: "workbench" },
    label: "workbench1",
    walletIds: [],
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

describe("WorldStateStore", () => {
  it("starts empty", () => {
    const store = new WorldStateStore("ethereum");
    const snapshot = store.getSnapshot();
    expect(snapshot.chainType).toBe("ethereum");
    expect(snapshot.entities).toEqual([]);
    expect(snapshot.edges).toEqual([]);
  });

  it("returns add events and reflects them in the snapshot on first poll", () => {
    const store = new WorldStateStore();
    const diff = store.applyInfra([node()]);
    expect(diff).toEqual([{ type: "entityAdded", entity: node() }]);
    expect(store.getSnapshot().entities).toEqual([node()]);
  });

  it("returns an empty diff when a poll brings no changes", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    const diff = store.applyInfra([node()]);
    expect(diff).toEqual([]);
  });

  it("applies updates by merging the patch into the stored entity", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    const diff = store.applyInfra([
      node({ resources: { cpuPercent: 80, memMB: 150 } }),
    ]);
    expect(diff).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { resources: { cpuPercent: 80, memMB: 150 } },
      },
    ]);
    const stored = store.getSnapshot().entities[0] as NodeEntity;
    expect(stored.resources).toEqual({ cpuPercent: 80, memMB: 150 });
    // 変化していないフィールドは保持される
    expect(stored.clientType).toBe("reth");
  });

  it("removes infra entities that are no longer observed", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    const diff = store.applyInfra([]);
    expect(diff).toEqual([
      { type: "entityRemoved", id: "chainviz-ethereum/reth1" },
    ]);
    expect(store.getSnapshot().entities).toEqual([]);
  });

  it("removes only the infra entity that disappeared, keeping the others", () => {
    const store = new WorldStateStore();
    const reth1 = node();
    const reth2 = node({
      id: "chainviz-ethereum/reth2",
      containerName: "reth2",
      ip: "172.28.1.2",
    });
    store.applyInfra([reth1, reth2]);
    const diff = store.applyInfra([reth2]);
    expect(diff).toEqual([
      { type: "entityRemoved", id: "chainviz-ethereum/reth1" },
    ]);
    const ids = store.getSnapshot().entities.map((e) => (e as NodeEntity).id);
    expect(ids).toEqual(["chainviz-ethereum/reth2"]);
  });

  it("advances the snapshot timestamp on apply", () => {
    const store = new WorldStateStore();
    const before = store.getSnapshot().timestamp;
    store.applyInfra([node()]);
    const after = store.getSnapshot().timestamp;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("re-adds (not updates) an entity that disappeared and came back", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]); // add
    const removeDiff = store.applyInfra([]); // remove
    expect(removeDiff).toEqual([
      { type: "entityRemoved", id: "chainviz-ethereum/reth1" },
    ]);
    expect(store.getSnapshot().entities).toEqual([]);

    // 同じ ID で戻ってきたら entityUpdated ではなく entityAdded になる
    const returned = node({ resources: { cpuPercent: 70, memMB: 200 } });
    const readdDiff = store.applyInfra([returned]);
    expect(readdDiff).toEqual([{ type: "entityAdded", entity: returned }]);
    expect(store.getSnapshot().entities).toEqual([returned]);
  });

  it("stores a single entity when a poll contains duplicate stable ids", () => {
    const store = new WorldStateStore();
    const diff = store.applyInfra([
      node({ resources: { cpuPercent: 1, memMB: 1 } }),
      node({ resources: { cpuPercent: 2, memMB: 2 } }),
    ]);
    // 重複は後勝ちで 1 件に畳まれる
    expect(diff).toHaveLength(1);
    const entities = store.getSnapshot().entities;
    expect(entities).toHaveLength(1);
    expect((entities[0] as NodeEntity).resources).toEqual({
      cpuPercent: 2,
      memMB: 2,
    });
  });

  it("accumulates successive updates across multiple polls", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    store.applyInfra([node({ syncStatus: "synced" })]);
    const diff = store.applyInfra([
      node({ syncStatus: "synced", blockHeight: 10 }),
    ]);
    // 2 回目の poll では syncStatus は変化していないため patch は blockHeight のみ
    expect(diff).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { blockHeight: 10 },
      },
    ]);
    const stored = store.getSnapshot().entities[0] as NodeEntity;
    expect(stored.syncStatus).toBe("synced");
    expect(stored.blockHeight).toBe(10);
  });

  it("does not mutate the snapshot array returned to callers", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    const snapshot = store.getSnapshot();
    snapshot.entities.push(node({ id: "injected" }));
    // 呼び出し側が返り値をいじっても内部状態は汚染されない
    expect(store.getSnapshot().entities).toHaveLength(1);
  });

  it("keeps p2pRole intact when an unrelated field is patched", () => {
    // Issue #123 / #124: bootnode として登録したノードのブロック高だけが
    // 更新されても、p2pRole は patch に含まれず既存値が保持される。
    const store = new WorldStateStore();
    store.applyInfra([node({ p2pRole: "bootnode" })]);
    const diff = store.applyInfra([
      node({ p2pRole: "bootnode", blockHeight: 42 }),
    ]);
    expect(diff).toEqual([
      {
        type: "entityUpdated",
        id: "chainviz-ethereum/reth1",
        patch: { blockHeight: 42 },
      },
    ]);
    const stored = store.getSnapshot().entities[0] as NodeEntity;
    expect(stored.p2pRole).toBe("bootnode");
    expect(stored.blockHeight).toBe(42);
  });

  it("carries p2pRole and rpcTargetNodeId through the snapshot unchanged", () => {
    const store = new WorldStateStore();
    store.applyInfra([
      node({ p2pRole: "peer" }),
      workbench({ rpcTargetNodeId: "chainviz-ethereum/reth1" }),
    ]);
    const snapshot = store.getSnapshot();
    const storedNode = snapshot.entities.find(
      (e) => e.kind === "node",
    ) as NodeEntity;
    const storedWorkbench = snapshot.entities.find(
      (e) => e.kind === "workbench",
    ) as WorkbenchEntity;
    expect(storedNode.p2pRole).toBe("peer");
    expect(storedWorkbench.rpcTargetNodeId).toBe("chainviz-ethereum/reth1");
  });

  it("emits an add for a second distinct node while keeping the first", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    const diff = store.applyInfra([
      node(),
      node({ id: "chainviz-ethereum/reth2", containerName: "reth2" }),
    ]);
    expect(diff).toEqual([
      {
        type: "entityAdded",
        entity: node({
          id: "chainviz-ethereum/reth2",
          containerName: "reth2",
        }),
      },
    ]);
    expect(store.getSnapshot().entities).toHaveLength(2);
  });
});

function edge(overrides: Partial<PeerEdge> = {}): PeerEdge {
  return {
    kind: "peer",
    fromNodeId: "chainviz-ethereum/beacon1",
    toNodeId: "chainviz-ethereum/beacon2",
    networkId: "chainviz-ethereum-consensus",
    ...overrides,
  };
}

describe("WorldStateStore.applyPeers", () => {
  it("adds a new edge and reflects it in the snapshot", () => {
    const store = new WorldStateStore();
    const diff = store.applyPeers([edge()]);
    expect(diff).toEqual([{ type: "edgeAdded", edge: edge() }]);
    expect(store.getSnapshot().edges).toEqual([edge()]);
  });

  it("emits no diff when the edge set is unchanged", () => {
    const store = new WorldStateStore();
    store.applyPeers([edge()]);
    expect(store.applyPeers([edge()])).toEqual([]);
    expect(store.getSnapshot().edges).toEqual([edge()]);
  });

  it("removes an edge that is no longer present", () => {
    const store = new WorldStateStore();
    store.applyPeers([edge()]);
    const diff = store.applyPeers([]);
    expect(diff).toEqual([
      {
        type: "edgeRemoved",
        fromNodeId: "chainviz-ethereum/beacon1",
        toNodeId: "chainviz-ethereum/beacon2",
        networkId: "chainviz-ethereum-consensus",
      },
    ]);
    expect(store.getSnapshot().edges).toEqual([]);
  });

  it("keeps edges separate from entities in the snapshot", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    store.applyPeers([edge()]);
    const snapshot = store.getSnapshot();
    expect(snapshot.entities).toHaveLength(1);
    expect(snapshot.edges).toHaveLength(1);
  });

  it("applies add and remove across a set of edges", () => {
    const store = new WorldStateStore();
    const e12 = edge();
    const e13 = edge({ toNodeId: "chainviz-ethereum/beacon3" });
    store.applyPeers([e12, e13]);
    const e14 = edge({ toNodeId: "chainviz-ethereum/beacon4" });
    const diff = store.applyPeers([e12, e14]);
    expect(diff).toContainEqual({ type: "edgeAdded", edge: e14 });
    expect(diff).toContainEqual({
      type: "edgeRemoved",
      fromNodeId: "chainviz-ethereum/beacon1",
      toNodeId: "chainviz-ethereum/beacon3",
      networkId: "chainviz-ethereum-consensus",
    });
    const edges = store.getSnapshot().edges;
    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual(e12);
    expect(edges).toContainEqual(e14);
  });

  it("keeps the new edge when the same pair changes networkId only", () => {
    // 退行防止: edgeRemoved が networkId を持たなかった頃、同一 from/to ペアで
    // networkId だけが変わる遷移により、追加直後の新エッジまで巻き込んで削除され
    // エッジが 0 本になっていた（tester 報告の再現手順）。
    const store = new WorldStateStore();
    store.applyPeers([edge({ networkId: "net-a" })]);
    const diff = store.applyPeers([edge({ networkId: "net-b" })]);
    expect(diff).toContainEqual({
      type: "edgeAdded",
      edge: edge({ networkId: "net-b" }),
    });
    expect(diff).toContainEqual({
      type: "edgeRemoved",
      fromNodeId: "chainviz-ethereum/beacon1",
      toNodeId: "chainviz-ethereum/beacon2",
      networkId: "net-a",
    });
    expect(store.getSnapshot().edges).toEqual([edge({ networkId: "net-b" })]);
  });

  it("does not let callers mutate the internal edge list via the snapshot", () => {
    const store = new WorldStateStore();
    store.applyPeers([edge()]);
    store.getSnapshot().edges.push(edge({ toNodeId: "injected" }));
    expect(store.getSnapshot().edges).toHaveLength(1);
  });
});

function block(overrides: Partial<BlockEntity> = {}): BlockEntity {
  return {
    kind: "block",
    hash: "0xblock1",
    number: 16,
    parentHash: "0xparent",
    timestamp: 100,
    receivedAt: {},
    ...overrides,
  };
}

describe("WorldStateStore.applyBlock", () => {
  it("adds a block entity on first receipt", () => {
    const store = new WorldStateStore();
    const b = block({ receivedAt: { "chainviz-ethereum/reth1": 1000 } });
    const diff = store.applyBlock(b);
    expect(diff).toEqual([{ type: "entityAdded", entity: b }]);
    expect(store.getSnapshot().entities).toContainEqual(b);
  });

  it("emits an update with only the changed receivedAt map on later receipts", () => {
    const store = new WorldStateStore();
    store.applyBlock(
      block({ receivedAt: { "chainviz-ethereum/reth1": 1000 } }),
    );
    const diff = store.applyBlock(
      block({
        receivedAt: {
          "chainviz-ethereum/reth1": 1000,
          "chainviz-ethereum/reth2": 1200,
        },
      }),
    );
    expect(diff).toEqual([
      {
        type: "entityUpdated",
        id: "0xblock1",
        patch: {
          receivedAt: {
            "chainviz-ethereum/reth1": 1000,
            "chainviz-ethereum/reth2": 1200,
          },
        },
      },
    ]);
  });

  it("does not disturb infra entities or edges", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    store.applyPeers([edge()]);
    store.applyBlock(block());
    const snapshot = store.getSnapshot();
    expect(snapshot.entities.filter((e) => e.kind === "node")).toHaveLength(1);
    expect(snapshot.entities.filter((e) => e.kind === "block")).toHaveLength(1);
    expect(snapshot.edges).toHaveLength(1);
  });

  it("tracks multiple distinct blocks", () => {
    const store = new WorldStateStore();
    store.applyBlock(block({ hash: "0xa", number: 1 }));
    store.applyBlock(block({ hash: "0xb", number: 2 }));
    const blocks = store
      .getSnapshot()
      .entities.filter((e) => e.kind === "block");
    expect(blocks).toHaveLength(2);
  });

  it("emits no diff when the same block is applied unchanged", () => {
    const store = new WorldStateStore();
    const b = block({ receivedAt: { "chainviz-ethereum/reth1": 1000 } });
    store.applyBlock(b);
    expect(store.applyBlock(b)).toEqual([]);
    expect(
      store.getSnapshot().entities.filter((e) => e.kind === "block"),
    ).toHaveLength(1);
  });

  it("accumulates receivedAt across three receipts, patching only that field", () => {
    const store = new WorldStateStore();
    store.applyBlock(block({ receivedAt: { a: 1000 } }));
    const second = store.applyBlock(
      block({ receivedAt: { a: 1000, b: 1100 } }),
    );
    expect(second).toEqual([
      {
        type: "entityUpdated",
        id: "0xblock1",
        patch: { receivedAt: { a: 1000, b: 1100 } },
      },
    ]);
    const third = store.applyBlock(
      block({ receivedAt: { a: 1000, b: 1100, c: 1200 } }),
    );
    expect(third).toEqual([
      {
        type: "entityUpdated",
        id: "0xblock1",
        patch: { receivedAt: { a: 1000, b: 1100, c: 1200 } },
      },
    ]);
    const stored = store
      .getSnapshot()
      .entities.find((e) => e.kind === "block") as BlockEntity;
    expect(stored.receivedAt).toEqual({ a: 1000, b: 1100, c: 1200 });
  });

  it("does not remove a block entity when peers churn to empty", () => {
    // applyPeers はエッジだけを触り、ブロックエンティティには影響しない。
    const store = new WorldStateStore();
    store.applyBlock(block());
    store.applyPeers([edge()]);
    store.applyPeers([]);
    expect(
      store.getSnapshot().entities.filter((e) => e.kind === "block"),
    ).toHaveLength(1);
  });

  describe("applyWallets", () => {
    const observation = {
      address: "0xabc",
      ownerWorkbenchId: "chainviz-ethereum/workbench",
      balance: "100",
      nonce: 1,
    };

    it("adds a wallet entity and reflects it in the snapshot", () => {
      const store = new WorldStateStore("ethereum");
      const diff = store.applyWallets([observation]);
      expect(diff).toHaveLength(1);
      const wallets = store
        .getSnapshot()
        .entities.filter((e) => e.kind === "wallet");
      expect(wallets).toEqual([
        {
          kind: "wallet",
          address: "0xabc",
          chainType: "ethereum",
          balance: "100",
          nonce: 1,
          isSmartAccount: false,
          ownerWorkbenchId: "chainviz-ethereum/workbench",
          recentTxHashes: [],
        },
      ]);
    });

    it("updates balance/nonce on a subsequent poll", () => {
      const store = new WorldStateStore();
      store.applyWallets([observation]);
      const diff = store.applyWallets([
        { ...observation, balance: "250", nonce: 2 },
      ]);
      expect(diff).toEqual([
        {
          type: "entityUpdated",
          id: "0xabc",
          patch: { balance: "250", nonce: 2 },
        },
      ]);
    });

    it("orphans the wallet (owner -> null) instead of removing it when the workbench is gone", () => {
      const store = new WorldStateStore();
      store.applyWallets([observation]);
      const diff = store.applyWallets([]);
      expect(diff).toEqual([
        {
          type: "entityUpdated",
          id: "0xabc",
          patch: { ownerWorkbenchId: null },
        },
      ]);
      const wallet = store
        .getSnapshot()
        .entities.find((e) => e.kind === "wallet");
      expect(wallet).toMatchObject({
        address: "0xabc",
        ownerWorkbenchId: null,
        balance: "100",
      });
    });

    it("does not touch node/workbench entities added by applyInfra", () => {
      const store = new WorldStateStore();
      store.applyInfra([node()]);
      store.applyWallets([observation]);
      // ウォレット観測が空でも、ノードは applyWallets では消えない。
      store.applyWallets([]);
      expect(
        store.getSnapshot().entities.filter((e) => e.kind === "node"),
      ).toHaveLength(1);
    });
  });
});

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0xtx1",
    from: "0xsender",
    to: "0xrecipient",
    status: "pending",
    ...overrides,
  };
}

describe("WorldStateStore.applyTransaction", () => {
  it("adds a pending tx on first receipt", () => {
    const store = new WorldStateStore();
    const diff = store.applyTransaction(tx());
    expect(diff).toEqual([{ type: "entityAdded", entity: tx() }]);
    expect(store.getSnapshot().entities).toContainEqual(tx());
  });

  it("emits an update with only the changed fields on inclusion", () => {
    const store = new WorldStateStore();
    store.applyTransaction(tx());
    const diff = store.applyTransaction(
      tx({ status: "included", blockHash: "0xblock" }),
    );
    expect(diff).toEqual([
      {
        type: "entityUpdated",
        id: "0xtx1",
        patch: { status: "included", blockHash: "0xblock" },
      },
    ]);
    const stored = store
      .getSnapshot()
      .entities.find((e) => e.kind === "transaction") as TransactionEntity;
    expect(stored.status).toBe("included");
    expect(stored.blockHash).toBe("0xblock");
    // 変化していない from/to は保持される。
    expect(stored.from).toBe("0xsender");
  });

  it("emits no diff when the same tx is applied unchanged", () => {
    const store = new WorldStateStore();
    store.applyTransaction(tx());
    expect(store.applyTransaction(tx())).toEqual([]);
  });

  it("tracks multiple distinct txs", () => {
    const store = new WorldStateStore();
    store.applyTransaction(tx({ hash: "0xa" }));
    store.applyTransaction(tx({ hash: "0xb" }));
    expect(
      store.getSnapshot().entities.filter((e) => e.kind === "transaction"),
    ).toHaveLength(2);
  });

  it("keeps txs separate from infra entities, blocks and edges", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    store.applyPeers([edge()]);
    store.applyBlock(block());
    store.applyTransaction(tx());
    const snapshot = store.getSnapshot();
    expect(snapshot.entities.filter((e) => e.kind === "node")).toHaveLength(1);
    expect(snapshot.entities.filter((e) => e.kind === "block")).toHaveLength(1);
    expect(
      snapshot.entities.filter((e) => e.kind === "transaction"),
    ).toHaveLength(1);
    expect(snapshot.edges).toHaveLength(1);
  });

  describe("endpoint resolution (Issue #80)", () => {
    it("resolves a workbench by ip", () => {
      const store = new WorldStateStore();
      const wb = workbench({ id: "w-1", ip: "172.28.2.5" });
      store.applyInfra([wb, node()]);
      expect(store.findWorkbenchByIp("172.28.2.5")).toEqual(wb);
    });

    it("returns undefined when no workbench has the ip", () => {
      const store = new WorldStateStore();
      store.applyInfra([workbench({ ip: "172.28.2.5" })]);
      expect(store.findWorkbenchByIp("10.0.0.1")).toBeUndefined();
    });

    it("does not resolve a node ip as a workbench", () => {
      const store = new WorldStateStore();
      store.applyInfra([node({ ip: "172.28.1.1" })]);
      expect(store.findWorkbenchByIp("172.28.1.1")).toBeUndefined();
    });

    it("resolves a node by ip", () => {
      const store = new WorldStateStore();
      const n = node({ id: "n-1", ip: "172.28.1.1" });
      store.applyInfra([n, workbench()]);
      expect(store.findNodeByIp("172.28.1.1")).toEqual(n);
    });

    it("returns undefined when no node has the ip", () => {
      const store = new WorldStateStore();
      store.applyInfra([node({ ip: "172.28.1.1" })]);
      expect(store.findNodeByIp("172.28.9.9")).toBeUndefined();
    });
  });
});

function contractEntity(
  overrides: Partial<ContractEntity> = {},
): ContractEntity {
  return {
    kind: "contract",
    address: "0xc0de",
    chainType: "ethereum",
    ...overrides,
  };
}

describe("WorldStateStore.applyContract", () => {
  it("adds an unknown contract (address only) on first detection", () => {
    const store = new WorldStateStore();
    const diff = store.applyContract(contractEntity());
    expect(diff).toEqual([{ type: "entityAdded", entity: contractEntity() }]);
    expect(store.getSnapshot().entities).toContainEqual(contractEntity());
  });

  it("emits an update with only the changed fields when catalog info is filled in later", () => {
    const store = new WorldStateStore();
    store.applyContract(contractEntity());
    const diff = store.applyContract(
      contractEntity({ name: "ChainvizToken", catalogKey: "ChainvizToken" }),
    );
    expect(diff).toEqual([
      {
        type: "entityUpdated",
        id: "0xc0de",
        patch: { name: "ChainvizToken", catalogKey: "ChainvizToken" },
      },
    ]);
    const stored = store
      .getSnapshot()
      .entities.find((e) => e.kind === "contract") as ContractEntity;
    expect(stored.name).toBe("ChainvizToken");
  });

  it("emits no diff when the same contract is applied unchanged", () => {
    const store = new WorldStateStore();
    store.applyContract(contractEntity());
    expect(store.applyContract(contractEntity())).toEqual([]);
  });

  it("tracks multiple distinct contracts by address", () => {
    const store = new WorldStateStore();
    store.applyContract(contractEntity({ address: "0xa" }));
    store.applyContract(contractEntity({ address: "0xb" }));
    expect(
      store.getSnapshot().entities.filter((e) => e.kind === "contract"),
    ).toHaveLength(2);
  });

  it("keeps contracts separate from infra entities, blocks, txs and edges", () => {
    const store = new WorldStateStore();
    store.applyInfra([node()]);
    store.applyPeers([edge()]);
    store.applyBlock(block());
    store.applyTransaction(tx());
    store.applyContract(contractEntity());
    const snapshot = store.getSnapshot();
    expect(snapshot.entities.filter((e) => e.kind === "node")).toHaveLength(1);
    expect(snapshot.entities.filter((e) => e.kind === "contract")).toHaveLength(
      1,
    );
    expect(snapshot.edges).toHaveLength(1);
  });
});
