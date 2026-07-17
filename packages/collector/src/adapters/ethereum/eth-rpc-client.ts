// Execution Layer クライアント（reth 等）へ HTTP JSON-RPC で問い合わせる部分。
// fetch への依存と JSON-RPC の語彙（eth_getBalance / eth_getTransactionByHash 等）は
// このファイル（ChainAdapter 実装の内側）に閉じ込め、上位ロジックは
// EthRpcClient インターフェース（汎用トランスポート）と、その上に載る
// ドメイン固有ヘルパー関数だけに依存して実ノードなしでテストできるようにする。

export interface EthRpcClient {
  /**
   * 指定 URL へ JSON-RPC の単発リクエストを送り、result を返す。HTTP エラー・
   * JSON-RPC エラー・タイムアウトは例外として投げる。
   */
  call<T>(url: string, method: string, params: unknown[]): Promise<T>;
}

/** eth_getTransactionByHash / ブロック内 tx から取り出す最小限の tx 情報。 */
export interface RpcTransaction {
  hash: string;
  from: string;
  /** コントラクト作成 tx では to は null。 */
  to: string | null;
  /**
   * tx の呼び出しデータ（16 進文字列）。コントラクト関数呼び出しの復号
   * （カタログ ABI による decodeFunctionData。Issue #162）にのみ使う、
   * チェーン固有の生データ。フィールドが欠落・非文字列の場合は "0x"
   * （呼び出しデータなし）として扱う。
   */
  input: string;
  /**
   * 送信元アカウントの通し番号（Issue #319）。レスポンスの nonce（16 進
   * 文字列）を数値化したもの。フィールドが欠落・非文字列・BigInt 変換
   * 不能な場合は省略する（tx 全体は捨てず、nonce だけ情報なし扱いにする。
   * input の "0x" フォールバックと同じ防御的姿勢）。`fetchNonce` と同じ
   * 変換だが、こちらは「この tx が使った値」であり次に使う値ではない点に
   * 注意（TransactionEntity.nonce のコメント参照）。
   */
  nonce?: number;
}

/**
 * receipt.logs 1 件分の未復号の生データ。イベント名・引数への復号は
 * チェーンプロファイルのコントラクトカタログの ABI を要するため、この層では
 * 行わない（復号は呼び出し側 = 後続のコントラクトカタログ照合ロジックの責務。
 * Issue #162）。
 */
export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
}

/**
 * eth_getBlockReceipts から取り出す tx receipt の最小限の情報。succeeded は
 * receipt の status（0x0/0x1）から解釈した実行結果であり、world-state の語彙
 *（included/failed）へのマッピングは呼び出し側（アダプタ）が行う。
 */
