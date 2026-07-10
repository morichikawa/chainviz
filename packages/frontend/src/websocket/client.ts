import type { Command, DiffEvent, WorldStateSnapshot } from "@chainviz/shared";
import { parseServerMessage, serializeCommand } from "./messages.js";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/**
 * ブラウザ WebSocket の最小サブセット。テストで差し替えられるよう型を切り出す。
 */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: unknown) => void,
  ): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ChainvizClientHandlers {
  onSnapshot?: (payload: WorldStateSnapshot) => void;
  onDiff?: (events: DiffEvent[]) => void;
  onCommandResult?: (commandId: string, ok: boolean, error?: string) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
}

export interface ChainvizClientOptions extends ChainvizClientHandlers {
  url: string;
  /** WebSocket 生成関数（既定はブラウザの WebSocket）。テストで差し替える。 */
  createSocket?: WebSocketFactory;
  /** commandId 生成関数（既定は単調増加カウンタ）。 */
  generateCommandId?: () => string;
}

/**
 * collector との WebSocket 接続クライアント。protocol（packages/shared）の
 * ServerMessage / ClientMessage に従い、snapshot / diff / commandResult を
 * ハンドラへ振り分ける。フロント→collector へは操作コマンドを送る。
 *
 * 再接続やスナップショット再送はプロトコル未確定のため未実装
 * （ARCHITECTURE.md「未確定のまま残す項目」）。オフライン開発は
 * mockData の createMockClient を使う。
 */
export interface ChainvizClient {
  connect(): void;
  disconnect(): void;
  /**
   * 操作コマンドを送り、生成した commandId を返す。WebSocket が未接続
   * （`connect()` 未呼び出し、または close/error イベント後で socket が
   * 手放されている状態）の場合はコマンドを送らず `undefined` を返す
   * （Issue #235。以前は未接続でも commandId を発行して返してしまい、
   * 呼び出し側が「実際には送信されていない」ことを知る手段が無かった）。
   */
  sendCommand(command: Command): string | undefined;
  getStatus(): ConnectionStatus;
}

export function createChainvizClient(
  options: ChainvizClientOptions,
): ChainvizClient {
  const createSocket: WebSocketFactory =
    options.createSocket ?? ((url) => new WebSocket(url) as WebSocketLike);

  let counter = 0;
  const generateCommandId =
    options.generateCommandId ?? (() => `cmd-${++counter}`);

  let socket: WebSocketLike | null = null;
  let status: ConnectionStatus = "disconnected";

  function setStatus(next: ConnectionStatus) {
    if (status === next) return;
    status = next;
    options.onStatusChange?.(next);
  }

  function handleMessage(event: unknown) {
    const data = (event as { data?: unknown }).data;
    if (typeof data !== "string") return;
    const message = parseServerMessage(data);
    if (!message) return;

    switch (message.type) {
      case "snapshot":
        options.onSnapshot?.(message.payload);
        break;
      case "diff":
        options.onDiff?.(message.payload);
        break;
      case "commandResult":
        options.onCommandResult?.(
          message.commandId,
          message.ok,
          message.error,
        );
        break;
    }
  }

  return {
    connect() {
      if (socket) return;
      setStatus("connecting");
      socket = createSocket(options.url);
      socket.addEventListener("open", () => setStatus("connected"));
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("close", () => {
        socket = null;
        setStatus("disconnected");
      });
      socket.addEventListener("error", () => setStatus("disconnected"));
    },

    disconnect() {
      if (!socket) return;
      socket.close();
      socket = null;
      setStatus("disconnected");
    },

    sendCommand(command: Command): string | undefined {
      // 未接続（socket が無い）ならコマンドを発行せず、送れなかったことを
      // 呼び出し側に伝える（Issue #235）。
      if (!socket) return undefined;
      const commandId = generateCommandId();
      socket.send(serializeCommand(commandId, command));
      return commandId;
    },

    getStatus() {
      return status;
    },
  };
}
