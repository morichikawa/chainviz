// splitTokensIntoLines（Issue #321）の行分割に関するテスト。
// tokenizeSolidity 自体の分類テストは sourceTokenizer.tokenize.test.ts に
// 分ける（CLAUDE.md のテスト分割方針）。
import { describe, expect, it } from "vitest";
import {
  type SourceToken,
  splitTokensIntoLines,
  tokenizeSolidity,
} from "./sourceTokenizer.js";

describe("splitTokensIntoLines", () => {
  it("splits a single-line token stream into one line", () => {
    const tokens: SourceToken[] = [
      { kind: "keyword", text: "contract" },
      { kind: "plain", text: " " },
      { kind: "plain", text: "Counter" },
    ];
    expect(splitTokensIntoLines(tokens)).toEqual([
      [
        { kind: "keyword", text: "contract" },
        { kind: "plain", text: " " },
        { kind: "plain", text: "Counter" },
      ],
    ]);
  });

  it("produces one array entry per source line, matching code.split(\"\\n\").length", () => {
    const source = [
      "// SPDX-License-Identifier: MIT",
      "pragma solidity ^0.8.24;",
      "",
      "contract Counter {",
      "}",
    ].join("\n");
    const lines = splitTokensIntoLines(tokenizeSolidity(source));
    expect(lines).toHaveLength(source.split("\n").length);
  });

  it("represents a blank line as an empty array", () => {
    const lines = splitTokensIntoLines(tokenizeSolidity("a;\n\nb;"));
    expect(lines[1]).toEqual([]);
  });

  it("splits a token whose text embeds a newline (multi-line block comment) across line arrays", () => {
    // ブロックコメントは1トークンとして返る（tokenizeSolidity の仕様）が、
    // 表示のための行分割ではその \n をまたいで正しく2行に割れる必要がある。
    const tokens: SourceToken[] = [{ kind: "comment", text: "/* a\nb */" }];
    expect(splitTokensIntoLines(tokens)).toEqual([
      [{ kind: "comment", text: "/* a" }],
      [{ kind: "comment", text: "b */" }],
    ]);
  });

  it("returns a single empty line for an empty token stream (empty source)", () => {
    expect(splitTokensIntoLines([])).toEqual([[]]);
  });
});
