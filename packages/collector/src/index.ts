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
  main().catch((err) => {
    console.error("[collector] fatal:", err);
    process.exit(1);
  });
}
