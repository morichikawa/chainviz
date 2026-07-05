// ワークベンチ → ノードの JSON-RPC 呼び出しを観測するロギングプロキシ。
//
// docs/CONCEPT.md「ユーザー操作マシン（ワークベンチ）の投影」の決定に従い、
// ワークベンチの接続先をノードではなくこのプロキシに向ける。プロキシは
// 受け取った JSON-RPC リクエスト（HTTP POST）の呼び出し内容（呼び出し元 IP・
// メソッド名・パラメータ・タイムスタンプ）を観測データとして記録・発行しつつ、
// リクエストボディをそのまま実ノード（reth）へ転送し、レスポンスもそのまま
// 返す。透過性を保つため、転送するボディ・返すボディはいずれも受け取った
// バイト列を改変せず素通しし、観測用にはコピーを別途 JSON パースする。
//
// このファイルの責務は「観測してログに残しつつ透過転送する」ところまで。
// 観測データをワールドステートへ組み込む処理は別モジュールの責務とし、
// onObserve コールバックで観測データを外へ渡すだけにとどめる（Issue #80）。

import { createServer, type IncomingMessage, type Server } from "node:http";

/** JSON-RPC の id フィールド。仕様上 string / number / null を取りうる。 */
export type JsonRpcId = string | number | null;

/**
 * ワークベンチからの 1 回の JSON-RPC 呼び出しの観測データ。
 * バッチリクエスト（配列）の場合は要素ごとに 1 件ずつ生成する。
 */
export interface RpcObservation {
  /** プロキシがリクエストを受け取った時刻（epoch ms）。 */
  timestamp: number;
  /** 呼び出し元（ワークベンチコンテナ）の IP アドレス。 */
  callerIp: string;
  /** JSON-RPC メソッド名（例: "eth_sendRawTransaction"）。 */
  method: string;
  /** JSON-RPC パラメータ（内容はメソッド依存のため未加工で保持する）。 */
  params: unknown;
  /** JSON-RPC リクエスト id。 */
  id: JsonRpcId;
}

/** 観測データの受け取り口。後続処理（world-state への組み込み）へ渡す。 */
export type RpcObserver = (observation: RpcObservation) => void;

/** 発生源が特定できるエラー・情報をログに残す関数。 */
export type ProxyLogger = (message: string, detail?: unknown) => void;

/** 転送先ノードへのリクエスト転送結果。 */
export interface ForwardResponse {
  status: number;
  contentType: string;
  body: string;
}

/**
 * リクエストボディを転送先へそのまま送り、レスポンスを返す関数。
 * 実ネットワーク依存（fetch）をこのインターフェースの裏に閉じ込め、
 * ハンドラロジックを実ノードなしでテストできるようにする。
 */
export type ForwardFn = (
  rawBody: string,
  contentType: string,
) => Promise<ForwardResponse>;

const defaultLog: ProxyLogger = (message, detail) =>
  detail === undefined ? console.log(message) : console.log(message, detail);

/** リクエストボディの最大サイズ（バイト）。過大なボディでのメモリ枯渇を防ぐ。 */
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * リクエストボディが上限バイト数を超えたときに投げるエラー。
 * ハンドラ側でクライアントへ返すべき HTTP ステータス（413 Payload Too Large）を
 * 保持し、他の読み取りエラー（400 相当）と区別できるようにする。
 */
