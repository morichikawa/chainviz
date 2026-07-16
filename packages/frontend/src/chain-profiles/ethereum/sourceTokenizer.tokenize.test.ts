// tokenizeSolidity（Issue #321）の分類の正しさに関するテスト。
// splitTokensIntoLines / resolveSourceLines の関心は別ファイルに分ける
// （CLAUDE.md のテスト分割方針）。
import { describe, expect, it } from "vitest";
import { tokenizeSolidity } from "./sourceTokenizer.js";

/** トークン列を text だけの配列に潰す（アサーションを読みやすくする）。 */
function texts(code: string) {
  return tokenizeSolidity(code).map((t) => t.text);
}

describe("tokenizeSolidity", () => {
  it("classifies a line comment (including NatSpec ///)", () => {
    const tokens = tokenizeSolidity("// SPDX-License-Identifier: MIT");
    expect(tokens).toEqual([
      { kind: "comment", text: "// SPDX-License-Identifier: MIT" },
    ]);
    const natspec = tokenizeSolidity("/// @title Counter");
    expect(natspec[0]).toEqual({ kind: "comment", text: "/// @title Counter" });
  });

  it("classifies a block comment spanning multiple lines as one token", () => {
    const tokens = tokenizeSolidity("/* a\nb */");
    expect(tokens).toEqual([{ kind: "comment", text: "/* a\nb */" }]);
  });

  it("classifies double- and single-quoted strings, including escapes", () => {
    const tokens = tokenizeSolidity('"a \\"b\\" c"');
    expect(tokens).toEqual([{ kind: "string", text: '"a \\"b\\" c"' }]);
    expect(tokenizeSolidity("'single'")).toEqual([
      { kind: "string", text: "'single'" },
    ]);
  });

  it("classifies dotted version numbers (pragma) as one number token", () => {
    const tokens = tokenizeSolidity("^0.8.24");
    const numberToken = tokens.find((t) => t.kind === "number");
    expect(numberToken).toEqual({ kind: "number", text: "0.8.24" });
  });

  it("classifies known keywords", () => {
    for (const kw of ["contract", "function", "returns", "external", "emit"]) {
      const tokens = tokenizeSolidity(kw);
      expect(tokens).toEqual([{ kind: "keyword", text: kw }]);
    }
  });

  it("classifies known type names, including the full uintN/intN family", () => {
    expect(tokenizeSolidity("address")).toEqual([
      { kind: "type", text: "address" },
    ]);
    expect(tokenizeSolidity("uint256")).toEqual([
      { kind: "type", text: "uint256" },
    ]);
    expect(tokenizeSolidity("uint8")).toEqual([{ kind: "type", text: "uint8" }]);
    expect(tokenizeSolidity("mapping")).toEqual([
      { kind: "type", text: "mapping" },
    ]);
  });

  it("treats user-defined identifiers (contract/function/variable names) as plain", () => {
    expect(tokenizeSolidity("ChainvizToken")).toEqual([
      { kind: "plain", text: "ChainvizToken" },
    ]);
    expect(tokenizeSolidity("balanceOf")).toEqual([
      { kind: "plain", text: "balanceOf" },
    ]);
  });

  it("merges adjacent plain fragments (identifiers + punctuation/whitespace) into one token", () => {
    // "to, uint256 amount" は plain("to") + plain(", ") + type("uint256") +
    // plain(" ") + plain("amount") になりうるところを、隣接 plain 同士は
    // 1トークンへ連結する（無駄な span を増やさないための整形）。
    const tokens = tokenizeSolidity("to, uint256 amount");
    expect(tokens).toEqual([
      { kind: "plain", text: "to, " },
      { kind: "type", text: "uint256" },
      { kind: "plain", text: " amount" },
    ]);
  });

  it("round-trips: concatenating all token texts reproduces the original source exactly", () => {
    // splitTokensIntoLines（別ファイル）はこの前提（連結すると元のソースと
    // 一致する）に依存するため、ここで明示的に確認しておく。
    const source = [
      "// SPDX-License-Identifier: MIT",
      "pragma solidity ^0.8.24;",
      "",
      "contract Counter {",
      '    string public constant symbol = "CVZ";',
      "    uint256 public count;",
      "}",
      "",
    ].join("\n");
    expect(texts(source).join("")).toBe(source);
  });

  it("returns an empty array for an empty source (source: 空文字列)", () => {
    expect(tokenizeSolidity("")).toEqual([]);
  });
});

