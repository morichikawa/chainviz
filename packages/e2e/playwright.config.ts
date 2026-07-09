// UI 層 E2E（`pnpm test:e2e:ui`）の Playwright 設定。
//
// プロトコル層（`vitest.config.ts`）とは別のテスト対象・起動トポロジを
// 持つ（docs/ARCHITECTURE.md §8）。globalSetup で実 Docker スタック・
// collector（UI 層専用ポート）を起動し、webServer で vite dev server を
// 起動したうえで、chromium から実際に frontend を操作する。

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { UI_E2E_COLLECTOR_PORT } from "./src/helpers/playwright-global-setup.js";

const repoRoot = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

/**
 * UI 層 E2E 専用の frontend(vite dev) ポート。
 * 既存の dev(5173) と衝突しない値（docs/ARCHITECTURE.md §8.3）。
 */
const UI_E2E_FRONTEND_PORT = 5275;

export default defineConfig({
  // vitest 側（プロトコル層: src/**/*.test.ts、ユニット: src/**/*.unit.test.ts）
  // と対象ファイルが重ならないよう、UI 層は src/ui/*.spec.ts に限定する。
  testDir: "./src/ui",
  testMatch: "**/*.spec.ts",
  // 実 Docker スタック・単一の collector/vite dev server を全テストで
  // 共有するため、vitest 側の fileParallelism: false と同じ考え方で
  // 直列実行にする（状態変更を伴う操作シナリオでの並列由来のフレーキーさを
  // 避ける。docs/worklog/issue-197.md 設計メモ参照）。
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  globalSetup: "./src/helpers/playwright-global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${UI_E2E_FRONTEND_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm --filter @chainviz/frontend exec vite --port ${UI_E2E_FRONTEND_PORT}`,
    cwd: repoRoot,
    port: UI_E2E_FRONTEND_PORT,
    // 既存の別プロセスの vite dev server を誤って使い回さない
    // （stale な VITE_COLLECTOR_URL を掴む事故を避ける）。
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      VITE_COLLECTOR_URL: `ws://127.0.0.1:${UI_E2E_COLLECTOR_PORT}`,
    },
  },
});
