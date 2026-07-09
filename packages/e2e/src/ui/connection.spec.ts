// UI-CONN-01（接続・初期表示）。packages/e2e/SCENARIOS.md「接続・初期表示
// (UI-CONN)」節の実装（docs/ARCHITECTURE.md §8.4 の記法規約に従う）。
//
// globalSetup（helpers/playwright-global-setup.ts）が実 Docker スタックと
// UI 層専用ポートの collector を起動済みの前提で実行される。

import { expect, test } from "@playwright/test";

test("UI-CONN-01: collector に接続すると接続済みバッジが表示される", async ({
  page,
}) => {
  await test.step("collector が起動している", async () => {
    // globalSetup が ensureChainRunning() + startCollector() 済みであることの
    // 前提確認。frontend 側からは何も操作しないため、このテスト内では
    // 実際の接続確認（次のステップ）をもって間接的に成立を確認する。
  });

  await test.step("ブラウザで frontend を開く", async () => {
    await page.goto("/");
  });

  const badge = page.getByTestId("connection-status-badge");

  await test.step("接続ステータスバッジが「接続済み」になる", async () => {
    await expect(badge).toHaveClass(/status-badge--connected/, {
      timeout: 30_000,
    });
    await expect(badge).toContainText("接続済み");
  });

  await test.step("「モックデータ」の表記が無い（実 collector に接続している）", async () => {
    await expect(badge).not.toContainText("モックデータ");
  });
});
