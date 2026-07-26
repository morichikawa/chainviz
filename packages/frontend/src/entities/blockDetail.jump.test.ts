// ブロック番号ジャンプ欄（Issue #428。ARCHITECTURE.md §18.3.1）の純粋な
// データ変換群のテスト。前後ナビゲーション・tx 一覧側のテストは
// blockDetail.test.ts に既にあり、このファイルはジャンプ機能に固有の関心事
// に絞る（CLAUDE.md のテスト分割方針）。
import type { BlockEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  blockNumberRange,
  buildBlocksByHash,
  findBlockByNumber,
  parseBlockNumberInput,
  resolveBlockJump,
} from "./blockDetail.js";

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 10,
    parentHash: "0xdefault-parent-placeholder",
    timestamp: 1_700_000_000,
    receivedAt: {},
    ...overrides,
  };
}

describe("parseBlockNumberInput", () => {
  it("parses a plain non-negative integer string", () => {
    expect(parseBlockNumberInput("42")).toBe(42);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(parseBlockNumberInput("  42  ")).toBe(42);
  });

  it("accepts zero", () => {
    expect(parseBlockNumberInput("0")).toBe(0);
  });

  it("rejects an empty string", () => {
    expect(parseBlockNumberInput("")).toBeUndefined();
  });

  it("rejects a string that is only whitespace", () => {
    expect(parseBlockNumberInput("   ")).toBeUndefined();
  });

  it("rejects a negative sign", () => {
    expect(parseBlockNumberInput("-1")).toBeUndefined();
  });

  it("rejects a leading plus sign", () => {
    expect(parseBlockNumberInput("+1")).toBeUndefined();
  });

  it("rejects a decimal point", () => {
    expect(parseBlockNumberInput("1.5")).toBeUndefined();
  });

  it("rejects exponent notation", () => {
    expect(parseBlockNumberInput("1e3")).toBeUndefined();
  });

  it("rejects whitespace embedded inside the digits", () => {
    expect(parseBlockNumberInput("1 2")).toBeUndefined();
  });

  it("rejects non-numeric characters", () => {
    expect(parseBlockNumberInput("abc")).toBeUndefined();
  });

  it("rejects a value exceeding Number.MAX_SAFE_INTEGER", () => {
    // MAX_SAFE_INTEGER = 9007199254740991. 1桁増やすと安全な整数の範囲を超える。
    expect(parseBlockNumberInput("90071992547409910")).toBeUndefined();
  });

  it("accepts Number.MAX_SAFE_INTEGER itself (boundary)", () => {
    expect(parseBlockNumberInput(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

describe("findBlockByNumber", () => {
  it("returns the block matching the given number", () => {
    const target = block({ hash: "0xtarget", number: 55 });
    const map = buildBlocksByHash([target]);
    expect(findBlockByNumber(55, map)).toBe(target);
  });

  it("returns undefined when no block has the given number", () => {
    const other = block({ hash: "0xother", number: 55 });
    const map = buildBlocksByHash([other]);
    expect(findBlockByNumber(999, map)).toBeUndefined();
  });

  it("returns undefined for an empty index", () => {
    expect(findBlockByNumber(1, buildBlocksByHash([]))).toBeUndefined();
  });

  it("breaks a same-number fork tie by the latest receipt time (later wins), same rule as findChildBlock", () => {
    const forkA = block({
      hash: "0xforka",
      number: 10,
      receivedAt: { node1: 100 },
    });
    const forkB = block({
      hash: "0xforkb",
      number: 10,
      receivedAt: { node1: 200 },
    });
    const map = buildBlocksByHash([forkA, forkB]);
    expect(findBlockByNumber(10, map)).toBe(forkB);
  });

  it("breaks a same-number fork tie by hash lexical order when receipt times are equal", () => {
    const forkHigh = block({
      hash: "0xffff",
      number: 10,
      receivedAt: { node1: 100 },
    });
    const forkLow = block({
      hash: "0x0001",
      number: 10,
      receivedAt: { node1: 100 },
    });
    const map = buildBlocksByHash([forkHigh, forkLow]);
    expect(findBlockByNumber(10, map)).toBe(forkLow);
  });
});

describe("blockNumberRange", () => {
  it("returns the min and max block numbers across the index", () => {
    const a = block({ hash: "0xa", number: 100 });
    const b = block({ hash: "0xb", number: 131 });
    const c = block({ hash: "0xc", number: 115 });
    const map = buildBlocksByHash([a, b, c]);
    expect(blockNumberRange(map)).toEqual({ min: 100, max: 131 });
  });

  it("returns the same number for both min and max when only one block is retained", () => {
    const only = block({ hash: "0xonly", number: 7 });
    const map = buildBlocksByHash([only]);
    expect(blockNumberRange(map)).toEqual({ min: 7, max: 7 });
  });

  it("returns undefined for an empty index", () => {
    expect(blockNumberRange(buildBlocksByHash([]))).toBeUndefined();
  });
});

describe("resolveBlockJump", () => {
  it("returns 'found' with the matching block for a valid, present number", () => {
    const target = block({ hash: "0xtarget", number: 55 });
    const map = buildBlocksByHash([target]);
    const result = resolveBlockJump("55", map);
    expect(result).toEqual({ kind: "found", block: target });
  });

  it("returns 'invalid' for a malformed number, without inspecting blocksByHash", () => {
    const target = block({ hash: "0xtarget", number: 55 });
    const map = buildBlocksByHash([target]);
    expect(resolveBlockJump("abc", map)).toEqual({ kind: "invalid" });
  });

  it("returns 'notFound' with the current retained range when the number is outside the window", () => {
    const a = block({ hash: "0xa", number: 100 });
    const b = block({ hash: "0xb", number: 131 });
    const map = buildBlocksByHash([a, b]);
    const result = resolveBlockJump("50", map);
    expect(result).toEqual({ kind: "notFound", range: { min: 100, max: 131 } });
  });

  it("falls back to a single-number range when blocksByHash is empty (defensive; callers only invoke this while a block is displayed)", () => {
    const result = resolveBlockJump("50", buildBlocksByHash([]));
    expect(result).toEqual({ kind: "notFound", range: { min: 50, max: 50 } });
  });
});
