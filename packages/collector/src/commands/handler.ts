// フロントからの操作コマンド（ノード/ワークベンチの追加・削除）を、
// チェーン非依存の NodeLifecycle ポートへディスパッチする。WebSocket サーバー
// のような共通層はこの CommandHandler を呼ぶだけで、個々のコマンドの中身
// （Docker 操作）には立ち入らない。実処理は NodeLifecycle 実装が担う。

import type { Command } from "@chainviz/shared";
import type { CommandResult, NodeLifecycle } from "./lifecycle.js";

export class CommandHandler {
  constructor(private readonly lifecycle: NodeLifecycle) {}

  /**
   * コマンドを実行し、結果を返す。NodeLifecycle が投げた例外は
   * commandResult のエラーメッセージへ変換し、このメソッド自体は throw しない。
   */
  async handle(command: Command): Promise<CommandResult> {
    try {
      switch (command.action) {
        case "addNode":
          await this.lifecycle.addNode(command.chainProfile);
          return { ok: true };
        case "removeNode":
          await this.lifecycle.removeNode(command.nodeId);
          return { ok: true };
        case "addWorkbench":
          await this.lifecycle.addWorkbench(command.label);
          return { ok: true };
        case "removeWorkbench":
          await this.lifecycle.removeWorkbench(command.workbenchId);
          return { ok: true };
        case "runWorkbenchOperation": {
          const result = await this.lifecycle.runWorkbenchOperation(
            command.workbenchId,
            command.operation,
          );
          // 実際のワールドステートへの反映（tx の出現・確定、コントラクト
          // カードの出現）は、cast/forge の RPC 呼び出しがロギングプロキシを
          // 経由することで既存の観測経路（diff）から自然に届く
          // （docs/ARCHITECTURE.md §3）。commandResult には ok のみを返し、
          // 付随情報はここでログへ残すだけにとどめる。
          console.log(
            `[collector] workbench operation ${command.operation.type} on ${command.workbenchId} succeeded` +
              (result.txHash ? ` (tx ${result.txHash})` : "") +
              (result.deployedAddress
                ? ` (deployed to ${result.deployedAddress})`
                : ""),
          );
          return { ok: true };
        }
        default:
          return {
            ok: false,
            error: `unknown command action: ${
              (command as { action?: string }).action ?? "(none)"
            }`,
          };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
