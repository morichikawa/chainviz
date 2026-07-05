// reth などの Execution Layer クライアントへ WebSocket JSON-RPC で接続し、
// eth_subscribe(newHeads / newPendingTransactions) を購読する部分。ws への
// 依存と JSON-RPC の語彙（eth_subscribe / eth_subscription）はこのファイル
// （ChainAdapter 実装の内側）に閉じ込める。上位ロジックは EthWsClient
// インターフェースだけに依存し、実ノードなしでテストできる。

import { WebSocket } from "ws";

/** newHeads 通知に含まれるブロックヘッダ（必要な部分のみ、いずれも 16 進数文字列）。 */
export interface NewHeadHeader {
  hash: string;
  number: string;
  parentHash: string;
  timestamp: string;
}

/** 購読ハンドル。close() で購読を解除する。 */
export interface Subscription {
  close(): void;
}

/** newHeads 購読ハンドル（後方互換の別名）。 */
export type NewHeadsSubscription = Subscription;

/** newPendingTransactions 購読ハンドル（後方互換の別名）。 */
export type PendingTxSubscription = Subscription;

export interface EthWsClient {
  /**
   * 指定 WebSocket URL へ接続して newHeads を購読する。ヘッダを受信するたびに
   * onHeader を呼ぶ。接続・購読エラーは onError に渡す。
   */
  subscribeNewHeads(
    wsUrl: string,
    onHeader: (header: NewHeadHeader) => void,
    onError?: (err: unknown) => void,
  ): NewHeadsSubscription;

  /**
   * 指定 WebSocket URL へ接続して newPendingTransactions を購読する。mempool に
   * 入った tx のハッシュを受信するたびに onTxHash を呼ぶ。reth の既定では通知
   * ペイロードは tx ハッシュ（16 進数文字列）のみで、from/to 等の詳細は含まない
   * ため、詳細は呼び出し側が別途 HTTP JSON-RPC で取得する。
   */
  subscribePendingTransactions(
    wsUrl: string,
    onTxHash: (hash: string) => void,
    onError?: (err: unknown) => void,
  ): PendingTxSubscription;
}

interface JsonRpcMessage {
  id?: number;
  result?: unknown;
  method?: string;
  params?: { subscription?: string; result?: unknown };
}

/**
 * WebSocket から届いた 1 フレームを解釈し、eth_subscription 通知であれば
 * その result（newHeads ならヘッダ、newPendingTransactions なら tx ハッシュ）を
 * 返す。通知でない・解釈できない・result が無い場合は undefined を返す。
 * ソケット配線から切り離した純粋関数にしてテスト可能にする。
 */
export function parseSubscriptionResult(raw: string): unknown | undefined {
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(raw) as JsonRpcMessage;
  } catch {
    return undefined;
  }
  if (message.method !== "eth_subscription") return undefined;
  const result = message.params?.result;
  return result === undefined ? undefined : result;
}

/**
 * eth_subscribe の共通配線。指定 URL へ接続し subscribeParams で購読を開始、
 * 通知が届くたびに onResult を呼ぶ。newHeads / newPendingTransactions で
 * subscribeParams と result の型だけが異なるので、この関数に集約する。
 */
function subscribe<T>(
  wsUrl: string,
  subscribeParams: unknown[],
  onResult: (result: T) => void,
  onError?: (err: unknown) => void,
): Subscription {
  const socket = new WebSocket(wsUrl);

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_subscribe",
        params: subscribeParams,
      }),
    );
  });

  socket.on("message", (data) => {
    const result = parseSubscriptionResult(data.toString());
    if (result !== undefined) onResult(result as T);
  });

  socket.on("error", (err) => onError?.(err));

  return {
    close(): void {
      socket.close();
    },
  };
}

/** ws パッケージを用いた EthWsClient 実装。 */
export function createWsEthClient(): EthWsClient {
  return {
    subscribeNewHeads(wsUrl, onHeader, onError) {
      return subscribe<NewHeadHeader>(wsUrl, ["newHeads"], onHeader, onError);
    },
    subscribePendingTransactions(wsUrl, onTxHash, onError) {
      return subscribe<string>(
        wsUrl,
        ["newPendingTransactions"],
        onTxHash,
        onError,
      );
    },
  };
}
