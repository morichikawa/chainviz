// 異常系: collector プロセスの停止・再起動(UI-ERR-01・UI-ERR-02)。
// packages/e2e/SCENARIOS.md「異常系(UI-ERR)」節の一部の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// この2シナリオは実際に collector プロセスを停止・再起動する必要がある。
// globalSetup が起動した collector は `helpers/collector-registry.ts` の
// ファイルベースの受け渡しへ登録されており、このファイルは
// `stopRegisteredCollector()`/`registerCollector()` 経由で「今生きている
// collector」を安全に停止・差し替える(docs/worklog/issue-202.md 設計メモ
// 参照。globalSetup/globalTeardownはPlaywrightの別プロセスで動くため、
// メモリ上の参照ではなくファイル経由でしか受け渡せない)。UI-ERR-02は
// シナリオの性質上collectorを止めたままテストを終える構成になるため、
// `test.afterEach`で「止まっていれば再起動する」安全網を必ず通し、後続の
// 他specファイルに影響を残さない。

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { startCollector } from "../helpers/collector.js";
import {
  isRegisteredCollectorAlive,
  registerCollector,
  stopRegisteredCollector,
} from "../helpers/collector-registry.js";
import { UI_E2E_COLLECTOR_PORT } from "../helpers/playwright-global-setup.js";

/**
 * 切断バッジ反映待ちの上限。collector プロセスの終了は OS レベルで TCP
 * 接続を即座に閉じるため実測は 12ms 程度だが、実行環境の負荷変動を見込み
 * 安全側に既存の接続バッジ関連の実績値(`connection.spec.ts`)を踏襲する。
 */
const BADGE_TIMEOUT_MS = 30_000;

/**
 * ゴーストカード消滅待ちの上限。`entities/ghostNode.ts` の
 * `GHOST_TIMEOUT_MS`(60_000ms。frontend側の固定UX定数で、実行環境の状態
 * に依存しない)に安全マージンを足す。この値自体が変わった場合はこちらも
 * 追随させて見直すこと。
 */
const GHOST_TIMEOUT_MARGIN_MS = 10_000;
const GHOST_DISAPPEAR_TIMEOUT_MS = 60_000 + GHOST_TIMEOUT_MARGIN_MS;

/** 生成中のゴーストカード(種類を問わない)を指すロケータ。 */
function anyGhostCard(page: Page) {
  return page.locator('[data-testid^="ghost-card-"]');
}

/** collector を再起動し、レジストリ(受け渡しファイル)へ登録し直す。 */
async function restartCollector(): Promise<void> {
  const restarted = await startCollector(UI_E2E_COLLECTOR_PORT);
  registerCollector(restarted);
}

test.describe("UI-ERR collectorプロセスの停止・再起動", () => {
  test.afterEach(async () => {
    // UI-ERR-02はcollectorを止めたままテストを終える構成のため、後続の
    // 他specファイルに影響を残さないよう、止まっていれば必ず再起動する。
    if (isRegisteredCollectorAlive()) return; // UI-ERR-01は自分で再起動して終わる。
    await restartCollector();
  });

  test("UI-ERR-01: collector が落ちると切断バッジになる", async ({ page }) => {
    test.setTimeout(60_000);

    await test.step("frontend が collector に接続済み（「接続済み」バッジ）", async () => {
      await page.goto("/");
      await expect(page.getByTestId("connection-status-badge")).toHaveClass(
        /status-badge--connected/,
        { timeout: BADGE_TIMEOUT_MS },
      );
      // 後段の「カード一式が再表示される」を検証できるよう、collector停止前に
      // compose起動の6ノードカードが揃っていることも確認しておく。
      await expect(page.locator(".infra-card--node")).toHaveCount(6, {
        timeout: BADGE_TIMEOUT_MS,
      });
    });

    await test.step("（テストハーネスが）collector プロセスを停止する", async () => {
      await stopRegisteredCollector();
    });

    await test.step("接続ステータスバッジが「切断」に変わる", async () => {
      await expect(page.getByTestId("connection-status-badge")).toHaveClass(
        /status-badge--disconnected/,
        { timeout: BADGE_TIMEOUT_MS },
      );
    });

    await test.step("collector を再起動し、ページをリロードする", async () => {
      await restartCollector();
      await page.reload();
    });

    await test.step("「接続済み」に戻り、カード一式が再表示される", async () => {
      await expect(page.getByTestId("connection-status-badge")).toHaveClass(
        /status-badge--connected/,
        { timeout: BADGE_TIMEOUT_MS },
      );
      await expect(page.locator(".infra-card--node")).toHaveCount(6, {
        timeout: BADGE_TIMEOUT_MS,
      });
    });
  });

  test("UI-ERR-02: collector 停止中の追加操作はエラーが利用者に伝わる", async ({
    page,
  }) => {
    // ゴースト消滅待ち(最大70秒)を含むため、既定の60秒から延長する。
    test.setTimeout(120_000);

    await test.step(
      "（前提の再現）collector が停止し「切断」バッジが出ている",
      async () => {
        await page.goto("/");
        await expect(page.getByTestId("connection-status-badge")).toHaveClass(
          /status-badge--connected/,
          { timeout: BADGE_TIMEOUT_MS },
        );
        await stopRegisteredCollector();
        await expect(page.getByTestId("connection-status-badge")).toHaveClass(
          /status-badge--disconnected/,
          { timeout: BADGE_TIMEOUT_MS },
        );
      },
    );

    await test.step("ツールバーの「ノード追加」ボタンを押す", async () => {
      await page.getByTestId("canvas-toolbar-add-node").click();
      // addNodeはEL/CLの2枚のゴーストを生む(commands-node.spec.tsと同じ)。
      await expect(anyGhostCard(page)).toHaveCount(2);
    });

    await test.step(
      "ゴーストカードが出た後、タイムアウト（60秒。GHOST_TIMEOUT_MS）で" +
        "ゴーストカードが静かに消える（実装時に実挙動を確認した結果、" +
        "エラートーストは表示されない。既知の問題として Issue #235 で" +
        "起票済み）",
      async () => {
        await expect(anyGhostCard(page)).toHaveCount(0, {
          timeout: GHOST_DISAPPEAR_TIMEOUT_MS,
        });
        // ゴースト消滅後もエラートーストが出ていないことを確認する
        // (Issue #235で報告した「トーストが出ない」実挙動そのものの検証)。
        await expect(page.locator('[data-testid^="toast-"]')).toHaveCount(0);
      },
    );
  });
});
