import { describe, expect, it } from "vitest";
import { summarizeOperationError } from "./operation-error-summary.js";

// 以下のフィクスチャは、稼働中の chainviz-ethereum スタック
// （chainviz-ethereum-workbench-1）で実際に forge create / cast send を
// 不正な値で実行して得た生の stderr をそのまま使う（Issue #209 設計メモ
// 参照）。実運用で本当に出うる文言であることを担保するため、手で書いた
// 想像上の文言は使わない。

describe("summarizeOperationError / known patterns", () => {
  it("summarizes a forge create parser error for a non-numeric constructor arg (uint)", () => {
    const detail = "Error: parser error:\ntest\n^\nexpected at least one digit";
    expect(summarizeOperationError(detail)).toBe(
      'invalid argument value "test": not a non-negative integer',
    );
  });

  it("summarizes a cast send parser error for a non-numeric function arg (uint)", () => {
    const detail = "Error: parser error:\nnotanumber\n^\nexpected at least one digit";
    expect(summarizeOperationError(detail)).toBe(
      'invalid argument value "notanumber": not a non-negative integer',
    );
  });

  it("summarizes a parser error for a too-short address argument", () => {
    const detail = "Error: parser error:\n0xbadaddr\n^\ninvalid string length";
    expect(summarizeOperationError(detail)).toBe(
      'invalid argument value "0xbadaddr": not a 20-byte hex address (0x + 40 hex digits)',
    );
  });

  it("summarizes a parser error for an invalid boolean argument (caret indented)", () => {
    const detail = "Error: parser error:\nnotabool\n        ^\ninvalid boolean";
    expect(summarizeOperationError(detail)).toBe(
      'invalid argument value "notabool": not a boolean; expected true or false',
    );
  });

  it("prefers the nested parser error reason over the outer CLI wrapper (--value abc)", () => {
    // cast send --value abc ... の実際の生 stderr。CLI レベルの
    // "invalid value 'abc' for '--value <VALUE>':" の中に、より具体的な
    // "parser error:" の3行形式が入れ子になっている。
    const detail =
      "error: invalid value 'abc' for '--value <VALUE>': parser error:\nabc\n^\nexpected at least one digit\n\nFor more information, try '--help'.";
    expect(summarizeOperationError(detail)).toBe(
      'invalid argument value "abc": not a non-negative integer',
    );
  });

  it("summarizes a CLI-level invalid value error that never reaches the parser error stage", () => {
    // cast send ... 0xnotanaddress（TO位置引数）の実際の生 stderr。値が
    // 短すぎて clap の引数パーサーの時点で拒否され、"parser error:" には
    // 到達しない。
    const detail =
      "error: invalid value '0xnotanaddress' for '[TO]': invalid string length\n\nFor more information, try '--help'.";
    expect(summarizeOperationError(detail)).toBe(
      'invalid value "0xnotanaddress" for [TO]: not a 20-byte hex address (0x + 40 hex digits)',
    );
  });

  it("summarizes a function argument count mismatch (encode length mismatch)", () => {
    const detail = "Error: encode length mismatch: expected 2 types, got 1";
    expect(summarizeOperationError(detail)).toBe(
      "function argument count mismatch (expected 2, got 1)",
    );
  });

  it("summarizes a constructor argument count mismatch", () => {
    const detail = "Error: Constructor argument count mismatch: expected 1 but got 3";
    expect(summarizeOperationError(detail)).toBe(
      "constructor argument count mismatch (expected 1, got 3)",
    );
  });

  it("summarizes an on-chain revert with a custom require message", () => {
    const detail =
      'Error: Failed to estimate gas: server returned an error response: error code 3: execution reverted: ChainvizToken: transfer amount exceeds balance, data: "0x08c379a0...": Error("ChainvizToken: transfer amount exceeds balance")';
    expect(summarizeOperationError(detail)).toBe(
      "contract call reverted: ChainvizToken: transfer amount exceeds balance",
    );
  });

  it("summarizes a revert with no reason string", () => {
    const detail =
      'Error: Failed to estimate gas: server returned an error response: error code 3: execution reverted, data: "0x"';
    expect(summarizeOperationError(detail)).toBe(
      "contract call reverted (no reason returned)",
    );
  });

  it("summarizes insufficient native balance for a transfer", () => {
    const detail =
      "Error: Failed to estimate gas: server returned an error response: error code -32003: insufficient funds for gas * price + value: have 1000000000000000000000000000 want 999999999999999999999999999999999";
    expect(summarizeOperationError(detail)).toBe(
      "insufficient balance for this transaction (have 1000000000000000000000000000, need 999999999999999999999999999999999)",
    );
  });
});

