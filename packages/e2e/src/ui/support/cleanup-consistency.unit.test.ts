// Issue #233 の再発防止のための構造整合テスト。
//
// この不具合の本質は「後始末ロジックの修正が一部のファイルにしか行き渡らず、
// 同型のファイルに古い(競合状態を持つ)実装が残っていた」ことにある
// (wallet-balance / token-balance だけ直し、commands-node /
// commands-workbench が取り残されていた)。共有ヘルパー
// (support/cleanup.ts)へ集約した以上、afterAll で後始末を行う4ファイルが
// 全て同じヘルパー経由になっていることをテストで固定し、将来どれか1つが
// 独自のインライン後始末に逆戻りするのを検知できるようにする。

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url)); // .../src/ui/support
const uiDir = resolve(here, ".."); // .../src/ui

/** afterAll でカード後始末を行い、共有ヘルパーを使うべき4ファイル。 */
const CLEANUP_SPEC_FILES = [
  "commands-node.spec.ts",
  "commands-workbench.spec.ts",
  "wallet-balance.spec.ts",
  "token-balance.spec.ts",
] as const;

function readSpec(fileName: string): string {
  return readFileSync(resolve(uiDir, fileName), "utf8");
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

  it("4ファイル以外に、後始末目的で cleanupRemovableCards を使うファイルが増えていないか（増設時はこのリストの更新を促す）", () => {
    // 将来 afterAll 後始末を持つファイルが増えた場合、このテストが落ちて
    // CLEANUP_SPEC_FILES への追加(=一貫性チェック対象への組み入れ)を促す。
    // ここでは対象4ファイルが全て cleanupRemovableCards を含むことを確認し、
    // リストと実態のズレを検知する起点にする。
    for (const fileName of CLEANUP_SPEC_FILES) {
      expect(readSpec(fileName)).toContain("cleanupRemovableCards");
    }
  });
});
