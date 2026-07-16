import path from "node:path";
import { fileURLToPath } from "node:url";

/** リポジトリルートの絶対パス（packages/e2e/src/helpers から 4 つ上）。 */
export const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../..", import.meta.url)),
);

/** Ethereum プロファイルの docker-compose.yml のパス。 */
export const composeFile = path.join(
  repoRoot,
  "profiles/ethereum/docker-compose.yml",
);

/**
 * Ethereum プロファイルの values.env のパス。slot time
 * （`SLOT_DURATION_IN_SECONDS`）など、テストの待ち時間・タイムアウトが依存する
 * チェーン設定の単一の出所。`helpers/slot-time.ts` がこのファイルをパースして
 * 値を導出する。
 */
export const valuesEnvFile = path.join(repoRoot, "profiles/ethereum/values.env");

/** collector のビルド済みエントリポイント（子プロセスとして起動する）。 */
export const collectorEntry = path.join(
  repoRoot,
  "packages/collector/dist/index.js",
);
