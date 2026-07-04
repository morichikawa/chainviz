// Collector のエントリポイント。Docker ポーリング → Ethereum アダプタによる
// 正規化 → ワールドステート store → WebSocket 配信、を配線する。

import Docker from "dockerode";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EthereumAdapter } from "./adapters/ethereum/index.js";
import { EthereumNodeLifecycle } from "./adapters/ethereum/node-lifecycle.js";
import { CommandHandler } from "./commands/handler.js";
import { createDockerClient } from "./docker/dockerode-client.js";
import { createDockerOperations } from "./docker/dockerode-operations.js";
import { DockerPoller } from "./docker/poller.js";
import { CollectorServer } from "./server/websocket-server.js";
import { WorldStateStore } from "./world-state/store.js";

/** ポーリング間隔（docs/CONCEPT.md の決定に従い 3 秒）。 */
export const POLL_INTERVAL_MS = 3000;

/** WebSocket サーバーの既定ポート。 */
export const DEFAULT_PORT = 4000;

/**
 * 待ち受けポートを解決する。環境変数 CHAINVIZ_COLLECTOR_PORT が有効な
 * 非負整数なら優先し、未設定・不正値なら DEFAULT_PORT を使う。既存の
 * collector プロセスとポートが衝突しうる状況（E2E テストなど）で、
 * 起動側がポートを差し替えられるようにするために用いる。
 */
export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CHAINVIZ_COLLECTOR_PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_PORT;
  return parsed;
}

/**
 * profiles/ethereum のホスト絶対パスを解決する。addNode/addWorkbench で
 * scripts/*.sh・values.env を bind mount / 読み込みするために必要。
 * 環境変数 CHAINVIZ_ETHEREUM_PROFILE_DIR で上書きでき、未設定なら
 * リポジトリ構成（packages/collector/dist/index.js の 4 つ上が repo ルート）
 * から導出する。
 */
export function resolveProfileDir(): string {
  const override = process.env.CHAINVIZ_ETHEREUM_PROFILE_DIR;
  if (override) return override;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/index.js -> dist -> collector -> packages -> repo ルート
  return path.resolve(here, "../../..", "profiles/ethereum");
}

export interface PollingLoop {
  stop(): void;
}

/**
 * プロセス全体を巻き込む未捕捉の非同期エラーに対する安全網を張る。
 *
 * collector は addNode/addWorkbench で作成した managed コンテナの参照を
 * メモリ上のレジストリだけで保持している。プロセスが落ちるとこのレジストリが
 * 失われ、作成済みコンテナがすべて孤児になる（削除できなくなる）。そのため、
 * Docker/WebSocket など I/O 層で稀に発生する未捕捉の非同期エラー（例: コンテナ
 * 削除の競合や、状態遷移中のソケットで遅れて発火する 'error' イベント）が
 * プロセス全体を停止させると、被害が「1 コマンドの失敗」では済まず、孤児の
 * 蓄積という連鎖的な悪化を招く（Issue #63）。
 *
 * ここでは Node の既定挙動（unhandledRejection でプロセス終了）を上書きし、
 * 検知した異常は握りつぶさずに必ずログへ残したうえで、長時間稼働する
 * データ収集プロセス自体は落とさない。個々の操作コマンドのエラーは
 * CommandHandler が commandResult(ok:false) としてフロントへ返す経路が別に
 * あるため、この安全網はあくまで「どのハンドラにも紐づかない背景の非同期
 * エラー」だけを受け止める最後の砦である。
 */
export function installProcessSafetyNet(
  log: (message: string, detail: unknown) => void = (message, detail) =>
    console.error(message, detail),
): void {
  process.on("unhandledRejection", (reason) => {
    log(
      "[collector] unhandled promise rejection; keeping the collector alive:",
      reason,
    );
  });
  process.on("uncaughtException", (err) => {
    log(
      "[collector] uncaught exception; keeping the collector alive:",
      err,
    );
  });
}

/**
 * アダプタでポーリング→store へ取り込み→差分を配信、を周期実行する。
 * 前回のポーリングが完了してから次を予約する（重複実行を避ける）。
 */
export function startPollingLoop(
  adapter: EthereumAdapter,
  store: WorldStateStore,
  server: CollectorServer,
  intervalMs: number = POLL_INTERVAL_MS,
  onError: (err: unknown) => void = (err) => console.error("[collector] poll failed:", err),
): PollingLoop {
  let running = true;
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    if (!running) return;
    try {
      const partial = await adapter.pollInfra();
      const diff = store.applyInfra(partial.entities ?? []);
      server.broadcastDiff(diff);
    } catch (err) {
      onError(err);
    }
    if (running) timer = setTimeout(() => void tick(), intervalMs);
  };

  void tick();

  return {
    stop(): void {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}

export async function main(port: number = DEFAULT_PORT): Promise<void> {
  const docker = new Docker();
  const poller = new DockerPoller(createDockerClient(docker));
  const adapter = new EthereumAdapter(poller);
  const store = new WorldStateStore("ethereum");

  // 操作コマンド（ノード/ワークベンチの追加・削除）の処理を配線する。
  const lifecycle = new EthereumNodeLifecycle(createDockerOperations(docker), {
    profileDir: resolveProfileDir(),
  });
  const commands = new CommandHandler(lifecycle);
  const server = new CollectorServer(store, commands);

  await server.listen(port);
  console.log(`[collector] WebSocket server listening on port ${port}`);

  // A 層: Docker のインフラ観測を周期ポーリングして配信する。
  startPollingLoop(adapter, store, server);

  // B 層: ピア接続（Beacon API）とブロック受信タイミング（eth_subscribe）を
  // 購読し、差分をワールドステート store 経由でフロントへ配信する。
  adapter.subscribePeers((edges) => {
    const diff = store.applyPeers(edges);
    server.broadcastDiff(diff);
  });
  adapter
    .subscribeBlocks((block) => {
      const diff = store.applyBlock(block);
      server.broadcastDiff(diff);
    })
    .catch((err) => console.error("[collector] block subscription failed:", err));
}

// 直接実行されたときだけサーバーを起動する（import 時は副作用なし）。
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  // 背景の非同期エラーでプロセスごと落ちて managed コンテナを孤児化させないよう、
  // サーバー起動前に安全網を張る（Issue #63）。
  installProcessSafetyNet();
  main(resolvePort()).catch((err) => {
    console.error("[collector] fatal:", err);
    process.exit(1);
  });
}