export interface RpcTransactionReceipt {
  transactionHash: string;
  from: string;
  /** コントラクト作成 tx では to は null。 */
  to: string | null;
  /** receipt.status が "0x0" のときだけ false。それ以外（0x1・欠落・不正値）は true。 */
  succeeded: boolean;
  /**
   * コントラクト作成 tx でのみ非 null（作成されたコントラクトのアドレス）。
   * それ以外の通常の tx や、フィールド自体が欠落している場合は null。
   */
  contractAddress: string | null;
  /**
   * tx の実行中にコントラクトが発したイベントログ（未復号の生データ）。
   * logs フィールドが欠落・不正な形の場合は空配列（ログなしと区別しない。
   * 復号側は「イベントが無かった」のと同じ扱いで安全側に倒れる）。
   */
  logs: RpcLog[];
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

interface RawTransaction {
  hash?: unknown;
  from?: unknown;
  to?: unknown;
  input?: unknown;
  nonce?: unknown;
}

interface RawReceipt {
  transactionHash?: unknown;
  from?: unknown;
  to?: unknown;
  status?: unknown;
  contractAddress?: unknown;
  logs?: unknown;
}

interface RawLog {
  address?: unknown;
  topics?: unknown;
  data?: unknown;
}

/** グローバル fetch を用いた EthRpcClient 実装。 */
export function createFetchEthRpcClient(timeoutMs = 3000): EthRpcClient {
  return {
    async call<T>(url: string, method: string, params: unknown[]): Promise<T> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`RPC ${method} on ${url} failed with status ${res.status}`);
        }
        const body = (await res.json()) as JsonRpcResponse<T>;
        if (body.error) {
          throw new Error(
            `RPC ${method} on ${url} returned error ${body.error.code}: ${body.error.message}`,
          );
        }
        if (body.result === undefined) {
          throw new Error(`RPC ${method} on ${url} returned no result`);
        }
        return body.result;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * eth_call を実行し、戻り値（16 進の生データ）をそのまま返す。ABI エンコード/
 * デコード（呼び出す関数の選択・引数の組み立て・戻り値の解釈）はこの層では
 * 行わず、呼び出し側（例: erc20.ts の balanceOf 照会）が担う。cast call が
 * 使うのと同じ RPC で、宛先・calldata の意味論に関わらず汎用に使える（Issue #164）。
 */
export async function ethCall(
  rpc: EthRpcClient,
  url: string,
  to: string,
  data: string,
): Promise<string> {
  return rpc.call<string>(url, "eth_call", [{ to, data }, "latest"]);
}

/**
 * eth_getBalance の結果（16 進 wei）を 10 進の wei 文字列にして返す。
 * WalletEntity.balance は wei を文字列で保持する（精度落ち防止）ため、
 * BigInt を経由して桁落ちなく変換する。
 */
export async function fetchBalanceWei(
  rpc: EthRpcClient,
  url: string,
  address: string,
): Promise<string> {
  const hex = await rpc.call<string>(url, "eth_getBalance", [address, "latest"]);
  return BigInt(hex).toString(10);
}

/**
 * eth_getTransactionCount（latest）の結果（16 進）を数値の nonce にして返す。
 * nonce は tx 通し番号でありアカウント寿命内は安全に number に収まる。
 */
export async function fetchNonce(
  rpc: EthRpcClient,
  url: string,
  address: string,
): Promise<number> {
  const hex = await rpc.call<string>(url, "eth_getTransactionCount", [
    address,
    "latest",
  ]);
  return Number(BigInt(hex));
}

interface RawBlock {
  hash?: unknown;
}

/**
 * genesis（block 0）のブロックハッシュを取得する。チェーンリセット検知
 * （`docker compose down -v` → `up` による genesis の再生成。Issue #357）で
 * 「観測対象が別のチェーンになったかどうか」を判定する基準値として使う。
 * トランザクション本体は不要なので `eth_getBlockByNumber` の第2引数（フル
 * トランザクションを展開するか）は false にする。
 *
 * ノードが block 0 を返さない（result が null/非オブジェクト）・hash
 * フィールドが文字列でない場合はエラーを投げる。呼び出し側（アダプタの
 * チェーンリセット監視）はこれを「このノードからは genesis を観測できな
 * かった」という一時的な失敗として扱い、他ノードへのフォールバックや
 * 前回観測値の維持で対応する（正常に block 0 が存在するはずの Ethereum
 * ノードでこの形状が返ることは通常無いため、ここでは静かに undefined を
 * 返さず例外にして呼び出し側に判断を委ねる）。
 */
export async function fetchGenesisHash(
  rpc: EthRpcClient,
  rpcUrl: string,
): Promise<string> {
  const raw = await rpc.call<unknown>(rpcUrl, "eth_getBlockByNumber", [
    "0x0",
    false,
  ]);
  if (typeof raw !== "object" || raw === null) {
    throw new Error(
      `eth_getBlockByNumber(0x0) on ${rpcUrl} returned no genesis block`,
    );
  }
  const hash = (raw as RawBlock).hash;
  if (typeof hash !== "string") {
    throw new Error(
      `eth_getBlockByNumber(0x0) on ${rpcUrl} returned a block without a hash`,
    );
  }
  return hash;
}

/**
 * raw の nonce（16 進文字列のはず）を数値化する（Issue #319）。フィールドが
 * 欠落しているのは「このノード実装/レスポンスには元々含まれない」という
 * 正常系なので黙って省略する。一方、フィールドは存在するのに非文字列・
 * BigInt 変換不能（想定外のノード実装のバグ等）な場合はエラーとしてログを
 * 残した上で省略する（tx 全体は捨てず、nonce だけ情報なしにする防御的姿勢。
 * CLAUDE.md「エラーを握りつぶさない」に従い、想定外ケースは必ずログする）。
 */
function normalizeNonce(txHash: string, rawNonce: unknown): number | undefined {
  if (rawNonce === undefined) return undefined;
  if (typeof rawNonce !== "string") {
    console.error(
      `[ethereum] tx ${txHash} has a non-string nonce (${typeof rawNonce}); omitting nonce`,
    );
    return undefined;
  }
  try {
    return Number(BigInt(rawNonce));
  } catch (err) {
    console.error(
      `[ethereum] tx ${txHash} has an unparsable nonce "${rawNonce}"; omitting nonce:`,
      err,
    );
    return undefined;
  }
}

/** 生の JSON-RPC tx オブジェクトを RpcTransaction へ正規化する（不正なら null）。 */
function normalizeTransaction(raw: unknown): RpcTransaction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const tx = raw as RawTransaction;
  if (typeof tx.hash !== "string" || typeof tx.from !== "string") return null;
  const to = typeof tx.to === "string" ? tx.to : null;
  // input が欠落・非文字列（想定外のノード実装等）の場合は「呼び出しデータなし」
  // と同じ "0x" にフォールバックする（復号側は関数呼び出しではないと解釈する）。
  const input = typeof tx.input === "string" ? tx.input : "0x";
  const nonce = normalizeNonce(tx.hash, tx.nonce);
  return { hash: tx.hash, from: tx.from, to, input, ...(nonce !== undefined ? { nonce } : {}) };
}

