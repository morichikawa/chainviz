// Ethereum プロファイルの Docker スタックを起動し、チェーンが実際に進行し
// 始めるまで待つヘルパー。既にスタックが起動しチェーンが進んでいればそれを
// 再利用し、そうでなければ `docker compose up -d` で起動する。テストごとに
// down -v して作り直すと genesis 再生成 + 同期で数分かかるため、既存の
// 健全なスタックを再利用する方針を採る（判断は docs/WORKLOG.md 参照）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { composeFile } from "./paths.js";
import { ethBlockNumber, rethRpcUrl } from "./rpc.js";
import { SLOT_DURATION_MS } from "./slot-time.js";
import { sleep, waitFor } from "./wait.js";

const execFileAsync = promisify(execFile);

/** reth1 の固定 IP（compose で 172.28.1.1 に割り当て）。 */
const RETH1_IP = "172.28.1.1";

/**
 * チェーン進行の観測窓（2 回のブロック高観測の間隔）。ブロックは slot ごとに
 * 1 つ生成されるため、少なくとも 1 slot 分を超えて待たないと、観測タイミングが
 * slot 境界をまたがず「増えていない」と誤判定しうる。固定 6 秒だと slot time
 * 12 秒では約半分の確率で誤判定するため、slot time に比例させ、位相ずれや
 * 遅延 slot に対する余裕を見て 2 slot 分待つ（1 slot ちょうどだと観測が
 * 境界と揃ったとき 0 ブロックになりうるため 2 倍にする）。
 */
const PROGRESS_OBSERVATION_MS = SLOT_DURATION_MS * 2;

/** docker compose を実行する。stdout を返す。 */
async function compose(args: string[], timeoutMs = 300_000): Promise<string> {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "-f", composeFile, ...args],
    { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout;
}

/** チェーンが進行しているか（2 回の観測でブロック高が増えるか）を確認する。 */
async function chainIsProgressing(): Promise<boolean> {
  const url = rethRpcUrl(RETH1_IP);
  const first = await ethBlockNumber(url);
  await sleep(PROGRESS_OBSERVATION_MS);
  const second = await ethBlockNumber(url);
  return second > first && second > 0;
}

/** 例外を握りつぶして chainIsProgressing の真偽だけ返す（未起動判定に使う）。 */
async function chainReachableAndProgressing(): Promise<boolean> {
  try {
    return await chainIsProgressing();
  } catch {
    return false;
  }
}

export interface EnsureChainOptions {
  /** true なら down -v してから起動し直す（クリーンな状態から検証したい場合）。 */
  freshStart?: boolean;
  /** チェーン進行を待つ最大時間。genesis 再生成 + 同期を見込んで長め。 */
  readyTimeoutMs?: number;
}

/**
 * Ethereum スタックを起動し、チェーンが進行し始めるまで待つ。既に起動して
 * いれば up -d は冪等に働く（no-op）。freshStart 指定時のみ down -v する。
 */
export async function ensureChainRunning(
  options: EnsureChainOptions = {},
): Promise<void> {
  const { freshStart = false, readyTimeoutMs = 300_000 } = options;

  if (freshStart) {
    await compose(["down", "-v"]);
    await compose(["up", "-d"]);
  } else if (!(await chainReachableAndProgressing())) {
    // 未起動・不健全なときだけ up -d する。健全に動いている場合は genesis
    // 再生成 + 同期のコストを避けるため、稼働中スタックをそのまま再利用する。
    // なお genesis サービスは冪等化済み（Issue #56。generate-genesis.sh が
    // 共有ボリューム上の完了マーカーを見て再生成をスキップする）ため、稼働中に
    // up -d を再実行しても genesis は上書きされず、後から addNode で参加する
    // ノードも既存ノードと同一 genesis で init される。
    await compose(["up", "-d"]);
  }

  // reth1 の JSON-RPC が応答し、かつブロックが増え続けることを確認する。
  await waitFor(() => chainIsProgressing(), {
    timeoutMs: readyTimeoutMs,
    intervalMs: 3_000,
    description: "Ethereum chain to start progressing",
  });
}