describe("summarizeOperationError / wording variations (forge/cast version drift)", () => {
  it("handles a singular 'type' in the encode length mismatch (expected 1 type)", () => {
    // 引数が1つだけ不足した場合、forge は複数形 "types" ではなく単数形
    // "type" を出す。`types?` で両対応していることを確認する。
    const detail = "Error: encode length mismatch: expected 1 type, got 0";
    expect(summarizeOperationError(detail)).toBe(
      "function argument count mismatch (expected 1, got 0)",
    );
  });

  it("passes through an unknown parser-error reason instead of dropping the message", () => {
    // 既知の理由（"expected at least one digit" 等）に一致しない理由文言が
    // 将来のバージョンで出ても、パターン自体は検出できているので生の理由を
    // そのまま載せる（握りつぶさない）。
    const detail =
      "Error: parser error:\nweird\n^\nunexpected token while parsing value";
    expect(summarizeOperationError(detail)).toBe(
      'invalid argument value "weird": unexpected token while parsing value',
    );
  });

  it("passes through an unknown CLI-level invalid-value reason", () => {
    const detail =
      "error: invalid value 'xyz' for '--gas-limit <GAS_LIMIT>': some brand new reason\n\nFor more information, try '--help'.";
    expect(summarizeOperationError(detail)).toBe(
      'invalid value "xyz" for --gas-limit <GAS_LIMIT>: some brand new reason',
    );
  });

  it("tolerates CRLF line endings in a parser error (Windows-style forge output)", () => {
    const detail =
      "Error: parser error:\r\ntest\r\n^\r\nexpected at least one digit";
    expect(summarizeOperationError(detail)).toBe(
      'invalid argument value "test": not a non-negative integer',
    );
  });

  it("still summarizes a parser error when the caret column differs (deep indentation)", () => {
    const detail =
      "Error: parser error:\nverylongvalue\n            ^\ninvalid boolean";
    expect(summarizeOperationError(detail)).toBe(
      'invalid argument value "verylongvalue": not a boolean; expected true or false',
    );
  });

  it("summarizes an encode length mismatch reporting zero provided args", () => {
    const detail = "Error: encode length mismatch: expected 3 types, got 0";
    expect(summarizeOperationError(detail)).toBe(
      "function argument count mismatch (expected 3, got 0)",
    );
  });
});

describe("summarizeOperationError / unknown patterns (fallback)", () => {
  it("returns a short unrecognized message unchanged", () => {
    const detail = 'Error: "/contracts/nope.sol": No such file or directory (os error 2)';
    expect(summarizeOperationError(detail)).toBe(detail);
  });

  it("returns only the first line when the unrecognized message spans multiple lines", () => {
    const detail = "Error: something odd happened\nadditional stack trace line\nmore detail";
    expect(summarizeOperationError(detail)).toBe("Error: something odd happened");
  });

  it("truncates an unrecognized message longer than 200 characters with an ellipsis", () => {
    const longLine = "Error: " + "x".repeat(250);
    const result = summarizeOperationError(longLine);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBe(201); // 200 chars + ellipsis
    expect(longLine.startsWith(result.slice(0, -1))).toBe(true);
  });

  it("does not truncate a message exactly at the 200 character boundary", () => {
    const exactLine = "x".repeat(200);
    expect(summarizeOperationError(exactLine)).toBe(exactLine);
  });

  it("trims surrounding whitespace before evaluating patterns", () => {
    const detail = "  \n  exit code 2  \n  ";
    expect(summarizeOperationError(detail)).toBe("exit code 2");
  });

  it("falls back to the bare exit-code message unchanged (used when stderr/stdout are both empty)", () => {
    expect(summarizeOperationError("exit code 2")).toBe("exit code 2");
  });
});
