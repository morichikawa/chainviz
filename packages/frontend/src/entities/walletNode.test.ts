import type {
  NodeEntity,
  TransactionEntity,
  WalletEntity,
} from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { indexTransactions } from "./transaction.js";
import {
  WALLET_GRID,
  formatEther,
  isSameWalletNode,
  isWalletEntity,
  walletsToFlowNodes,
} from "./walletNode.js";

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
});
