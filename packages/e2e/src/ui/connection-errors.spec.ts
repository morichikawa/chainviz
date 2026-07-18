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
    });

    await test.step(
      "WebSocket未接続でコマンドがそもそも送信できないため、ゴーストカードは" +
        "作られず、即座にエラートーストで理由が利用者に伝わる（Issue #235で" +
        "修正済み。以前は楽観的にゴーストカードが作られ、GHOST_TIMEOUT_MS" +
        "（60秒）後に通知なく静かに消えるだけだった。websocket/client.tsの" +
        "sendCommandが未接続時にundefinedを返すよう修正され、" +
        "useCommands.tsのdispatchがゴーストを作らず" +
        "describeCommandNotConnectedErrorのトーストを即座に出すようになった）",
      async () => {
        // 先にエラートーストの出現を待つ。これが「即座にエラーが利用者へ
        // 伝わる」ことの検証であると同時に、クリックの dispatch が実際に処理
        // され描画が一巡したことの確認になる。トーストを待たずに先にゴースト数
        // 0を検証すると、クリック処理前の空の状態を評価して素通りしうるため
        // （ゴーストが作られる退行を見逃す）、必ずトーストの出現を待ってから
        // ゴースト数を確認する。
        const toast = page.locator('[data-testid^="toast-"]').first();
        await expect(toast).toBeVisible();
        await expect(toast).toHaveClass(/toast--error/);
        // トーストが理由の分かる文言を含むこと（空のトーストで素通りしない）。
        await expect(toast).not.toBeEmpty();
        // addNodeはEL/CLの2枚のゴーストを生むが(commands-node.spec.tsと同じ)、
        // 未接続時はコマンド自体を送信しない設計に変わったため、ゴーストは
        // 1枚も作られない。トースト出現（=dispatch完了）後に確認することで、
        // 「ゴーストが一瞬でも作られていない」ことを意味のある形で検証する。
        await expect(anyGhostCard(page)).toHaveCount(0);
      },
    );
  });
});
