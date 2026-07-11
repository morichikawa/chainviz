// Issue #233 の再発防止のための構造整合テスト。
//
// この不具合の本質は「後始末ロジックの修正が一部のファイルにしか行き渡らず、
// 同型のファイルに古い(競合状態を持つ)実装が残っていた」ことにある
// (wallet-balance / token-balance だけ直し、commands-node /
// commands-workbench / multi-client が取り残されていた)。共有ヘルパー
// (support/cleanup.ts)へ集約した以上、afterAll で後始末を行うファイルが
// 全て同じヘルパー経由になっていることをテストで固定し、将来どれか1つが
// 独自のインライン後始末に逆戻りするのを検知できるようにする。

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url)); // .../src/ui/support
const uiDir = resolve(here, ".."); // .../src/ui

/** afterAll でカード後始末を行い、共有ヘルパーを使うべきファイル。 */
const CLEANUP_SPEC_FILES = [
  "commands-node.spec.ts",
  "commands-workbench.spec.ts",
  "multi-client.spec.ts",
  "wallet-balance.spec.ts",
  "token-balance.spec.ts",
] as const;

function readSpec(fileName: string): string {
  return readFileSync(resolve(uiDir, fileName), "utf8");
}

/** `src/ui/` 直下の `*.spec.ts` ファイル名一覧(support/ 等のサブディレクトリは対象外)。 */
function listSpecFiles(): string[] {
  return readdirSync(uiDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
    .map((entry) => entry.name);
}

/**
 * ソース中の最初の `test.afterAll(...)` 呼び出しの本体（コールバックの
 * `{ ... }` ブロック）を波括弧の対応関係を辿って取り出す。無ければ `null`。
 *
 * 正規表現1発で終端の `}` を決め打つと、本体内の `if`/`for`/`try` が持つ
 * 入れ子の `}` に引きずられて誤検知しうるため、開き括弧からの深さで
 * 対応する閉じ括弧を探す。
 */
function extractAfterAllBody(source: string): string | null {
  const callIdx = source.indexOf("test.afterAll(");
  if (callIdx === -1) return null;
  const arrowIdx = source.indexOf("=>", callIdx);
  if (arrowIdx === -1) return null;
  const braceStart = source.indexOf("{", arrowIdx);
  if (braceStart === -1) return null;

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null; // 対応する閉じ括弧が見つからない(壊れた構文)
}

/**
 * ファイルが「afterAll でカード削除の後始末を行っている」とみなせるか判定する。
 *
 * 共有ヘルパー(`cleanupRemovableCards`)経由の後始末だけでなく、旧不具合の
 * 温床だった `infra-card-remove-` への直接クリック(インライン後始末への
 * 逆戻り)も検知対象に含める。どちらも afterAll 本体に現れるはずのため、
 * 本体を切り出した上でこの2パターンのいずれかを含むかで判定する。
 */
function performsCardCleanupInAfterAll(source: string): boolean {
  const body = extractAfterAllBody(source);
  if (body === null) return false;
  return body.includes("cleanupRemovableCards") || body.includes("infra-card-remove-");
}

describe("afterAll 後始末の共有ヘルパー適用の一貫性(Issue #233 再発防止)", () => {
  it.each(CLEANUP_SPEC_FILES)(
    "%s は共有ヘルパー support/cleanup.js から cleanupRemovableCards を import している",
    (fileName) => {
      const source = readSpec(fileName);
      expect(source).toContain(
        'import { cleanupRemovableCards } from "./support/cleanup.js"',
      );
    },
  );

  it.each(CLEANUP_SPEC_FILES)(
    "%s は afterAll 内で cleanupRemovableCards(browser, ...) を呼び出している",
    (fileName) => {
      const source = readSpec(fileName);
      expect(source).toContain("test.afterAll(async ({ browser }) =>");
      expect(source).toMatch(/cleanupRemovableCards\(\s*browser,/);
    },
  );

  it.each(CLEANUP_SPEC_FILES)(
    "%s の afterAll は独自の即時 count() 判定によるインライン後始末を持たない",
    (fileName) => {
      const source = readSpec(fileName);
      // 旧不具合の温床だった「afterAll 内で削除ボタンの count() を即時判定」
      // パターンが残っていないことを確認する。削除ボタンの待機/クリック/
      // 消滅待ちは全て support/cleanup.ts に集約されているべき。
      expect(source).not.toMatch(/infra-card-remove-\$\{[^}]+\}`\)\.count\(\)/);
    },
  );

  it("src/ui/ 配下を実走査し、afterAll でカード後始末を行うファイルの集合が CLEANUP_SPEC_FILES と一致する", () => {
    // リストを固定した再読ではなく、ディレクトリを実際に走査して afterAll
    // 本体の中身から後始末の有無を判定する。これにより、共有ヘルパーへ
    // 未移行のファイル(例: 過去に multi-client.spec.ts が旧インライン
    // 実装のまま取り残されていたケース)が新規に増えても、このテストが
    // 実際に検知できる。
    const detected = listSpecFiles()
      .filter((fileName) => performsCardCleanupInAfterAll(readSpec(fileName)))
      .sort();
    const expected = [...CLEANUP_SPEC_FILES].sort();
    expect(detected).toEqual(expected);
  });
});
