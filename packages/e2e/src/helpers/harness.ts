// 各 E2E テストファイルが使う共通のセットアップ／後片付け。
// 実 Docker スタックを起動（既存を再利用）し、collector を子プロセスとして
// 起動し、WebSocket テストクライアントを接続する。

import { ensureChainRunning } from "./docker.js";
import { startCollector, type RunningCollector } from "./collector.js";
import { CollectorTestClient } from "./ws-client.js";

export interface Harness {
  collector: RunningCollector;
  client: CollectorTestClient;
}

/** チェーン起動 → collector 起動 → クライアント接続まで済ませて返す。 */
export async function setupHarness(): Promise<Harness> {
  await ensureChainRunning();
  const collector = await startCollector();
  const client = new CollectorTestClient(collector.port);
  await client.connect();
  return { collector, client };
}

/** クライアントを閉じ、collector 子プロセスを停止する。 */
export async function teardownHarness(harness: Harness): Promise<void> {
  harness.client.close();
  await harness.collector.stop();
}
