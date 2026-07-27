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

  it("rejects exactly Number.MAX_SAFE_INTEGER + 1 (boundary, one past the safe range)", () => {
    // 9007199254740992。Number としては表現できるが安全な整数ではないため、
    // 「安全な整数まで」の境界がちょうど1つ手前で切れていることを固定する。
    expect(parseBlockNumberInput("9007199254740992")).toBeUndefined();
  });

  it("rejects a value that silently rounds to a representable but unsafe integer", () => {
    // 9007199254740993 は Number 化すると 9007199254740992 に丸められる。
    // 丸め後の値で素通しせず拒否することを確認する。
    expect(parseBlockNumberInput("9007199254740993")).toBeUndefined();
  });

  it("rejects a digit string so long that Number() overflows to Infinity", () => {
    expect(parseBlockNumberInput("9".repeat(400))).toBeUndefined();
  });

  it("accepts leading zeros and normalizes them away", () => {
    expect(parseBlockNumberInput("007")).toBe(7);
  });

  it("accepts a string of only zeros as 0", () => {
    expect(parseBlockNumberInput("0000")).toBe(0);
  });

  it("accepts a safe value padded with many leading zeros (padding must not trip the safe-integer check)", () => {
    expect(parseBlockNumberInput(`${"0".repeat(30)}42`)).toBe(42);
  });

  it("trims tabs and newlines around the digits", () => {
    expect(parseBlockNumberInput("\n\t 42 \r\n")).toBe(42);
  });

  it("rejects a newline embedded inside the digits", () => {
    expect(parseBlockNumberInput("4\n2")).toBeUndefined();
  });

  it("trims a non-breaking space (pasted from rich text) around the digits", () => {
    expect(parseBlockNumberInput("\u00A042\u00A0")).toBe(42);
  });

  it("rejects full-width digits", () => {
    // `\d` は ASCII 数字のみにマッチする。IME 入力の全角数字は、
    // Number() では解釈できてしまうため regex 側で確実に弾く必要がある。
    expect(parseBlockNumberInput("４２")).toBeUndefined();
  });

  it("rejects non-ASCII (Arabic-Indic) digits", () => {
    expect(parseBlockNumberInput("٤٢")).toBeUndefined();
  });

  it("rejects a hexadecimal literal", () => {
    expect(parseBlockNumberInput("0x10")).toBeUndefined();
  });

  it("rejects digit separators and thousands separators", () => {
    expect(parseBlockNumberInput("1_000")).toBeUndefined();
    expect(parseBlockNumberInput("1,000")).toBeUndefined();
  });

  it("rejects the literal 'Infinity'", () => {
    expect(parseBlockNumberInput("Infinity")).toBeUndefined();
  });

  it("rejects a block-number-looking string with the '#' prefix used in the UI", () => {
    expect(parseBlockNumberInput("#42")).toBeUndefined();
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

  it("includes block number 0 as the minimum (must not treat 0 as 'no value')", () => {
    // 保持窓が genesis まで含む起動直後の状況。min の初期化を falsy 判定で
    // 書くと 0 が捨てられて min が 5 になってしまうため、その退行を検出する。
    const genesis = block({ hash: "0xgenesis", number: 0 });
    const later = block({ hash: "0xlater", number: 5 });
    expect(blockNumberRange(buildBlocksByHash([genesis, later]))).toEqual({
      min: 0,
      max: 5,
    });
  });

  it("returns the same range regardless of the insertion order", () => {
    const ascending = [
      block({ hash: "0xa", number: 100 }),
      block({ hash: "0xb", number: 115 }),
      block({ hash: "0xc", number: 131 }),
    ];
    const descending = [...ascending].reverse();
    expect(blockNumberRange(buildBlocksByHash(descending))).toEqual(
      blockNumberRange(buildBlocksByHash(ascending)),
    );
  });

  it("counts forked blocks that share a number without widening the range", () => {
    const forkA = block({ hash: "0xforka", number: 131, receivedAt: { node1: 1 } });
    const forkB = block({ hash: "0xforkb", number: 131, receivedAt: { node1: 2 } });
    const oldest = block({ hash: "0xoldest", number: 100 });
    expect(blockNumberRange(buildBlocksByHash([oldest, forkA, forkB]))).toEqual({
      min: 100,
      max: 131,
    });
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

  it("returns 'invalid' (not 'notFound') for a digits-only value beyond the safe integer range", () => {
    // 数字のみでも桁が大きすぎる場合は「入力のやり直し」を促すべきなので、
    // 保持範囲を提示する notFound ではなく invalid にする（両者の出し分け）。
    const target = block({ hash: "0xtarget", number: 55 });
    expect(resolveBlockJump("9007199254740992", buildBlocksByHash([target]))).toEqual({
      kind: "invalid",
    });
  });

  it("returns 'invalid' for an empty or whitespace-only string (the form filters these earlier, but the pure function must not throw)", () => {
    const target = block({ hash: "0xtarget", number: 55 });
    const map = buildBlocksByHash([target]);
    expect(resolveBlockJump("", map)).toEqual({ kind: "invalid" });
    expect(resolveBlockJump("   ", map)).toEqual({ kind: "invalid" });
  });

  it("finds a block through surrounding whitespace and leading zeros", () => {
    const target = block({ hash: "0xtarget", number: 7 });
    const map = buildBlocksByHash([target]);
    expect(resolveBlockJump("  007  ", map)).toEqual({ kind: "found", block: target });
  });

  it("finds block number 0 (must not treat 0 as an absent value)", () => {
    const genesis = block({ hash: "0xgenesis", number: 0 });
    const map = buildBlocksByHash([genesis, block({ hash: "0xlater", number: 1 })]);
    expect(resolveBlockJump("0", map)).toEqual({ kind: "found", block: genesis });
  });

  it("returns 'notFound' with the full range for a gap inside the retained range (missed observation)", () => {
    // 観測を取りこぼして番号が飛んでいる区間。範囲の内側でも見つからない
    // ことがあり、そのときも min/max はあくまで保持窓全体を示す。
    const a = block({ hash: "0xa", number: 100 });
    const b = block({ hash: "0xb", number: 131 });
    const map = buildBlocksByHash([a, b]);
    expect(resolveBlockJump("115", map)).toEqual({
      kind: "notFound",
      range: { min: 100, max: 131 },
    });
  });

  it("returns a degenerate min===max range when only one block is retained", () => {
    const only = block({ hash: "0xonly", number: 7 });
    expect(resolveBlockJump("8", buildBlocksByHash([only]))).toEqual({
      kind: "notFound",
      range: { min: 7, max: 7 },
    });
  });

  it("returns the fork tie-break winner for a forked number", () => {
    // 詳細な tie-break 規則と3実装の一致は blockDetail.jumpTieBreak.test.ts。
    // ここでは resolveBlockJump がその結果をそのまま通すことだけを見る。
    const early = block({ hash: "0xearly", number: 10, receivedAt: { node1: 100 } });
    const late = block({ hash: "0xlate", number: 10, receivedAt: { node1: 200 } });
    const map = buildBlocksByHash([early, late]);
    expect(resolveBlockJump("10", map)).toEqual({ kind: "found", block: late });
  });
});
