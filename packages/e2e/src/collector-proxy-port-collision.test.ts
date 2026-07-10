// collector 子プロセスの起動判定が、ロギングプロキシ側だけのポート衝突も
// 正しく検知できることを、実際に collector を起動して検証する回帰テスト
// （Issue #254）。
//
// `collector-port-collision.test.ts`（Issue #64）は WebSocket サーバーの
// ポート衝突を検証する。今回のケースはそれとは独立した衝突経路で、
// WebSocket サーバーは自分専用の空きポートで listen できてしまうため、
// 修正前の実装（listening ログを WS 側だけで判定していた）だと「起動
// 成功」と誤判定した直後に子プロセスがロギングプロキシの EADDRINUSE で
// 実際にはクラッシュしていた（`docs/worklog/issue-254.md` に実測ログを
// 記録）。ここでは WS ポートは重複させず、ロギングプロキシのポートだけを
// 意図的に衝突させ、startCollector が即座に明確なエラーで失敗すること
// （誤って resolve しないこと）を確認する。
//
// Docker 自体には依存しない（collector の起動・ポート確保のみを見る）ため
// チェーンの進行を待つ必要はないが、collector プロセス自体は Docker
// ポーリングを行うため Docker が使える環境が前提（他の E2E テストと同様）。

import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { startCollector } from "./helpers/collector.js";

// 他の E2E テストが使う既定ポート群（4123 / 4125 / 4199 等）とは別の
// 専用ポートを使い、このテストの意図（ロギングプロキシのポート衝突の再現）
// 以外の要因で影響し合わないようにする。
const CHILD_WS_PORT = 4210;
const COLLIDING_PROXY_PORT = 4211;

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve());
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("collector 起動のロギングプロキシポート衝突 (Issue #254)", () => {
  it(
    "WebSocketは空きポートでlistenできても、ロギングプロキシのポートが専有されていれば起動失敗として検知する",
    async () => {
      // 子プロセスが使うはずのロギングプロキシポートを先に別プロセス相当の
      // リスナーで専有しておく（dev collector や別 worktree の collector が
      // 同じポートを使っている状況を模す）。
      const occupier = createServer();
      await listen(occupier, COLLIDING_PROXY_PORT);

      try {
        const start = Date.now();
        await expect(
          startCollector(CHILD_WS_PORT, COLLIDING_PROXY_PORT),
        ).rejects.toThrow(/EADDRINUSE/);
        const elapsedMs = Date.now() - start;
        // 修正前は WS 側の listening ログだけで「起動成功」と確定させて
        // しまい、この呼び出しは resolve していた（=誤って生きていない
        // collector を「使える」ものとして呼び出し元へ返してしまっていた）。
        // 修正後は EADDRINUSE を検知して短時間で reject する。
        expect(elapsedMs).toBeLessThan(10_000);
      } finally {
        await close(occupier);
      }
    },
    30_000,
  );
});