/**
 * chainviz-ethereum プロジェクトに属するコンテナ数を数える。compose 起動の
 * ノードと collector が addNode/addWorkbench で作成した managed コンテナの
 * 両方が `com.docker.compose.project=chainviz-ethereum` ラベルを持つため、
 * このラベルで絞り込む。異常系コマンドがコンテナを一切作らないことの検証に使う。
 */
export async function countProjectContainers(): Promise<number> {
  const { stdout } = await execFileAsync("docker", [
    "ps",
    "-a",
    "--filter",
    "label=com.docker.compose.project=chainviz-ethereum",
    "--format",
    "{{.ID}}",
  ]);
  return stdout.split("\n").filter((line) => line.trim().length > 0).length;
}

/** スタックを停止・破棄する（クリーンアップ用。テストからは通常呼ばない）。 */
export async function tearDownChain(): Promise<void> {
  await compose(["down", "-v"]);
}

/**
 * ワークベンチコンテナ内で `forge create` を直接叩き、collector の
 * `deployContract` コマンド経由の登録（`registerContractDeployment`）を
 * 経ないコントラクトデプロイを行う（UI-C-06「カタログ外のコントラクト」の
 * セットアップ用）。
 *
 * デプロイ対象自体は既存のカタログ内コントラクト（`Counter`）を使い回す。
 * 新しい Solidity ファイルを追加する必要はない。`ContractTracker`
 * （`packages/collector/src/adapters/ethereum/contracts.ts`）は「手動デプロイ
 * （runWorkbenchOperation の deployContract 経由でない）はデプロイ済み
 * バイトコードとの照合を一切行わず、常に『未知のコントラクト』として扱う」
 * 設計のため、カタログに載っている Counter を手動 forge create しても
 * 「未知のコントラクト」として観測される（docs/worklog/issue-201.md 設計メモ参照）。
 *
 * mnemonic は `docker-compose.yml` の workbench サービスが `env_file` で
 * 読み込み済みの `$EL_AND_CL_MNEMONIC` をコンテナ内のシェル展開で参照し、
 * このファイル側で値を二重管理しない。
 *
 * RPC 接続先はコンテナの `ETH_RPC_URL` 環境変数（dev collector のロギング
 * プロキシ `http://host.docker.internal:4001` 固定）ではなく、呼び出し側
 * （UI E2E）の collector のプロキシポートへ `docker compose exec -e` で
 * 上書きする。dev collector を起動していないクリーン環境では 4001 に待受が
 * 無く Connection refused になるため（Issue #381）。`exec -e` はこのコマンド
 * 実行にだけ効き、コンテナ本体の環境・compose 定義・dev 運用には影響しない
 * （docs/ARCHITECTURE.md §8.3、docs/worklog/issue-381.md 設計メモ参照）。
 * ホスト名 `host.docker.internal`（compose 側の `extra_hosts` と対）は
 * このファイル内に閉じ、呼び出し元にはポート番号だけを渡させる。
 *
 * この関数自体は docker compose exec への薄い委譲だが、Issue #381 の修正の
 * 核心（`-e ETH_RPC_URL=...` による exec 時上書き）は組み立てる引数の並びに
 * 凝縮されている。実 Docker を起動せずに `node:child_process` の execFile を
 * モックして引数配列だけを検証できるため、`docker.unit.test.ts` で回帰対象と
 * して固定している（`countProjectContainers`/`tearDownChain` と異なり、実
 * Docker 必須という理由でユニットテスト対象外にはしていない）。
 */
export async function deployUncatalogedContractInWorkbench(
  proxyPort: number,
): Promise<void> {
  await compose([
    "exec",
    "-T",
    // `-e ETH_RPC_URL=...` はサービス名 `workbench` より前に置く必要がある
    // （docker compose exec のオプション位置のセマンティクス）。後ろに置くと
    // コンテナ内コマンドへの引数として解釈され、環境変数の上書きが効かない
    // （`docker.unit.test.ts` の順序検証ケースが退行を検出する）。
    "-e",
    `ETH_RPC_URL=http://host.docker.internal:${proxyPort}`,
    "workbench",
    "sh",
    "-c",
    'forge create Counter --root /contracts --broadcast --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index 0',
  ]);
}
