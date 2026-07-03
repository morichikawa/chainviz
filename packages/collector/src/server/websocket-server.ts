// フロントへワールドステートをプッシュする WebSocket サーバー。
// 接続時に全量スナップショットを1回送り、以後はポーリングごとの差分を配信する
// （docs/ARCHITECTURE.md §3 のプロトコル）。

import type {
  ClientMessage,
  DiffEvent,
  ServerMessage,
} from "@chainviz/shared";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { WorldStateStore } from "../world-state/store.js";

export class CollectorServer {
  private wss?: WebSocketServer;

  constructor(private readonly store: WorldStateStore) {}

  /** 指定ポートで待ち受ける。listening まで待つ。 */
  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port });
      wss.on("connection", (ws) => this.onConnection(ws));
      wss.once("listening", () => resolve());
      wss.once("error", (err) => reject(err));
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
    const snapshot: ServerMessage = {
      type: "snapshot",
      payload: this.store.getSnapshot(),
    };
    ws.send(JSON.stringify(snapshot));
    ws.on("message", (data) => this.onMessage(ws, data));
  }

  private onMessage(ws: WebSocket, data: RawData): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return; // 不正な JSON は無視する。
    }
    if (message?.type !== "command") return;

    // 操作コマンド（ノード/ワークベンチの追加・削除）は後続ステップで実装する。
    const result: ServerMessage = {
      type: "commandResult",
      commandId: message.commandId,
      ok: false,
      error: "command handling is not implemented yet",
    };
    ws.send(JSON.stringify(result));
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
