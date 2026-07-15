import type { NodeEntity, TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  MEMPOOL_TX_DISPLAY_LIMIT,
  buildMempoolNodeEntries,
  buildMempoolTxEntries,
  limitMempoolTxEntries,
  sortMempoolTxEntriesByAppearance,
  type MempoolTxEntry,
} from "./mempoolList.js";

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0xhash",
    from: "0xfrom",
    to: "0xto",
    status: "pending",
    ...overrides,
  };
}

function nodeEntity(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "node-1",
    containerName: "reth-1",
    ip: "10.0.0.1",
    ports: [],
    resources: { cpuPercent: 0, memMB: 0 },
    process: { name: "reth" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 10,
    headBlockHash: "",
    ...overrides,
  };
}

describe("buildMempoolTxEntries", () => {
  it("extracts only pending transactions", () => {
    const transactions = [
      tx({ hash: "0x1", status: "pending" }),
      tx({ hash: "0x2", status: "included" }),
      tx({ hash: "0x3", status: "failed" }),
    ];
    const entries = buildMempoolTxEntries(transactions, new Set());
    expect(entries.map((e) => e.hash)).toEqual(["0x1"]);
  });

  it("returns an empty array when there are no pending transactions", () => {
    const transactions = [tx({ hash: "0x1", status: "included" })];
    expect(buildMempoolTxEntries(transactions, new Set())).toEqual([]);
  });

  it("carries from/to/functionName through from the entity", () => {
    const transactions = [
      tx({
        hash: "0x1",
        from: "0xaaa",
        to: "0xbbb",
        contractCall: { contractAddress: "0xbbb", functionName: "transfer" },
      }),
    ];
    const [entry] = buildMempoolTxEntries(transactions, new Set());
    expect(entry).toMatchObject({
      hash: "0x1",
      from: "0xaaa",
      to: "0xbbb",
      functionName: "transfer",
    });
  });

  it("leaves functionName undefined when there is no contractCall", () => {
    const transactions = [tx({ hash: "0x1" })];
    const [entry] = buildMempoolTxEntries(transactions, new Set());
    expect(entry?.functionName).toBeUndefined();
  });

  it("keeps to as null for a contract-creation (deploy) tx", () => {
    const transactions = [tx({ hash: "0x1", to: null })];
    const [entry] = buildMempoolTxEntries(transactions, new Set());
    expect(entry?.to).toBeNull();
  });

  it("marks fromIsWallet true only when from is in the wallet id set", () => {
    const transactions = [
      tx({ hash: "0x1", from: "0xaaa" }),
      tx({ hash: "0x2", from: "0xbbb" }),
    ];
    const entries = buildMempoolTxEntries(transactions, new Set(["0xaaa"]));
    expect(entries.find((e) => e.hash === "0x1")?.fromIsWallet).toBe(true);
    expect(entries.find((e) => e.hash === "0x2")?.fromIsWallet).toBe(false);
  });

  it("returns an empty array for an empty transaction list", () => {
    expect(buildMempoolTxEntries([], new Set(["0xaaa"]))).toEqual([]);
  });

  it("preserves the input order of pending transactions", () => {
    const transactions = [
      tx({ hash: "0x3" }),
      tx({ hash: "0x1" }),
      tx({ hash: "0x2" }),
    ];
    const entries = buildMempoolTxEntries(transactions, new Set());
    expect(entries.map((e) => e.hash)).toEqual(["0x3", "0x1", "0x2"]);
  });

  it("matches fromIsWallet case-sensitively (from and wallet ids must share casing)", () => {
    // walletIds are wallet card ids (= address) taken verbatim from rfNodes, and
    // tx.from is compared with Set.has (exact string match). A different casing
    // does not match. Both sides are expected to already be normalized to the
    // same casing upstream by the collector; this test pins that assumption.
    const transactions = [tx({ hash: "0x1", from: "0xAAA" })];
    const entries = buildMempoolTxEntries(transactions, new Set(["0xaaa"]));
    expect(entries[0]?.fromIsWallet).toBe(false);
  });

  it("treats an empty from string as a wallet only if the set literally contains it", () => {
    const notWallet = buildMempoolTxEntries([tx({ hash: "0x1", from: "" })], new Set());
    expect(notWallet[0]?.fromIsWallet).toBe(false);
    const isWallet = buildMempoolTxEntries([tx({ hash: "0x2", from: "" })], new Set([""]));
    expect(isWallet[0]?.fromIsWallet).toBe(true);
  });
});

