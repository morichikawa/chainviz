// フロントへワールドステートをプッシュする WebSocket サーバー。
// 接続時に全量スナップショットを1回送り、以後はポーリングごとの差分を配信する
// （docs/ARCHITECTURE.md §3 のプロトコル）。

import type {
  ClientMessage,
  Command,
  DiffEvent,
  ServerMessage,
} from "@chainviz/shared";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { CommandResult } from "../commands/lifecycle.js";
import type { WorldStateStore } from "../world-state/store.js";

/** 操作コマンドを処理して結果を返すもの（commands/handler.ts が実装）。 */
export interface CommandProcessor {
  handle(command: Command): Promise<CommandResult>;
}

/** 発生源が特定できるソケット/サーバーのエラーをログに残す関数。 */
export type ServerLogger = (message: string, detail: unknown) => void;

const defaultLog: ServerLogger = (message, detail) =>
  console.error(message, detail);

export class CollectorServer {
  private wss?: WebSocketServer;

  constructor(
    private readonly store: WorldStateStore,
    private readonly commands?: CommandProcessor,
    private readonly log: ServerLogger = defaultLog,
  ) {}

  /** 指定ポートで待ち受ける。listening まで待つ。 */
  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port });
      wss.on("connection", (ws) => this.onConnection(ws));

      // 起動時のエラー（ポート衝突など）は listen() を reject する。
      const onStartupError = (err: Error): void => reject(err);
      wss.once("error", onStartupError);

      wss.once("listening", () => {
        // 起動が済んだら reject 用ハンドラを外し、以後のサーバーレベル
        // エラーは恒久的にログへ流すハンドラに付け替える。error リスナーが
        // 未登録のまま発火すると EventEmitter の規約で throw され、
        // プロセス全体の安全網（index.ts の installProcessSafetyNet）に
        // 流れてしまうため（Issue #68）。
        wss.removeListener("error", onStartupError);
        wss.on("error", (err) =>
          this.log("[collector] websocket server error:", err),
        );
        resolve();
      });
      this.wss = wss;
    });
  }

  /** 実際に割り当てられた待ち受けポートを返す（テスト用に port:0 を許すため）。 */
  get address(): { port: number } | null {
    const addr = this.wss?.address();
    if (addr && typeof addr === "object") return { port: addr.port };
    return null;
  }

  private onConnection(ws: WebSocket): void {
    // ソケットレベルのエラー（クライアントの突然切断による ECONNRESET 等）を
    // 接続単位で受け止める。error リスナー未登録のまま error が発火すると
    // EventEmitter の規約で throw され、発生源が特定できるにもかかわらず
    // プロセス全体の安全網（index.ts の installProcessSafetyNet）に流れて
    // しまい、ws 内部の後始末を含む呼び出しスタックを中断する（Issue #68）。
    ws.on("error", (err) =>
      this.log("[collector] websocket connection error:", err),
    );
    const snapshot: ServerMessage = {
      type: "snapshot",
      payload: this.store.getSnapshot(),
    };
    ws.send(JSON.stringify(snapshot));
    ws.on("message", (data) => void this.onMessage(ws, data));
  }

  private async onMessage(ws: WebSocket, data: RawData): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return; // 不正な JSON は無視する。
    }
    if (message?.type !== "command") return;

    // 操作コマンド（ノード/ワークベンチの追加・削除）を処理する。実際の
    // ワールドステートへの反映は後続のポーリング差分で届く（コマンド自体は
    // store を直接書き換えない。docs/ARCHITECTURE.md §3）。
    const result = await this.runCommand(message.command);
    const reply: ServerMessage = {
      type: "commandResult",
      commandId: message.commandId,
      ok: result.ok,
      error: result.error,
    };
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
  }

  private async runCommand(command: Command): Promise<CommandResult> {
    if (!this.commands) {
      return { ok: false, error: "command handling is not available" };
    }
    return this.commands.handle(command);
  }

  /** 差分を全接続クライアントへ配信する。差分が空なら何もしない。 */
  broadcastDiff(events: DiffEvent[]): void {
    if (events.length === 0 || !this.wss) return;
    const message: ServerMessage = { type: "diff", payload: events };
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  /** サーバーを閉じる。 */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.wss) {
        resolve();
        return;
      }
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
