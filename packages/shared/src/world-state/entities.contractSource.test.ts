// ContractEntity.sourceCode（カタログ同梱ソースの表示用フィールド。Issue #321）
// に関するテスト。entities.test.ts が肥大化しているため、関心事単位で
// ファイルを分ける（CLAUDE.md のテスト分割方針）。
import { describe, expect, it } from "vitest";
import type { ContractEntity, ContractSourceCode } from "./entities.js";

describe("ContractEntity.sourceCode (Issue #321)", () => {
  const source: ContractSourceCode = {
    fileName: "ChainvizToken.sol",
    language: "solidity",
    code: [
      "// SPDX-License-Identifier: MIT",
      "pragma solidity ^0.8.24;",
      "",
      "contract ChainvizToken {",
      '    string public constant symbol = "CVZ";',
      "}",
      "",
    ].join("\n"),
  };

  it("carries catalog-bundled source code across JSON, preserving newlines and quotes", () => {
    // collector → frontend は WebSocket 上で JSON にシリアライズされて渡る。
    // ソース全文（改行・引用符・インデントを含むテキスト）が往復で崩れない
    // ことを確認する。
    const contract: ContractEntity = {
      kind: "contract",
      address: "0x00000000000000000000000000000000000c0de",
      chainType: "ethereum",
      name: "ChainvizToken",
      catalogKey: "ChainvizToken",
      sourceCode: source,
    };
    const roundTripped = JSON.parse(JSON.stringify(contract)) as ContractEntity;
    expect(roundTripped.sourceCode?.fileName).toBe("ChainvizToken.sol");
    expect(roundTripped.sourceCode?.language).toBe("solidity");
    expect(roundTripped.sourceCode?.code).toBe(source.code);
    // 改行が保持され、行単位の表示（行番号付き）が成立する。
    expect(roundTripped.sourceCode?.code.split("\n").length).toBe(7);
  });

  it("treats an omitted sourceCode as unavailable (未知のコントラクト・旧スナップショット)", () => {
    // カタログ外のコントラクト・ソース未同梱のカタログエントリ・フィールド
    // 追加前の旧スナップショットでは省略される。JSON.stringify が undefined を
    // 落とすためキー自体が現れず、フロントは「ソースが手元に無いため表示
    // できない」ことを明示する側に安全に倒れる。
    const unknown: ContractEntity = {
      kind: "contract",
      address: "0x000000000000000000000000000000000000f00d",
      chainType: "ethereum",
      sourceCode: undefined,
    };
    const serialized = JSON.stringify(unknown);
    expect(serialized).not.toContain("sourceCode");
    const parsed = JSON.parse(serialized) as ContractEntity;
    expect(parsed.sourceCode).toBeUndefined();
  });

  it("keeps language as a raw string interpreted by the frontend representation set", () => {
    // language は生の識別子（OperationEdge.operation と同じ扱い）。表現セットが
    // 知らない値でも型として成立し、フロントはプレーンテキスト表示に倒せる。
    const exotic: ContractSourceCode = {
      fileName: "Example.vy",
      language: "vyper",
      code: "# pseudo",
    };
    const roundTripped = JSON.parse(
      JSON.stringify(exotic),
    ) as ContractSourceCode;
    expect(roundTripped.language).toBe("vyper");
  });

  it("accepts an empty source file (code: 空文字列) as present-but-empty, distinct from omission", () => {
    // code が空文字列でも「ソースはあるが中身が空」として成立する境界。
    // 省略（sourceCode 自体が無い = 手元に無い）と意味が異なることを確認する。
    const empty: ContractSourceCode = {
      fileName: "Empty.sol",
      language: "solidity",
      code: "",
    };
    const contract: ContractEntity = {
      kind: "contract",
      address: "0x00000000000000000000000000000000000c0de",
      chainType: "ethereum",
      sourceCode: empty,
    };
    const roundTripped = JSON.parse(JSON.stringify(contract)) as ContractEntity;
    expect(roundTripped.sourceCode).not.toBeUndefined();
    expect(roundTripped.sourceCode?.code).toBe("");
  });
});