describe("sortMempoolTxEntriesByAppearance", () => {
  function entry(hash: string): MempoolTxEntry {
    return { hash, from: "0xfrom", to: "0xto", fromIsWallet: false };
  }

  it("orders entries with the newest (highest order value) first", () => {
    const entries = [entry("0x1"), entry("0x2"), entry("0x3")];
    const order = new Map([
      ["0x1", 0],
      ["0x2", 2],
      ["0x3", 1],
    ]);
    const sorted = sortMempoolTxEntriesByAppearance(entries, order);
    expect(sorted.map((e) => e.hash)).toEqual(["0x2", "0x3", "0x1"]);
  });

  it("sends hashes missing from the order map to the end", () => {
    const entries = [entry("0x1"), entry("0x2")];
    const order = new Map([["0x1", 0]]);
    const sorted = sortMempoolTxEntriesByAppearance(entries, order);
    expect(sorted.map((e) => e.hash)).toEqual(["0x1", "0x2"]);
  });

  it("does not mutate the input array", () => {
    const entries = [entry("0x1"), entry("0x2")];
    const order = new Map([
      ["0x1", 0],
      ["0x2", 1],
    ]);
    sortMempoolTxEntriesByAppearance(entries, order);
    expect(entries.map((e) => e.hash)).toEqual(["0x1", "0x2"]);
  });

  it("returns an empty array for empty input", () => {
    expect(sortMempoolTxEntriesByAppearance([], new Map())).toEqual([]);
  });

  it("keeps a stable relative order for entries sharing the same order value", () => {
    const entries = [entry("0x1"), entry("0x2"), entry("0x3")];
    const order = new Map([
      ["0x1", 5],
      ["0x2", 5],
      ["0x3", 5],
    ]);
    const sorted = sortMempoolTxEntriesByAppearance(entries, order);
    expect(sorted.map((e) => e.hash)).toEqual(["0x1", "0x2", "0x3"]);
  });

  it("preserves insertion order when every hash is missing from the order map", () => {
    const entries = [entry("0x3"), entry("0x1"), entry("0x2")];
    const sorted = sortMempoolTxEntriesByAppearance(entries, new Map());
    expect(sorted.map((e) => e.hash)).toEqual(["0x3", "0x1", "0x2"]);
  });
});

describe("limitMempoolTxEntries", () => {
  function entries(count: number): MempoolTxEntry[] {
    return Array.from({ length: count }, (_, i) => ({
      hash: `0x${i}`,
      from: "0xfrom",
      to: "0xto",
      fromIsWallet: false,
    }));
  }

  it("returns all entries with zero overflow when under the limit", () => {
    const result = limitMempoolTxEntries(entries(3), 8);
    expect(result.visible).toHaveLength(3);
    expect(result.overflowCount).toBe(0);
  });

  it("returns all entries with zero overflow when exactly at the limit", () => {
    const result = limitMempoolTxEntries(entries(8), 8);
    expect(result.visible).toHaveLength(8);
    expect(result.overflowCount).toBe(0);
  });

  it("truncates to the limit and reports the overflow count", () => {
    const result = limitMempoolTxEntries(entries(12), 8);
    expect(result.visible).toHaveLength(8);
    expect(result.visible.map((e) => e.hash)).toEqual(entries(8).map((e) => e.hash));
    expect(result.overflowCount).toBe(4);
  });

  it("uses MEMPOOL_TX_DISPLAY_LIMIT as the default limit", () => {
    const result = limitMempoolTxEntries(entries(MEMPOOL_TX_DISPLAY_LIMIT + 1));
    expect(result.visible).toHaveLength(MEMPOOL_TX_DISPLAY_LIMIT);
    expect(result.overflowCount).toBe(1);
  });

  it("returns an empty result with zero overflow for empty input", () => {
    const result = limitMempoolTxEntries(entries(0), 8);
    expect(result.visible).toEqual([]);
    expect(result.overflowCount).toBe(0);
  });

  it("truncates 9 entries to 8 with overflow 1 (boundary just over the limit)", () => {
    const result = limitMempoolTxEntries(entries(9), 8);
    expect(result.visible).toHaveLength(8);
    expect(result.overflowCount).toBe(1);
  });

  it("treats a limit of 0 as everything overflowing", () => {
    const result = limitMempoolTxEntries(entries(3), 0);
    expect(result.visible).toEqual([]);
    expect(result.overflowCount).toBe(3);
  });

  it("does not mutate the input array when truncating", () => {
    const input = entries(10);
    limitMempoolTxEntries(input, 8);
    expect(input).toHaveLength(10);
  });
});

