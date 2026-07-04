// Ethereum プロファイルの Docker スタックを起動し、チェーンが実際に進行し
// 始めるまで待つヘルパー。既にスタックが起動しチェーンが進んでいればそれを
// 再利用し、そうでなければ `docker compose up -d` で起動する。テストごとに
// down -v して作り直すと genesis 再生成 + 同期で数分かかるため、既存の
// 健全なスタックを再利用する方針を採る（判断は docs/WORKLOG.md 参照）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { composeFile } from "./paths.js";
import { ethBlockNumber, rethRpcUrl } from "./rpc.js";
import { sleep, waitFor } from "./wait.js";

const execFileAsync = promisify(execFile);

/** reth1 の固定 IP（compose で 172.28.1.1 に割り当て）。 */
const RETH1_IP = "172.28.1.1";

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
  await sleep(6_000);
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

/** スタックを停止・破棄する（クリーンアップ用。テストからは通常呼ばない）。 */
export async function tearDownChain(): Promise<void> {
  await compose(["down", "-v"]);
}
