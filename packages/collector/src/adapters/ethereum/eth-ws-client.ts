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
   * onHeader を呼ぶ。接続・購読エラーは onError に渡す。接続が切断された場合は
   * 呼び出し側が close() していない限り自動で再接続・再購読する
   * （詳細は subscribe() のコメントを参照）。
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
   * ため、詳細は呼び出し側が別途 HTTP JSON-RPC で取得する。接続が切断された
   * 場合の自動再接続は subscribeNewHeads と同様（subscribe() のコメント参照）。
   */
  subscribePendingTransactions(
    wsUrl: string,
    onTxHash: (hash: string) => void,
    onError?: (err: unknown) => void,
  ): PendingTxSubscription;
}

/**
 * 切断検知から再接続を試みるまでの待機時間（ミリ秒）。
 *
 * 前提・根拠（Issue #135）: この値は「docker compose でノードコンテナが
 * 再作成される」という chainviz 特有の運用シナリオ（学習用にコンテナを
 * 手動で作り直す）を想定して決めた固定値。同一ホスト上の Docker
 * コンテナ再作成（stop → rm → create → start → プロセス起動）は通常
 * 数秒〜十数秒で完了するため、2 秒間隔であれば数回の試行で復旧できる。
 * 指数バックオフにはしていない。理由は、対象がインターネット越しの
 * 不特定多数のノードではなく開発者のローカル Docker ネットワーク内の
 * 少数ノードに限られ、再接続の試行コスト（TCP 接続 1 回分）が
 * 無視できるほど小さいため、間隔を伸ばすメリットが薄いこと。
 * リトライ回数の上限は設けず無期限に再接続を試み続ける。chainviz は
 * 学習・検証用の使い捨て環境であり、collector プロセスは
 * ノードコンテナの寿命より長く起動したままにされることが多いため、
 * 「N 回失敗したら諦める」設計にすると、ノード復旧後も購読が死んだ
 * ままになり、Issue #135 で報告された事象そのものが再発する。
 */
export const RECONNECT_DELAY_MS = 2000;

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
 *
 * 接続断からの再接続（Issue #135）: docker compose でノードコンテナが
 * 再作成される等で WebSocket が切断（"close" イベント）された場合、
 * 呼び出し側が明示的に close() していない限り RECONNECT_DELAY_MS 待って
 * 同じ wsUrl・subscribeParams で再接続し、eth_subscribe をやり直す。
 * onResult/onError は再接続後も同じコールバックがそのまま使われる。
 * closedByCaller フラグで「呼び出し側の意図的な close」と
 * 「ノード側都合の切断」を区別し、後者のときだけ再接続する。
 */
function subscribe<T>(
  wsUrl: string,
  subscribeParams: unknown[],
  onResult: (result: T) => void,
  onError?: (err: unknown) => void,
  reconnectDelayMs: number = RECONNECT_DELAY_MS,
): Subscription {
  let socket: WebSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let closedByCaller = false;

  function connect(): void {
    const current = new WebSocket(wsUrl);
    socket = current;

    current.on("open", () => {
      current.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_subscribe",
          params: subscribeParams,
        }),
      );
    });

    current.on("message", (data) => {
      const result = parseSubscriptionResult(data.toString());
      if (result !== undefined) onResult(result as T);
    });

    current.on("error", (err) => onError?.(err));

    current.on("close", () => {
      if (closedByCaller) return;
      // ノード側都合（コンテナ再作成など）の切断。無期限に再接続を試みる
      // （根拠は RECONNECT_DELAY_MS のコメント参照）。
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, reconnectDelayMs);
    });
  }

  connect();

  return {
    close(): void {
      closedByCaller = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      socket?.close();
    },
  };
}

/** createWsEthClient() のオプション（テストで再接続間隔を短縮するため）。 */
export interface CreateWsEthClientOptions {
  /** 切断から再接続までの待機時間（ミリ秒）。既定は RECONNECT_DELAY_MS。 */
  reconnectDelayMs?: number;
}

/** ws パッケージを用いた EthWsClient 実装。 */
export function createWsEthClient(
  options: CreateWsEthClientOptions = {},
): EthWsClient {
  const reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  return {
    subscribeNewHeads(wsUrl, onHeader, onError) {
      return subscribe<NewHeadHeader>(
        wsUrl,
        ["newHeads"],
        onHeader,
        onError,
        reconnectDelayMs,
      );
    },
    subscribePendingTransactions(wsUrl, onTxHash, onError) {
      return subscribe<string>(
        wsUrl,
        ["newPendingTransactions"],
        onTxHash,
        onError,
        reconnectDelayMs,
      );
    },
  };
}
