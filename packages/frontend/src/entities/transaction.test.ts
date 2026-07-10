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
  txChipLabel,
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

describe("txChipLabel (ARCHITECTURE.md §6.6 「意味」優先の tx チップ表示)", () => {
  it("prefers the decoded function name over everything else", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xhash",
      from: "0xa",
      to: "0xcontract",
      status: "included",
      contractCall: { contractAddress: "0xcontract", functionName: "transfer" },
      createdContractAddress: "0xshouldnotwin",
    };
    expect(txChipLabel(t)).toEqual({ kind: "function", text: "transfer" });
  });

  it("falls back to deploy when createdContractAddress is set and no function name is decoded", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xhash",
      from: "0xa",
      to: null,
      status: "included",
      createdContractAddress: "0xnewcontract",
    };
    expect(txChipLabel(t)).toEqual({ kind: "deploy", text: "" });
  });

  it("prefers deploy over an undecoded rawFunctionId when both happen to be present", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xhash",
      from: "0xa",
      to: null,
      status: "included",
      contractCall: { contractAddress: "0xcontract", rawFunctionId: "0xa9059cbb" },
      createdContractAddress: "0xnewcontract",
    };
    expect(txChipLabel(t)).toEqual({ kind: "deploy", text: "" });
  });

  it("labels a pending contract-creation tx as deploy before createdContractAddress is known (Issue #211)", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xhash",
      from: "0xa",
      to: null,
      status: "pending",
    };
    expect(txChipLabel(t)).toEqual({ kind: "deploy", text: "" });
  });

  it("labels a failed contract-creation tx as deploy even when createdContractAddress never arrived (Issue #211)", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xhash",
      from: "0xa",
      to: null,
      status: "failed",
    };
    expect(txChipLabel(t)).toEqual({ kind: "deploy", text: "" });
  });

  it("falls back to a shortened rawFunctionId when the call cannot be decoded and it is not a deploy", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xhash",
      from: "0xa",
      to: "0xunknown",
      status: "included",
      contractCall: { contractAddress: "0xunknown", rawFunctionId: "0xa9059cbb" },
    };
    expect(txChipLabel(t)).toEqual({ kind: "raw", text: "0xa9059cbb" });
  });

  it("falls back to the shortened tx hash for a plain transfer with no contract info", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: `0x${"1".repeat(64)}`,
      from: "0xa",
      to: "0xb",
      status: "pending",
    };
    expect(txChipLabel(t)).toEqual({
      kind: "hash",
      text: shortHex(t.hash, 4, 3),
    });
  });

  it("falls back to the shortened tx hash when contractCall exists but decodes nothing", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: `0x${"2".repeat(64)}`,
      from: "0xa",
      to: "0xcontract",
      status: "included",
      contractCall: { contractAddress: "0xcontract" },
    };
    expect(txChipLabel(t)).toEqual({
      kind: "hash",
      text: shortHex(t.hash, 4, 3),
    });
  });

  it("keeps the decoded function name even when to === null (function wins over the deploy branch)", () => {
    // to === null は deploy 判定に使うが、関数名が復号できていればそちらが
    // 最優先（意味優先）。両者が同時に立つのは理論上のみだが順序を固定しておく。
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xhash",
      from: "0xa",
      to: null,
      status: "pending",
      contractCall: { contractAddress: "0xcontract", functionName: "mint" },
    };
    expect(txChipLabel(t)).toEqual({ kind: "function", text: "mint" });
  });

  it("does NOT treat an empty-string `to` as a deploy (only null means contract creation)", () => {
    // 境界値: to === "" は null ではないため deploy 判定に落ちない。
    // 復号情報も無いので tx hash 短縮表示にフォールバックする（現状の仕様を固定）。
    const t: TransactionEntity = {
      kind: "transaction",
      hash: `0x${"3".repeat(64)}`,
      from: "0xa",
      to: "",
      status: "pending",
    };
    expect(txChipLabel(t)).toEqual({ kind: "hash", text: shortHex(t.hash, 4, 3) });
  });

  it("treats an empty-string `to` with a rawFunctionId as a raw call, not a deploy", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: `0x${"4".repeat(64)}`,
      from: "0xa",
      to: "",
      status: "included",
      contractCall: { contractAddress: "0xunknown", rawFunctionId: "0xa9059cbb" },
    };
    expect(txChipLabel(t)).toEqual({ kind: "raw", text: "0xa9059cbb" });
  });

  it("labels an included contract-creation tx as deploy from to === null alone (no createdContractAddress)", () => {
    // createdContractAddress が届く前でも to === null だけで deploy になる。
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xhash",
      from: "0xa",
      to: null,
      status: "included",
    };
    expect(txChipLabel(t)).toEqual({ kind: "deploy", text: "" });
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
