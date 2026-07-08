import type {
  ContractEntity,
  NodeEntity,
  TransactionEntity,
  WalletEntity,
  WorldStateEntity,
} from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { isContractEntity } from "./contractNode.js";
import { stabilizeArrayReference } from "./nodeStability.js";
import { indexTransactions } from "./transaction.js";
import {
  WALLET_GRID,
  formatEther,
  isSameWalletNode,
  isWalletEntity,
  walletsToFlowNodes,
} from "./walletNode.js";

/**
 * `ctx()` の既定 `contractsByAddress`。同じ内容の複数回呼び出しでも常に
 * 同一の参照を返すことで、実運用（App.tsx が useMemo で安定させる索引を
 * 渡す）を模す。単に `new Map()` を都度作ると Issue #119 の参照安定化
 * テストが壊れる（内容は空同士でも参照が変われば「変化した」と誤検出する）。
 */
const EMPTY_CONTRACTS = new Map<string, ContractEntity>();

function wallet(overrides: Partial<WalletEntity> = {}): WalletEntity {
  return {
    kind: "wallet",
    address: "0xabc",
    chainType: "ethereum",
    balance: "0",
    nonce: 0,
    isSmartAccount: false,
    ownerWorkbenchId: null,
    recentTxHashes: [],
    ...overrides,
  };
}

const node: NodeEntity = {
  kind: "node",
  id: "reth-1",
  containerName: "c-reth-1",
  ip: "1.1.1.1",
  ports: [8545],
  resources: { cpuPercent: 1, memMB: 1 },
  process: { name: "reth" },
  chainType: "ethereum",
  clientType: "reth",
  syncStatus: "synced",
  blockHeight: 1,
  headBlockHash: "0x0",
};

function ctx(overrides: Partial<Parameters<typeof walletsToFlowNodes>[1]> = {}) {
  return {
    layout: {},
    txByHash: new Map<string, TransactionEntity>(),
    settling: new Set<string>(),
    presentInfraIds: new Set<string>(),
    contractsByAddress: EMPTY_CONTRACTS,
    ...overrides,
  };
}

describe("isWalletEntity", () => {
  it("accepts wallets and rejects nodes", () => {
    expect(isWalletEntity(wallet())).toBe(true);
    expect(isWalletEntity(node)).toBe(false);
  });
});

describe("formatEther", () => {
  it("converts whole ether", () => {
    expect(formatEther((5n * 10n ** 18n).toString())).toBe("5.0000");
  });

  it("shows fractional ether to the requested precision", () => {
    // 1.5 ETH
    expect(formatEther((1_500_000_000_000_000_000n).toString())).toBe("1.5000");
  });

  it("truncates rather than rounds extra digits", () => {
    // 0.123456789 ETH → 4桁で切り捨て
    expect(formatEther((123_456_789_000_000_000n).toString())).toBe("0.1234");
  });

  it("handles negative balances", () => {
    expect(formatEther((-(10n ** 18n)).toString())).toBe("-1.0000");
  });

  it("returns the input unchanged when not an integer string", () => {
    expect(formatEther("not-a-number")).toBe("not-a-number");
  });
});

