// resolveSourceLines（Issue #321。ContractSourceCode.language からの
// トークナイザ解決 + 行分割）のテスト。tokenizeSolidity /
// splitTokensIntoLines 自体のテストは別ファイルに分ける
// （CLAUDE.md のテスト分割方針）。
import { describe, expect, it } from "vitest";
import { resolveSourceLines } from "./sourceTokenizer.js";

describe("resolveSourceLines", () => {
  it("highlights solidity source with classified tokens", () => {
    const lines = resolveSourceLines("uint256 public count;", "solidity");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContainEqual({ kind: "type", text: "uint256" });
    expect(lines[0]).toContainEqual({ kind: "keyword", text: "public" });
  });

  it("falls back to undecorated plain lines for a language it does not know (Issue #321 §12.4 fallback)", () => {
    const lines = resolveSourceLines("# comment\nprint(1)", "vyper");
    expect(lines).toEqual([
      [{ kind: "plain", text: "# comment" }],
      [{ kind: "plain", text: "print(1)" }],
    ]);
  });

  it("still splits an unknown-language source into the correct number of lines", () => {
    const source = "line1\nline2\nline3";
    const lines = resolveSourceLines(source, "rust");
    expect(lines).toHaveLength(3);
  });

  it("returns a single empty line for an empty source, regardless of language", () => {
    expect(resolveSourceLines("", "solidity")).toEqual([[]]);
    expect(resolveSourceLines("", "vyper")).toEqual([[]]);
  });
});