// 異常・境界的な入力（Solidity として不正だが、表示対象として渡されうる文字列）。
// トークナイザは「装飾」であり正しさの保証はしないが、（1）例外を投げない、
// （2）連結すると元のソースに一致する（splitTokensIntoLines が前提とする不変
// 条件）、（3）コメント・文字列の内側のキーワード風語を分類しない、の 3 点は
// 崩れてはならない。
describe("tokenizeSolidity (adversarial / malformed input)", () => {
  /** どんな入力でも「全 text を連結すると元のソースに一致する」不変条件を確認。 */
  function expectRoundTrip(code: string) {
    expect(texts(code).join("")).toBe(code);
  }

  it("does not classify keyword-like words inside a line comment", () => {
    const tokens = tokenizeSolidity("// contract function public");
    expect(tokens).toEqual([
      { kind: "comment", text: "// contract function public" },
    ]);
  });

  it("does not classify keyword-like words inside a string literal", () => {
    const tokens = tokenizeSolidity('"contract Foo public"');
    expect(tokens).toEqual([{ kind: "string", text: '"contract Foo public"' }]);
  });

  it("closes a nested-looking block comment at the first */ (Solidity does not nest comments)", () => {
    // Solidity のブロックコメントは入れ子非対応で、最初の */ で閉じる。
    // トークナイザも同じ挙動（最初の */ まで）にし、以降は通常のコードとして
    // 分類する。round-trip が保たれることも確認する。
    const code = "/* a /* b */ c */";
    const tokens = tokenizeSolidity(code);
    expect(tokens[0]).toEqual({ kind: "comment", text: "/* a /* b */" });
    expectRoundTrip(code);
  });

  it("degrades gracefully on an unterminated string (no throw, round-trip preserved)", () => {
    const code = '"abc';
    expect(() => tokenizeSolidity(code)).not.toThrow();
    // 閉じ引用符が無いので string トークンにはならない。
    expect(tokenizeSolidity(code).some((t) => t.kind === "string")).toBe(false);
    expectRoundTrip(code);
  });

  it("degrades gracefully on an unterminated block comment (no throw, round-trip preserved)", () => {
    const code = "/* abc";
    expect(() => tokenizeSolidity(code)).not.toThrow();
    expect(tokenizeSolidity(code).some((t) => t.kind === "comment")).toBe(false);
    expectRoundTrip(code);
  });

  it("does not treat a digit run glued to letters as a number token", () => {
    // "123abc" は \b 境界が無く number にならない。壊れず round-trip すること。
    const code = "123abc";
    expect(tokenizeSolidity(code).some((t) => t.kind === "number")).toBe(false);
    expectRoundTrip(code);
  });

  it("keeps tabs and non-ASCII (Unicode) text intact as plain, preserving round-trip", () => {
    const code = "uint256\t日本語 count; // café ☕";
    const tokens = tokenizeSolidity(code);
    expect(tokens[0]).toEqual({ kind: "type", text: "uint256" });
    // 非 ASCII 識別子（日本語）は識別子パターンに合致せず plain として残る。
    expect(tokens.some((t) => t.kind === "plain" && t.text.includes("日本語"))).toBe(
      true,
    );
    expectRoundTrip(code);
  });

  it("handles a string ending in an escaped backslash without swallowing the closing quote", () => {
    const code = '"a\\\\"';
    expect(tokenizeSolidity(code)).toEqual([{ kind: "string", text: code }]);
    expectRoundTrip(code);
  });
});