describe("walletsToFlowNodes", () => {
  it("keeps only wallet entities and sorts by address", () => {
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xb" }), node, wallet({ address: "0xa" })],
      ctx(),
    );
    expect(nodes.map((n) => n.id)).toEqual(["0xa", "0xb"]);
    expect(nodes.every((n) => n.type === "wallet")).toBe(true);
  });

  it("uses saved positions keyed by address", () => {
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xa" })],
      ctx({ layout: { "0xa": { x: 11, y: 22 } } }),
    );
    expect(nodes[0].position).toEqual({ x: 11, y: 22 });
  });

  it("falls back to the wallet grid origin when unsaved", () => {
    const nodes = walletsToFlowNodes([wallet({ address: "0xa" })], ctx());
    expect(nodes[0].position).toEqual({
      x: WALLET_GRID.originX,
      y: WALLET_GRID.originY,
    });
  });

  it("resolves recent transactions onto the node data", () => {
    const tx: TransactionEntity = {
      kind: "transaction",
      hash: "0x1",
      from: "0xa",
      to: "0xb",
      status: "pending",
    };
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xa", recentTxHashes: ["0x1"] })],
      ctx({ txByHash: indexTransactions([tx]) }),
    );
    expect(nodes[0].data.transactions.map((t) => t.hash)).toEqual(["0x1"]);
  });

  it("marks a wallet's tx as settling when in the settling set", () => {
    const tx: TransactionEntity = {
      kind: "transaction",
      hash: "0x1",
      from: "0xa",
      to: "0xb",
      status: "included",
    };
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xa", recentTxHashes: ["0x1"] })],
      ctx({
        txByHash: indexTransactions([tx]),
        settling: new Set(["0x1"]),
      }),
    );
    expect(nodes[0].data.settlingHashes).toEqual(["0x1"]);
  });

  it("reports ownerPresent true when the owner workbench exists", () => {
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xa", ownerWorkbenchId: "wb-1" })],
      ctx({ presentInfraIds: new Set(["wb-1"]) }),
    );
    expect(nodes[0].data.ownerPresent).toBe(true);
  });

  it("reports ownerPresent false when the owner is absent (deleted)", () => {
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xa", ownerWorkbenchId: "wb-1" })],
      ctx({ presentInfraIds: new Set() }),
    );
    expect(nodes[0].data.ownerPresent).toBe(false);
  });

  it("reports ownerPresent false when ownerWorkbenchId is null", () => {
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xa", ownerWorkbenchId: null })],
      ctx({ presentInfraIds: new Set(["wb-1"]) }),
    );
    expect(nodes[0].data.ownerPresent).toBe(false);
  });

  it("attaches the given contractsByAddress index to every wallet's data", () => {
    const contract: ContractEntity = {
      kind: "contract",
      address: "0xc",
      chainType: "ethereum",
      name: "ChainvizToken",
    };
    const byAddress = new Map([["0xc", contract]]);
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xa" }), wallet({ address: "0xb" })],
      ctx({ contractsByAddress: byAddress }),
    );
    expect(nodes[0].data.contractsByAddress).toBe(byAddress);
    expect(nodes[1].data.contractsByAddress).toBe(byAddress);
  });

  it("falls back to an empty contractsByAddress index when omitted", () => {
    const nodes = walletsToFlowNodes([wallet({ address: "0xa" })], {
      layout: {},
      txByHash: new Map<string, TransactionEntity>(),
      settling: new Set<string>(),
      presentInfraIds: new Set<string>(),
    });
    expect(nodes[0].data.contractsByAddress.size).toBe(0);
  });
});

