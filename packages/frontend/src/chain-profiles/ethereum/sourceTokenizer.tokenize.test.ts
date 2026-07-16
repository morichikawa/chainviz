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