describe("buildMempoolNodeEntries", () => {
  it("includes nodes that report internals.mempool", () => {
    const nodes = [
      nodeEntity({ id: "n1", containerName: "reth-1", internals: { mempool: { pending: 3, queued: 1 } } }),
    ];
    const entries = buildMempoolNodeEntries(nodes);
    expect(entries).toEqual([{ nodeId: "n1", label: "reth-1", pending: 3, queued: 1 }]);
  });

  it("excludes nodes without internals.mempool (e.g. beacon nodes)", () => {
    const nodes = [
      nodeEntity({ id: "n1", containerName: "reth-1", internals: { mempool: { pending: 0, queued: 0 } } }),
      nodeEntity({ id: "n2", containerName: "beacon-1", internals: { syncStages: [] } }),
      nodeEntity({ id: "n3", containerName: "beacon-2" }),
    ];
    const entries = buildMempoolNodeEntries(nodes);
    expect(entries.map((e) => e.nodeId)).toEqual(["n1"]);
  });

  it("returns an empty array when no node reports mempool internals", () => {
    const nodes = [nodeEntity({ id: "n1" })];
    expect(buildMempoolNodeEntries(nodes)).toEqual([]);
  });

  it("keeps a zero pending/queued count row (healthy, idle mempool is meaningful too)", () => {
    const nodes = [
      nodeEntity({ id: "n1", internals: { mempool: { pending: 0, queued: 0 } } }),
    ];
    const entries = buildMempoolNodeEntries(nodes);
    expect(entries).toEqual([{ nodeId: "n1", label: "reth-1", pending: 0, queued: 0 }]);
  });

  it("returns an empty array for an empty node list", () => {
    expect(buildMempoolNodeEntries([])).toEqual([]);
  });

  it("excludes a node whose internals object exists but omits mempool", () => {
    const nodes = [nodeEntity({ id: "n1", internals: {} })];
    expect(buildMempoolNodeEntries(nodes)).toEqual([]);
  });

  it("keeps only the mempool-reporting nodes when they are mixed with others", () => {
    const nodes = [
      nodeEntity({ id: "n0" }),
      nodeEntity({ id: "n1", containerName: "reth-1", internals: { mempool: { pending: 2, queued: 0 } } }),
      nodeEntity({ id: "n2", containerName: "beacon-1", internals: { syncStages: [] } }),
      nodeEntity({ id: "n3", containerName: "reth-2", internals: { mempool: { pending: 5, queued: 1 } } }),
    ];
    const entries = buildMempoolNodeEntries(nodes);
    expect(entries.map((e) => e.nodeId)).toEqual(["n1", "n3"]);
  });

  it("preserves input order even when nodes report identical counts", () => {
    const counts = { mempool: { pending: 4, queued: 2 } };
    const nodes = [
      nodeEntity({ id: "n3", containerName: "reth-3", internals: counts }),
      nodeEntity({ id: "n1", containerName: "reth-1", internals: counts }),
      nodeEntity({ id: "n2", containerName: "reth-2", internals: counts }),
    ];
    const entries = buildMempoolNodeEntries(nodes);
    expect(entries.map((e) => e.nodeId)).toEqual(["n3", "n1", "n2"]);
  });
});