describe("isSameWalletNode", () => {
  const tx: TransactionEntity = {
    kind: "transaction",
    hash: "0x1",
    from: "0xa",
    to: "0xb",
    status: "pending",
  };

  it("returns true when nothing meaningful changed between two recomputations (Issue #119)", () => {
    const entity = wallet({ address: "0xa", recentTxHashes: ["0x1"] });
    const context = ctx({ txByHash: indexTransactions([tx]) });
    const previous = walletsToFlowNodes([entity], context)[0];
    // 別回の呼び出しでも、entity・tx が同じ参照であれば内容は変わっていない。
    const next = walletsToFlowNodes([entity], context)[0];
    expect(previous).not.toBe(next); // walletsToFlowNodes は毎回新しいオブジェクトを返す
    expect(isSameWalletNode(previous, next)).toBe(true);
  });

  it("returns false when the entity reference changed", () => {
    const context = ctx();
    const previous = walletsToFlowNodes(
      [wallet({ address: "0xa" })],
      context,
    )[0];
    const next = walletsToFlowNodes([wallet({ address: "0xa" })], context)[0];
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("returns false when the transaction list content changed", () => {
    const entity = wallet({ address: "0xa", recentTxHashes: ["0x1"] });
    const previous = walletsToFlowNodes(
      [entity],
      ctx({ txByHash: indexTransactions([tx]) }),
    )[0];
    const updatedTx: TransactionEntity = { ...tx, status: "included" };
    const next = walletsToFlowNodes(
      [entity],
      ctx({ txByHash: indexTransactions([updatedTx]) }),
    )[0];
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("returns false when settlingHashes changed", () => {
    const entity = wallet({ address: "0xa", recentTxHashes: ["0x1"] });
    const context = ctx({ txByHash: indexTransactions([tx]) });
    const previous = walletsToFlowNodes([entity], context)[0];
    const next = walletsToFlowNodes(
      [entity],
      { ...context, settling: new Set(["0x1"]) },
    )[0];
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("returns false when ownerPresent changed", () => {
    const entity = wallet({ address: "0xa", ownerWorkbenchId: "wb-1" });
    const previous = walletsToFlowNodes(
      [entity],
      ctx({ presentInfraIds: new Set(["wb-1"]) }),
    )[0];
    const next = walletsToFlowNodes(
      [entity],
      ctx({ presentInfraIds: new Set() }),
    )[0];
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("returns false when the position changed", () => {
    const entity = wallet({ address: "0xa" });
    const previous = walletsToFlowNodes([entity], ctx())[0];
    const next = walletsToFlowNodes(
      [entity],
      ctx({ layout: { "0xa": { x: 5, y: 5 } } }),
    )[0];
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("returns false when only x changed", () => {
    const entity = wallet({ address: "0xa" });
    const previous = walletsToFlowNodes(
      [entity],
      ctx({ layout: { "0xa": { x: 0, y: 5 } } }),
    )[0];
    const next = walletsToFlowNodes(
      [entity],
      ctx({ layout: { "0xa": { x: 1, y: 5 } } }),
    )[0];
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("returns false when only y changed", () => {
    const entity = wallet({ address: "0xa" });
    const previous = walletsToFlowNodes(
      [entity],
      ctx({ layout: { "0xa": { x: 5, y: 0 } } }),
    )[0];
    const next = walletsToFlowNodes(
      [entity],
      ctx({ layout: { "0xa": { x: 5, y: 1 } } }),
    )[0];
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("compares position by value: distinct position objects with equal x/y are 'same'", () => {
    const entity = wallet({ address: "0xa" });
    const base = walletsToFlowNodes([entity], ctx())[0];
    // 同じ entity・tx・座標だが position は別オブジェクトに差し替える。
    const previous = { ...base, position: { x: 3, y: 4 } };
    const next = { ...base, position: { x: 3, y: 4 } };
    expect(previous.position).not.toBe(next.position);
    expect(isSameWalletNode(previous, next)).toBe(true);
  });

  it("returns false when a transaction element has a different reference despite equal content", () => {
    // sameByReference は要素の参照で比較する。内容が同じでも別オブジェクトの
    // tx に差し替われば変化として検出する(取りこぼしの逆方向バグが無いこと)。
    const entity = wallet({ address: "0xa", recentTxHashes: ["0x1"] });
    const base = walletsToFlowNodes([entity], ctx({ txByHash: indexTransactions([tx]) }))[0];
    const clonedTx: TransactionEntity = { ...tx };
    const previous = { ...base, data: { ...base.data, transactions: [tx] } };
    const next = { ...base, data: { ...base.data, transactions: [clonedTx] } };
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("returns false when the transaction list length changed", () => {
    const entity = wallet({ address: "0xa" });
    const base = walletsToFlowNodes([entity], ctx())[0];
    const tx2: TransactionEntity = { ...tx, hash: "0x2" };
    const previous = { ...base, data: { ...base.data, transactions: [tx] } };
    const next = { ...base, data: { ...base.data, transactions: [tx, tx2] } };
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("treats the same transactions in a different order as a change (order-sensitive)", () => {
    const entity = wallet({ address: "0xa" });
    const base = walletsToFlowNodes([entity], ctx())[0];
    const tx2: TransactionEntity = { ...tx, hash: "0x2" };
    const previous = { ...base, data: { ...base.data, transactions: [tx, tx2] } };
    const next = { ...base, data: { ...base.data, transactions: [tx2, tx] } };
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("treats the same settling hashes in a different order as a change (order-sensitive)", () => {
    const entity = wallet({ address: "0xa" });
    const base = walletsToFlowNodes([entity], ctx())[0];
    const previous = { ...base, data: { ...base.data, settlingHashes: ["0x1", "0x2"] } };
    const next = { ...base, data: { ...base.data, settlingHashes: ["0x2", "0x1"] } };
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("returns false when the contractsByAddress reference changed", () => {
    const entity = wallet({ address: "0xa" });
    const previous = walletsToFlowNodes(
      [entity],
      ctx({ contractsByAddress: new Map() }),
    )[0];
    const next = walletsToFlowNodes(
      [entity],
      ctx({ contractsByAddress: new Map() }),
    )[0];
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("detects a deep entity field change via the new entity reference the store hands back", () => {
    // balance のような入れ子でないフィールドでも、entity 参照が変わるため検出する。
    const base = wallet({ address: "0xa", balance: "0" });
    const changed = wallet({ address: "0xa", balance: "1000" });
    const previous = walletsToFlowNodes([base], ctx())[0];
    const next = walletsToFlowNodes([changed], ctx())[0];
    expect(isSameWalletNode(previous, next)).toBe(false);
  });
});

/**
 * Issue #166 差し戻し対応の回帰テスト。
 *
 * App.tsx は `entities`（`listEntities(state)`）が state 更新のたびに
 * 新しい配列になるため、`contracts`（`entities.filter(isContractEntity)`）も
 * `contractsByAddress`（`new Map(contracts.map(...))`）も、無関係な更新の
 * たびに新しいインスタンスとして作り直されていた。isSameWalletNode は
 * `contractsByAddress` を参照比較するため、中身が同じでも常に「変化した」と
 * 誤判定し、Issue #119 の参照安定化（不要な再レンダー防止）を無効化していた。
 * ここでは実際の App.tsx の派生パターン（filter → stabilizeArrayReference →
 * Map化）を模して、この2ケースを検証する。
 */
describe("contractsByAddress reference stability across recomputations (Issue #166 regression)", () => {
  const contractEntity: ContractEntity = {
    kind: "contract",
    address: "0xc",
    chainType: "ethereum",
    name: "ChainvizToken",
  };
  const walletEntity = wallet({ address: "0xa" });

  /**
   * App.tsx の `entities` useMemo が state 更新のたびに作り直す配列を模す。
   * 配列自体は毎回新しいが、無関係な差分適用ではエンティティ自体の参照は
   * 変わらない（world-state/store.ts の applyDiff は変更の無いエンティティの
   * 参照をそのまま引き継ぐ）。
   */
  function renderEntities(): WorldStateEntity[] {
    return [contractEntity, walletEntity];
  }

  it("reproduces the bug: without stabilization, an unrelated re-render breaks isSameWalletNode even though nothing meaningful changed", () => {
    // App.tsx 修正前の派生パターン: filter の結果をそのまま Map 化するだけ。
    const deriveContractsByAddressNaive = (entities: WorldStateEntity[]) =>
      new Map(entities.filter(isContractEntity).map((c) => [c.address, c]));

    const previous = walletsToFlowNodes(
      renderEntities().filter(isWalletEntity),
      ctx({ contractsByAddress: deriveContractsByAddressNaive(renderEntities()) }),
    )[0];
    const next = walletsToFlowNodes(
      renderEntities().filter(isWalletEntity),
      ctx({ contractsByAddress: deriveContractsByAddressNaive(renderEntities()) }),
    )[0];

    // 中身は同一(同じ contractEntity 参照1件)なのに Map インスタンスが毎回
    // 別物になるため、isSameWalletNode が誤って「変化した」と判定してしまう
    // (これが Issue #166 差し戻しで指摘されたバグそのもの)。
    expect(previous.data.contractsByAddress).not.toBe(
      next.data.contractsByAddress,
    );
    expect(isSameWalletNode(previous, next)).toBe(false);
  });

  it("fix: stabilizing the contracts array with stabilizeArrayReference keeps the Map reference stable across unrelated re-renders", () => {
    // App.tsx 修正後の派生パターン: previousContractsRef + useMemo を模した
    // クロージャで、contracts 配列と contractsByAddress の Map をそれぞれ
    // 前回参照が使えるときは使い回す(App.tsx の実際の useMemo 依存関係と同じ)。
    let previousContracts: ContractEntity[] = [];
    let previousMap: ReadonlyMap<string, ContractEntity> | undefined;
    let previousMapSource: ContractEntity[] | undefined;

    const deriveContractsByAddressFixed = (entities: WorldStateEntity[]) => {
      const contracts = stabilizeArrayReference(
        entities.filter(isContractEntity),
        previousContracts,
      );
      previousContracts = contracts;
      if (previousMap !== undefined && previousMapSource === contracts) {
        return previousMap;
      }
      const map = new Map(contracts.map((c) => [c.address, c]));
      previousMap = map;
      previousMapSource = contracts;
      return map;
    };

    const previous = walletsToFlowNodes(
      renderEntities().filter(isWalletEntity),
      ctx({ contractsByAddress: deriveContractsByAddressFixed(renderEntities()) }),
    )[0];
    const next = walletsToFlowNodes(
      renderEntities().filter(isWalletEntity),
      ctx({ contractsByAddress: deriveContractsByAddressFixed(renderEntities()) }),
    )[0];

    expect(previous.data.contractsByAddress).toBe(next.data.contractsByAddress);
    expect(isSameWalletNode(previous, next)).toBe(true);
  });
});
