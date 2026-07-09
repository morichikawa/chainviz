// Playwright 基盤（globalSetup での Docker/collector 起動、webServer での
// vite dev 起動）が実際に end-to-end で疎通することだけを確認する土台
// テスト。SCENARIOS.md の正式な UI シナリオ（UI-CONN-01 等）は #199
// （基本表示シナリオ実装）で追加される。実装後はこのファイルを削除して
// よい（docs/worklog/issue-197.md 設計メモ参照）。

import { expect, test } from "@playwright/test";

test("foundation: frontend が起動し実 collector に接続できる", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle("chainviz");
  // #198 で追加された data-testid（接続ステータスバッジ）を実際に
  // Playwright のロケータとして使えることを確認する。
  await expect(page.getByTestId("connection-status-badge")).toHaveClass(
    /status-badge--connected/,
    { timeout: 30_000 },
  );
});
