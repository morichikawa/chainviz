import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

// E2E テストは実 Docker + 実 collector を相手にするため、通常のユニット
// テストより大幅に時間がかかる。またチェーン（単一の Docker スタック）と
// collector プロセスを共有するため、ファイル・テストを直列に実行する。
// docker を必要としない純粋ロジックのユニットテスト（*.unit.test.ts）は
// この e2e 実行から除外し、vitest.unit.config.ts 側（pnpm test）で回す。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.unit.test.ts"],
    // ブロック伝播や addNode 後の履歴バックフィルを待つため長めに取る。
    testTimeout: 180_000,
    hookTimeout: 240_000,
    // 単一の Docker スタック / collector を共有するので並列化しない。
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
