// Issue #364 の回帰テスト。出荷する profiles/ethereum/contracts/catalog.json の
// 内部整合性、特に「埋め込みソース（source.code）の symbol 定数」と「メタ情報
// （token.symbol / nft.symbol）」が一致していることを固定する。
//
// build-catalog.sh は symbol を 2 箇所に重複して持つ:
//   1. src/*.sol の `string public constant symbol = "..."`（catalog.json の
//      source.code へ全文埋め込まれる）
//   2. スクリプト内 add_entry 呼び出しの JSON リテラル（catalog.json の
//      token.symbol / nft.symbol になる）
// スクリプトのコメント自身が「ABI には出てこないのでソースを変えたらここも
// 手動で合わせて直す」と明記しているとおり、片方だけ更新して再生成すると
// source.code とメタ情報の symbol が静かに食い違う。collector はメタ情報側を
// ContractEntity.token / ContractEntity.nft へそのまま転記するため、乖離すると
// 「表示される symbol」と「ソース上の symbol」がユーザーに嘘をつく。
// この手動同期の破綻を捕まえる。
//
// catalog.test.ts が合成データでリーダー（readContractCatalog）の縮退挙動を
// 固めるのに対し、こちらは実際に出荷する catalog.json そのものの中身を検証する
// 別の関心事なので独立ファイルに置く（CLAUDE.md「1 ファイル 1 責務」）。

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readContractCatalog } from "./catalog.js";

/** このテストファイルの位置から上へたどって profiles/ethereum を探す。 */
function findProfileDir(): string {
  const relative = "profiles/ethereum/contracts/catalog.json";
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(resolve(dir, relative))) {
      return resolve(dir, "profiles/ethereum");
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`could not locate ${relative} above the test file`);
    }
    dir = parent;
  }
}

/** 埋め込みソースから `symbol` 定数の値を取り出す（複数あれば最初の 1 つ）。 */
function symbolConstantInSource(code: string): string | undefined {
  const match = code.match(
    /string\s+public\s+constant\s+symbol\s*=\s*"([^"]*)"/,
  );
  return match?.[1];
}

describe("shipped catalog.json symbol consistency (Issue #364)", () => {
  const catalog = readContractCatalog(findProfileDir(), (message, detail) => {
    throw new Error(`unexpected catalog read error: ${message} ${String(detail)}`);
  });

  it("loads the real catalog with the expected sample contract keys", () => {
    expect(catalog).toBeDefined();
    // 出荷カタログのキー集合を固定（欠落・混入の早期検出）。
    expect(Object.keys(catalog ?? {}).sort()).toEqual([
      "ChainvizNFT",
      "ChainvizToken",
      "Counter",
    ]);
  });

  it("keeps ChainvizToken's token.symbol equal to its embedded source's symbol constant", () => {
    const entry = catalog?.ChainvizToken;
    expect(entry?.token?.symbol).toBe("CVZDEMO");
    const sourceSymbol = symbolConstantInSource(entry?.source?.code ?? "");
    expect(sourceSymbol).toBe("CVZDEMO");
    // メタ情報とソース定数が同じ値を指すこと（手動同期の破綻ガード）。
    expect(entry?.token?.symbol).toBe(sourceSymbol);
  });

  it("keeps ChainvizNFT's nft.symbol equal to its embedded source's symbol constant", () => {
    const entry = catalog?.ChainvizNFT;
    expect(entry?.nft?.symbol).toBe("CVNDEMO");
    const sourceSymbol = symbolConstantInSource(entry?.source?.code ?? "");
    expect(sourceSymbol).toBe("CVNDEMO");
    expect(entry?.nft?.symbol).toBe(sourceSymbol);
  });

  it("does not ship a plain 'CVZ'/'CVN' ticker as any metadata symbol (Issue #364 intent)", () => {
    // Issue #364 の主眼は「一般的なティッカーに見える裸の CVZ/CVN を出荷表記から
    // 排除する」こと。メタ情報の symbol が旧表記へ戻っていないことを固定する。
    for (const entry of Object.values(catalog ?? {})) {
      expect(entry.token?.symbol).not.toBe("CVZ");
      expect(entry.token?.symbol).not.toBe("CVN");
      expect(entry.nft?.symbol).not.toBe("CVZ");
      expect(entry.nft?.symbol).not.toBe("CVN");
    }
  });

  it("has no entry carrying both token and nft metadata (quantity vs identity are exclusive)", () => {
    // symbol の置き場所（token か nft か）が両立していないことも合わせて固定する。
    for (const entry of Object.values(catalog ?? {})) {
      expect(entry.token !== undefined && entry.nft !== undefined).toBe(false);
    }
  });
});
