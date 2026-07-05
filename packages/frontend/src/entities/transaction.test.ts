import type {
  TransactionEntity,
  WalletEntity,
  WorldStateEntity,
} from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  detectTxSettlements,
  indexTransactions,
  resolveWalletTransactions,
  shortHex,
  txStatusMap,
} from "./transaction.js";

function tx(
  hash: string,
  status: TransactionEntity["status"] = "pending",
): TransactionEntity {
  return { kind: "transaction", hash, from: "0xfrom", to: "0xto", status };
}

const wallet: WalletEntity = {
  kind: "wallet",
  address: "0xabc",
  chainType: "ethereum",
  balance: "0",
  nonce: 0,
  isSmartAccount: false,
  ownerWorkbenchId: null,
  recentTxHashes: [],
};

describe("shortHex", () => {
  it("shortens a long hex to lead…tail", () => {
    expect(shortHex(`0x${"a".repeat(40)}`)).toBe("0xaaaaaa…aaaa");
  });

  it("keeps short values untouched", () => {
    expect(shortHex("0x1234")).toBe("0x1234");
  });

  it("returns non-0x strings unchanged", () => {
    expect(shortHex("not-a-hex")).toBe("not-a-hex");
  });

  it("honors custom lead/tail lengths", () => {
    expect(shortHex(`0x${"b".repeat(20)}`, 4, 3)).toBe("0xbbbb…bbb");
  });
});

describe("indexTransactions", () => {
  it("indexes only transaction entities by hash", () => {
    const entities: WorldStateEntity[] = [tx("0x1"), wallet, tx("0x2")];
    const map = indexTransactions(entities);
    expect(map.size).toBe(2);
    expect(map.get("0x1")?.hash).toBe("0x1");
    expect(map.get("0x2")?.hash).toBe("0x2");
  });

  it("returns an empty map when there are no transactions", () => {
    expect(indexTransactions([wallet]).size).toBe(0);
  });
});

describe("resolveWalletTransactions", () => {
  it("resolves recent hashes to existing tx entities in order", () => {
    const byHash = indexTransactions([tx("0x1"), tx("0x2"), tx("0x3")]);
    const w = { ...wallet, recentTxHashes: ["0x2", "0x1"] };
    expect(resolveWalletTransactions(w, byHash).map((t) => t.hash)).toEqual([
      "0x2",
      "0x1",
    ]);
  });

  it("skips hashes not present in the index", () => {
    const byHash = indexTransactions([tx("0x1")]);
    const w = { ...wallet, recentTxHashes: ["0xmissing", "0x1"] };
    expect(resolveWalletTransactions(w, byHash).map((t) => t.hash)).toEqual([
      "0x1",
    ]);
  });

  it("caps the result at the given limit", () => {
    const byHash = indexTransactions([
      tx("0x1"),
      tx("0x2"),
      tx("0x3"),
      tx("0x4"),
    ]);
    const w = { ...wallet, recentTxHashes: ["0x1", "0x2", "0x3", "0x4"] };
    expect(resolveWalletTransactions(w, byHash, 2).map((t) => t.hash)).toEqual([
      "0x1",
      "0x2",
    ]);
  });
});

describe("txStatusMap", () => {
  it("maps hashes to their current status", () => {
    const map = txStatusMap([tx("0x1", "pending"), tx("0x2", "included")]);
    expect(map.get("0x1")).toBe("pending");
    expect(map.get("0x2")).toBe("included");
  });
});

describe("detectTxSettlements", () => {
  it("detects pending → included transitions", () => {
    const prev = new Map([["0x1", "pending" as const]]);
    const next = new Map([["0x1", "included" as const]]);
    expect(detectTxSettlements(prev, next)).toEqual(["0x1"]);
  });

  it("detects pending → failed transitions", () => {
    const prev = new Map([["0x1", "pending" as const]]);
    const next = new Map([["0x1", "failed" as const]]);
    expect(detectTxSettlements(prev, next)).toEqual(["0x1"]);
  });

  it("ignores newly appeared pending tx (not a settlement)", () => {
    const prev = new Map<string, "pending" | "included" | "failed">();
    const next = new Map([["0x1", "pending" as const]]);
    expect(detectTxSettlements(prev, next)).toEqual([]);
  });

  it("ignores tx that were already included before", () => {
    const prev = new Map([["0x1", "included" as const]]);
    const next = new Map([["0x1", "included" as const]]);
    expect(detectTxSettlements(prev, next)).toEqual([]);
  });

  it("does not re-flag an already included tx on a later pass", () => {
    // 一度 pending→included を検知したあと、prev が included になっていれば
    // 二度目は検知しない（フラッシュの二重再生防止）。
    const prev = new Map([["0x1", "included" as const]]);
    const next = new Map([["0x1", "included" as const]]);
    expect(detectTxSettlements(prev, next)).toEqual([]);
  });
});
