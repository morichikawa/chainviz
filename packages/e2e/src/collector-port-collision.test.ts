// collector 子プロセスの起動が「自分が実際にポートを listen できたか」を
// 正しく判定することを、実際に collector を起動して検証する回帰テスト
// （Issue #64）。
//
// 修正前は WebSocket 接続が張れるかどうかだけで起動成功を判定していたため、
// 別プロセス（別 worktree の test:e2e など）が既に同じポートで listen して
// いる場合、自分の子プロセスが EADDRINUSE で即死していても誤って「起動
// できた」と判定し、他人の collector に誤接続してしまっていた。
//
// ここでは実際に同じポートへ 2 つの collector を起動させ、後発が明確な
// エラーで即座に失敗すること（タイムアウトを待たされないこと）、かつ
// 先発の起動には影響しないことを確認する。
// Docker 自体には依存しない（collector の起動・ポート確保のみを見る）ため
// チェーンの進行を待つ必要はないが、collector プロセス自体は Docker
// ポーリングを行うため Docker が使える環境が前提（他の E2E テストと同様）。

import { describe, expect, it } from "vitest";
import { startCollector } from "./helpers/collector.js";

// 他の E2E テストが使う既定ポート（4123）とは別の専用ポートを使い、
// このテストの意図（ポート衝突の再現）以外の要因で影響し合わないようにする。
const COLLISION_TEST_PORT = 4199;

describe("collector 起動のポート衝突 (Issue #64)", () => {
  it(
    "同じポートで2つ目を起動しようとすると明確なエラーで即座に失敗し、先発の起動は影響を受けない",
    async () => {
      const first = await startCollector(COLLISION_TEST_PORT);
      try {
        const start = Date.now();
        await expect(startCollector(COLLISION_TEST_PORT)).rejects.toThrow(
          /EADDRINUSE|同時に複数実行/,
        );
        const elapsedMs = Date.now() - start;
        // 旧実装は canConnect のポーリングで最大 30s のタイムアウトを待って
        // いた。修正後は自プロセスの EADDRINUSE ログで即座に検知できるので、
        // 十分短い時間で失敗することを確認する（タイムアウト分岐に戻る
        // リグレッションを検出するため）。
        expect(elapsedMs).toBeLessThan(10_000);

        // 先発の collector プロセスはまだ生きており、引き続き使える。
        expect(first.process.exitCode).toBeNull();
      } finally {
        await first.stop();
      }
    },
    30_000,
  );
});