export class RequestBodyTooLargeError extends Error {
  /** クライアントへ返す HTTP ステータス（413 Payload Too Large）。 */
  readonly statusCode = 413;
  constructor(maxBodyBytes: number) {
    super(`request body exceeds size limit of ${maxBodyBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * fetch を用いた転送関数を作る。転送先 URL（実ノードの JSON-RPC）へ POST し、
 * レスポンスのステータス・content-type・ボディをそのまま返す。
 */
export function createFetchForwarder(
  targetUrl: string,
  timeoutMs = 10_000,
): ForwardFn {
  return async (rawBody, contentType) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "content-type": contentType },
        body: rawBody,
        signal: controller.signal,
      });
      const body = await res.text();
      return {
        status: res.status,
        contentType: res.headers.get("content-type") ?? "application/json",
        body,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * リクエストボディから観測データを抽出する。単発リクエスト（オブジェクト）と
 * バッチリクエスト（配列）の両方に対応する。JSON として解釈できない、または
 * method を持たない要素は観測対象外として黙って読み飛ばす（透過転送自体は
 * 呼び出し側で別途行うため、ここでの読み飛ばしが転送を妨げることはない）。
 */
export function extractObservations(
  rawBody: string,
  callerIp: string,
  timestamp: number,
): RpcObservation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const observations: RpcObservation[] = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.method !== "string") continue;
    observations.push({
      timestamp,
      callerIp,
      method: record.method,
      params: record.params,
      id: normalizeId(record.id),
    });
  }
  return observations;
}

function normalizeId(id: unknown): JsonRpcId {
  if (typeof id === "string" || typeof id === "number") return id;
  return null;
}

/**
 * IPv4-mapped IPv6 形式（`::ffff:172.28.0.5`）を素の IPv4 表記に正規化する。
 * Docker bridge 経由の接続では remoteAddress がこの形式になることがある。
 */
export function normalizeCallerIp(remoteAddress: string | undefined): string {
  if (!remoteAddress) return "unknown";
  const mapped = remoteAddress.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? mapped[1] : remoteAddress;
}

export interface HandleResult {
  status: number;
  contentType: string;
  body: string;
}

/**
 * 1 リクエスト分の処理本体。観測データを記録・発行し、ボディを転送先へ
 * 素通しして結果を返す。HTTP サーバーの配線から切り離してテストできるよう
 * 純粋な入出力の関数にしてある。
 */
export async function handleRpcRequest(args: {
  rawBody: string;
  callerIp: string;
  contentType: string;
  forward: ForwardFn;
  onObserve?: RpcObserver;
  now?: () => number;
  log?: ProxyLogger;
}): Promise<HandleResult> {
  const { rawBody, callerIp, contentType, forward } = args;
  const now = args.now ?? Date.now;
  const log = args.log ?? defaultLog;
  const timestamp = now();

  // 観測: 転送の成否に関わらず「呼び出しがあった」事実を記録・発行する。
  const observations = extractObservations(rawBody, callerIp, timestamp);
  for (const observation of observations) {
    log(
      `[proxy] rpc call from ${observation.callerIp}: ${observation.method}`,
      observation.params,
    );
    args.onObserve?.(observation);
  }

  // 転送: 受け取ったボディを改変せずそのまま実ノードへ送り、レスポンスを
  // そのまま返す（透過プロキシ）。
  try {
    const forwarded = await forward(rawBody, contentType);
    return {
      status: forwarded.status,
      contentType: forwarded.contentType,
      body: forwarded.body,
    };
  } catch (err) {
    // 転送失敗は握りつぶさずログに残す。透過性を保てないケースなので、
    // JSON-RPC のエラー形式で 502 を返し、呼び出し側が失敗を検知できるようにする。
    log("[proxy] forward to upstream failed:", err);
    const id = observations.length === 1 ? observations[0].id : null;
    return {
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: "logging proxy: upstream request failed" },
      }),
    };
  }
}

export interface LoggingProxyOptions {
  /** 転送関数。既定は createFetchForwarder(targetUrl)。 */
  forward: ForwardFn;
  /** 観測データの受け取り口（Issue #80 で world-state へ組み込む）。 */
  onObserve?: RpcObserver;
  /** ログ出力。 */
  log?: ProxyLogger;
  /** リクエストボディの最大サイズ（バイト）。 */
  maxBodyBytes?: number;
}

/**
 * ワークベンチ RPC 観測用ロギングプロキシの HTTP サーバー。
 * JSON-RPC は HTTP POST で来るため POST のみ受け付け、他メソッドは 405 を返す。
 */
export class LoggingProxy {
  private server?: Server;
  private readonly log: ProxyLogger;
  private readonly maxBodyBytes: number;

  constructor(private readonly options: LoggingProxyOptions) {
    this.log = options.log ?? defaultLog;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  /** 指定ポートで待ち受ける。listening まで待つ。 */
  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.onRequest(req, res);
      });

      const onStartupError = (err: Error): void => reject(err);
      server.once("error", onStartupError);
      server.once("listening", () => {
        server.removeListener("error", onStartupError);
        // 起動後のサーバーレベルエラーはログに流す（error リスナー未登録の
        // まま発火するとプロセス全体の安全網へ流れてしまうため）。
        server.on("error", (err) => this.log("[proxy] server error:", err));
        resolve();
      });

      // host を "0.0.0.0"（IPv4 の全アドレス）に明示指定する。指定を省くと
      // Node は IPv6 の "::" に bind し、WSL2 の localhost 転送は WSL 側
      // listener のアドレスファミリをそのまま Windows 側リレーへ写すため、
      // Windows の localhost（IPv4）からの接続が届かなくなる（Issue #99。
      // 実測で "0.0.0.0" 指定時に IPv4 bind されることを確認）。
      // ここは WebSocket サーバーと違い "127.0.0.1" にはできない。ワークベンチ
      // コンテナが Docker bridge の IPv4 ゲートウェイ経由で
      // host.docker.internal:4001 を叩くため、loopback 限定に絞ると
      // コンテナからの転送リクエストが届かなくなる。全 IPv4 アドレスで
      // 待ち受ける "0.0.0.0" が必要。
      server.listen(port, "0.0.0.0");
      this.server = server;
    });
  }

  /** 実際に割り当てられた待ち受けポートを返す（テストで port:0 を許すため）。 */
  get address(): { port: number } | null {
    const addr = this.server?.address();
    if (addr && typeof addr === "object") return { port: addr.port };
    return null;
  }

  private async onRequest(
    req: IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
    if (req.method !== "POST") {
      // JSON-RPC は POST で来る。それ以外は転送対象外として 405 を返す。
      res.writeHead(405, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: "logging proxy accepts POST JSON-RPC only" }),
      );
      req.resume(); // ボディを読み捨てて接続を解放する。
      return;
    }

    let rawBody: string;
    try {
      rawBody = await this.readBody(req);
    } catch (err) {
      this.log("[proxy] failed to read request body:", err);
      // 過大ボディ（413）と不正なボディ（400）を区別してクライアントへ返す。
      // ボディを最後まで読み切っていないため、この接続は keep-alive で再利用
      // できない。Connection: close を明示し、レスポンス送出後に確実に閉じる。
      const status =
        err instanceof RequestBodyTooLargeError ? err.statusCode : 400;
      const message =
        err instanceof RequestBodyTooLargeError
          ? "logging proxy: request body too large"
          : "logging proxy: invalid request body";
      if (!res.headersSent) {
        res.writeHead(status, {
          "content-type": "application/json",
          connection: "close",
        });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    const contentType =
      (req.headers["content-type"] as string | undefined) ?? "application/json";
    const callerIp = normalizeCallerIp(req.socket.remoteAddress ?? undefined);

    const result = await handleRpcRequest({
      rawBody,
      callerIp,
      contentType,
      forward: this.options.forward,
      onObserve: this.options.onObserve,
      log: this.log,
    });

    res.writeHead(result.status, { "content-type": result.contentType });
    res.end(result.body);
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      req.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > this.maxBodyBytes) {
          // ソケットを破棄（req.destroy）するとレスポンス送出前に接続が
          // リセットされ、クライアントに 413 が届かない。読み取りだけ止め
          // （pause）、残りのボディは読まずにハンドラ側でレスポンスを返す。
          settled = true;
          req.pause();
          reject(new RequestBodyTooLargeError(this.maxBodyBytes));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }

  /** サーバーを閉じる。 */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
