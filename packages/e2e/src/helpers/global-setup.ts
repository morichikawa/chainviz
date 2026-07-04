// vitest の globalSetup。test:e2e 実行全体（全テストファイル）に対して
// 一度だけ呼ばれ、返した関数が全テスト終了後に一度だけ呼ばれる。
//
// ここでホスト単位の排他ロックを取得することで、同一ホスト上で複数の
// test:e2e（別 worktree・別ブランチ・別ターミナルからの実行を含む）が
// 同時に docker compose スタック / collector ポートを奪い合う事故を防ぐ
// （Issue #64）。collector.ts 側の起動判定修正だけでは「2つの test:e2e が
// 同時に docker compose を操作し合う」問題までは防げないため、実行そのものを
// 先着1本に制限する。

import { acquireE2eLock, DEFAULT_LOCK_PATH, type E2eLock } from "./e2e-lock.js";

export default function globalSetup(): () => void {
  let lock: E2eLock;
  try {
    lock = acquireE2eLock();
  } catch (err) {
    // vitest の globalSetup が例外を投げるとテスト実行全体が即座に失敗する。
    // ここでは「タイムアウトで分かりにくく失敗する」のではなく、原因が
    // 一目で分かるエラーメッセージのまま伝播させる。
    console.error(
      `[e2e] test:e2e の排他ロックを取得できませんでした(${DEFAULT_LOCK_PATH}):`,
    );
    throw err;
  }

  return () => {
    lock.release();
  };
}
