// WorldStateStore.purgeChainDerivedState（Issue #357: チェーンリセット検知
// 時のパージ）のユニットテスト。block 保持窓（store-block-retention.test.ts）
// や tx 保持窓（store-transaction-retention*.test.ts）とは別の関心事
// （「チェーン自体が別物になった」ときの全量パージ）なので分離する。

import type {
  BlockEntity,
  ContractEntity,
  NodeEntity,
  TransactionEntity,
  WorkbenchEntity,
} from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { WorldStateStore } from "./store.js";

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

function block(overrides: Partial<BlockEntity> = {}): BlockEntity {
  return {
    kind: "block",
    hash: "0xblock1",
    number: 1,
    parentHash: "0xgenesis",
    timestamp: 100,
    receivedAt: {},
    ...overrides,
  };
}

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0xtx1",
    from: "0xfrom",
    to: "0xto",
    status: "included",
    blockHash: "0xblock1",
    ...overrides,
  };
}

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: "0xcontract1",
    chainType: "ethereum",
    deployerAddress: "0xdeployer",
    createdByTxHash: "0xdeploytx",
    ...overrides,
  };
}

/** node/workbench/block/tx/wallet/contract を1つずつ持つ store を用意する。 */
function storeWithOneOfEachKind(): WorldStateStore {
  const store = new WorldStateStore();
  store.applyInfra([node(), workbench()]);
  store.applyBlock(block());
  store.applyTransaction(tx());
  store.applyWallets([
    { address: "0xwallet1", ownerWorkbenchId: "chainviz-ethereum/workbench1", balance: "1000", nonce: 2 },
  ]);
  store.applyContract(contract());
  return store;
}

describe("WorldStateStore.purgeChainDerivedState", () => {
  it("removes wallet/contract/block/transaction entities", () => {
    const store = storeWithOneOfEachKind();
    const kindsBefore = store
      .getSnapshot()
      .entities.map((e) => e.kind)
      .sort();
    expect(kindsBefore).toEqual(
      ["block", "contract", "node", "transaction", "wallet", "workbench"].sort(),
    );

    store.purgeChainDerivedState();

    const remaining = store.getSnapshot().entities;
    expect(remaining.map((e) => e.kind).sort()).toEqual(["node", "workbench"]);
  });

  it("keeps node/workbench entities and edges untouched", () => {
    const store = storeWithOneOfEachKind();
    store.applyPeers([
      { kind: "peer", fromNodeId: "a", toNodeId: "b", networkId: "net" },
    ]);

    store.purgeChainDerivedState();

    const snapshot = store.getSnapshot();
    expect(snapshot.entities).toEqual([node(), workbench()]);
    expect(snapshot.edges).toEqual([
      { kind: "peer", fromNodeId: "a", toNodeId: "b", networkId: "net" },
    ]);
  });

  it("returns entityRemoved events for each purged entity", () => {
    const store = storeWithOneOfEachKind();
    const events = store.purgeChainDerivedState();

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "entityRemoved", id: "0xwallet1" },
        { type: "entityRemoved", id: "0xcontract1" },
        { type: "entityRemoved", id: "0xblock1" },
        { type: "entityRemoved", id: "0xtx1" },
      ]),
    );
    expect(events).toHaveLength(4);
  });

  it("returns an empty array (no-op) when there is nothing to purge", () => {
    const store = new WorldStateStore();
    store.applyInfra([node(), workbench()]);
    expect(store.purgeChainDerivedState()).toEqual([]);
  });

  it("re-creates a wallet with fresh balance/nonce after purge instead of inheriting the old chain's stale values (regression: ghost re-ownership, Issue #357)", () => {
    // 旧チェーンのウォレット（プリマイン残高＋旧セッションの送金で膨らんだ
    // 残高・nonce）。EthereumNodeLifecycle の wallet-index 採番は意図的に
    // パージしない設計のため、新チェーンで同じワークベンチを作ると同じ導出
    // インデックス＝同じアドレスが再利用される。そのとき旧残高・nonce を
    // 引き継いだゴーストが「再所有」されないこと（パージで消え、新チェーンの
    // 観測からゼロ残高で作り直されること）を固定する。
    const store = new WorldStateStore();
    store.applyInfra([node(), workbench()]);
    store.applyWallets([
      {
        address: "0xwallet1",
        ownerWorkbenchId: "chainviz-ethereum/workbench1",
        balance: "1000000000002000000000000000",
        nonce: 5,
      },
    ]);

    store.purgeChainDerivedState();
    expect(
      store.getSnapshot().entities.some((e) => e.kind === "wallet"),
    ).toBe(false);

    // 新チェーン: 同じアドレスをゼロ残高で観測。旧値とマージされず、新規
    // entityAdded として素の状態で現れる。
    const diff = store.applyWallets([
      {
        address: "0xwallet1",
        ownerWorkbenchId: "chainviz-ethereum/workbench1",
        balance: "0",
        nonce: 0,
      },
    ]);
    expect(diff).toEqual([
      {
        type: "entityAdded",
        entity: expect.objectContaining({
          kind: "wallet",
          address: "0xwallet1",
          balance: "0",
          nonce: 0,
        }),
      },
    ]);
    const wallet = store
      .getSnapshot()
      .entities.find((e) => e.kind === "wallet");
    expect(wallet).toMatchObject({ balance: "0", nonce: 0 });
  });

  it("resets maxObservedBlockNumber so a fresh chain's early blocks are accepted (regression: the second bug from issue-357's design)", () => {
    const store = new WorldStateStore();
    // 旧チェーンでブロック番号を進める（保持窓の基準を上げる）。
    for (let n = 1; n <= 40; n++) {
      store.applyBlock(
        block({ hash: `0xold${n}`, number: n, parentHash: `0xold${n - 1}` }),
      );
    }
    store.purgeChainDerivedState();

    // 新チェーンはブロック番号1から始まる。パージ前の基準（40）のままだと
    // BLOCK_RETENTION(32) の窓に「古すぎる」として弾かれてしまう。
    const diff = store.applyBlock(
      block({ hash: "0xnew1", number: 1, parentHash: "0xnewgenesis" }),
    );
    expect(diff).toEqual([
      {
        type: "entityAdded",
        entity: block({ hash: "0xnew1", number: 1, parentHash: "0xnewgenesis" }),
      },
    ]);
    expect(
      store
        .getSnapshot()
        .entities.some((e) => e.kind === "block" && e.hash === "0xnew1"),
    ).toBe(true);
  });
});