/**
 * eth_getTransactionByHash で tx の詳細を取得する。未知のハッシュ（まだ
 * 伝播していない等）では null を返す。JSON-RPC では未知の tx は result=null で
 * 返るため、正規化して null を返す。
 */
export async function getTransactionByHash(
  rpc: EthRpcClient,
  rpcUrl: string,
  hash: string,
): Promise<RpcTransaction | null> {
  const raw = await rpc.call<unknown>(rpcUrl, "eth_getTransactionByHash", [hash]);
  return normalizeTransaction(raw);
}

/**
 * 生の JSON-RPC log オブジェクトを RpcLog へ正規化する（不正なら null）。
 * topics は配列であることだけを要求し、文字列でない要素は個別に捨てる
 * （1 件のノイズでログ全体を諦めない）。
 */
function normalizeLog(raw: unknown): RpcLog | null {
  if (typeof raw !== "object" || raw === null) return null;
  const log = raw as RawLog;
  if (typeof log.address !== "string" || typeof log.data !== "string") return null;
  if (!Array.isArray(log.topics)) return null;
  const topics = log.topics.filter((t): t is string => typeof t === "string");
  return { address: log.address, topics, data: log.data };
}

/** 生の JSON-RPC receipt オブジェクトを RpcTransactionReceipt へ正規化する（不正なら null）。 */
function normalizeReceipt(raw: unknown): RpcTransactionReceipt | null {
  if (typeof raw !== "object" || raw === null) return null;
  const receipt = raw as RawReceipt;
  if (
    typeof receipt.transactionHash !== "string" ||
    typeof receipt.from !== "string"
  ) {
    return null;
  }
  const to = typeof receipt.to === "string" ? receipt.to : null;
  // status が "0x0" のときだけ失敗とする。"0x1"・欠落・不正値は成功扱い
  // （証拠なしに failed 表示をしない保守的判断。status 欠落は pre-Byzantium の
  // receipt 形式で、本プロファイルの devnet では実際には起きない）。
  const succeeded = receipt.status !== "0x0";
  // コントラクト作成 tx でのみ non-null。文字列でなければ（欠落・null 含め）
  // 「作成ではない」として null に倒す。
  const contractAddress =
    typeof receipt.contractAddress === "string" ? receipt.contractAddress : null;
  const rawLogs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const logs = rawLogs
    .map((l) => normalizeLog(l))
    .filter((l): l is RpcLog => l !== null);
  return {
    transactionHash: receipt.transactionHash,
    from: receipt.from,
    to,
    succeeded,
    contractAddress,
    logs,
  };
}

/**
 * eth_getBlockReceipts でブロックに含まれる全 tx の receipt を取得する。
 * receipt には transactionHash / from / to / status に加え contractAddress /
 * logs も含まれるため、1 回の呼び出しでブロック内 tx 一覧・各 tx の成否・
 * コントラクト作成の検知・イベントログ（未復号）まで同時に得られる（tx 本体を
 * 別途 eth_getBlockByHash で取得する必要がなく、ブロックあたりの RPC 呼び出し
 * 回数は増えない。Issue #86 の方針を維持。Issue #160）。未知のブロックでは
 * null を返す（JSON-RPC では result=null で返る）。空ブロックは空配列を返す。
 */
export async function getBlockReceipts(
  rpc: EthRpcClient,
  rpcUrl: string,
  blockHash: string,
): Promise<RpcTransactionReceipt[] | null> {
  const raw = await rpc.call<unknown[] | null>(rpcUrl, "eth_getBlockReceipts", [
    blockHash,
  ]);
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  return raw
    .map((r) => normalizeReceipt(r))
    .filter((r): r is RpcTransactionReceipt => r !== null);
}
