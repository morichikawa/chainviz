import { defineConfig } from "vitest/config";

// docker を必要としない純粋ロジックのユニットテスト（*.unit.test.ts）専用の
// 設定。実 Docker / collector を使う e2e テスト（vitest.config.ts）とは分離し、
// 通常の `pnpm test`（docker 不要）で高速に回せるようにする。
export default defineConfig({
  test: {
    include: ["src/**/*.unit.test.ts"],
  },
});
