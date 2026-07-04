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

/** collector のビルド済みエントリポイント（子プロセスとして起動する）。 */
export const collectorEntry = path.join(
  repoRoot,
  "packages/collector/dist/index.js",
);
