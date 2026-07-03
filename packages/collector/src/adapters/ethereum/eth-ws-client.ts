// reth などの Execution Layer クライアントへ WebSocket JSON-RPC で接続し、
// eth_subscribe(newHeads) を購読する部分。ws への依存と JSON-RPC の
// 語彙（eth_subscribe / eth_subscription）はこのファイル（ChainAdapter 実装の
// 内側）に閉じ込める。上位ロジックは EthWsClient インターフェースだけに依存し、
// 実ノードなしでテストできる。

import { WebSocket } from "ws";

/** newHeads 通知に含まれるブロックヘッダ（必要な部分のみ、いずれも 16 進数文字列）。 */
export interface NewHeadHeader {
  hash: string;
  number: string;
  parentHash: string;
  timestamp: string;
}

/** 購読ハンドル。close() で購読を解除する。 */
export interface NewHeadsSubscription {
  close(): void;
}

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
}

interface JsonRpcMessage {
  id?: number;
  result?: unknown;
  method?: string;
  params?: { subscription?: string; result?: NewHeadHeader };
}

/** ws パッケージを用いた EthWsClient 実装。 */
export function createWsEthClient(): EthWsClient {
  return {
    subscribeNewHeads(wsUrl, onHeader, onError) {
      const socket = new WebSocket(wsUrl);

      socket.on("open", () => {
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_subscribe",
            params: ["newHeads"],
          }),
        );
      });

      socket.on("message", (data) => {
        let message: JsonRpcMessage;
        try {
          message = JSON.parse(data.toString()) as JsonRpcMessage;
        } catch {
          return;
        }
        if (message.method === "eth_subscription" && message.params?.result) {
          onHeader(message.params.result);
        }
      });

      socket.on("error", (err) => onError?.(err));

      return {
        close(): void {
          socket.close();
        },
      };
    },
  };
}
