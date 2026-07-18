// 複数クライアント・再接続(UI-MULTI-01・UI-MULTI-02)。
// packages/e2e/SCENARIOS.md「複数クライアント・再接続(UI-MULTI)」節の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// `browser.newContext()` で複数の独立したブラウザコンテキスト（Cookie/
// localStorageを共有しない、別クライアント相当）を作り、それぞれの `page`
// を使い分ける。移行元WSテスト(`reconnect.test.ts`の「再接続時のスナップ
// ショット整合性」「複数クライアント同時接続時の差分配信」の2 describe)は
// このファイルへの移行に伴い削除した(docs/worklog/issue-202.md 設計メモ参照)。

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { cleanupRemovableCards } from "./support/cleanup.js";
import {
  ENTITY_APPEAR_TIMEOUT_MS,
  submitAddWorkbench,
} from "./support/operations.js";
import { serviceEntityId } from "./support/serviceIds.js";
import { fitCanvasView } from "./support/viewport.js";

/** compose起動の6ノードカードが揃うまで待つ(baseline確立。#200と同じ理由)。 */
async function waitForBaselineNodes(page: Page): Promise<void> {
  await expect(page.locator(".infra-card--node")).toHaveCount(6, {
    timeout: ENTITY_APPEAR_TIMEOUT_MS,
  });
}

test.describe("UI-MULTI 複数クライアント・再接続シナリオ", () => {
  /** 途中失敗時の後始末対象(commands-workbench.spec.tsと同じ安全網パターン)。 */
  const addedWorkbenchIds: string[] = [];

  test.afterAll(async ({ browser }) => {
    // 途中失敗時の後始末を共有ヘルパーに委ねる(commands-node.spec.ts /
    // commands-workbench.spec.ts / wallet-balance.spec.ts /
    // token-balance.spec.ts と同じ安全網パターン。Issue #233 で1箇所に
    // 集約した。goto直後のスナップショット未反映による誤判定・削除完了を
    // 待たない page.close の2つの競合状態はここで解消済み)。
    await cleanupRemovableCards(browser, addedWorkbenchIds, {
      timeoutMs: ENTITY_APPEAR_TIMEOUT_MS,
    });
  });

  test("UI-MULTI-01: 一方の操作がもう一方のブラウザにも反映される", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const label = "e2e-ui-multi-01";
    const workbenchId = serviceEntityId(label);

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await test.step(
        "前提: 2 つのブラウザコンテキスト A / B で frontend を開いている",
        async () => {
          await pageA.goto("/");
          await pageB.goto("/");
          // 差分の反映を正しく検知するため、両方でスナップショット反映
          // (baseline確立)を待ってから操作する。
          await waitForBaselineNodes(pageA);
          await waitForBaselineNodes(pageB);
        },
      );

      await test.step("A でワークベンチを追加する", async () => {
        await submitAddWorkbench(pageA, label);
      });
      addedWorkbenchIds.push(workbenchId);

      await test.step(
        "A と B の両方にワークベンチカードが現れる（ブロードキャスト配信）",
        async () => {
          await expect(pageA.getByTestId(`infra-card-${workbenchId}`)).toBeVisible({
            timeout: ENTITY_APPEAR_TIMEOUT_MS,
          });
          await expect(pageB.getByTestId(`infra-card-${workbenchId}`)).toBeVisible({
            timeout: ENTITY_APPEAR_TIMEOUT_MS,
          });
        },
      );

      await test.step("B でそのワークベンチを削除する", async () => {
        // pageB のロード後に pageA が追加したワークベンチは、pageB 側の
        // 初期フィットの対象外(Issue #373)。実座標クリック前にフィット
        // ボタンで視野に収める(support/viewport.ts 参照。削除ボタン自体を
        // 対象として渡し、視野内へ入ったことを確認してから進める)。
        const removeButton = pageB.getByTestId(
          `infra-card-remove-${workbenchId}`,
        );
        await fitCanvasView(pageB, removeButton);
        await removeButton.click();
      });

      await test.step("A と B の両方からカードが消える", async () => {
        await expect(pageA.getByTestId(`infra-card-${workbenchId}`)).toHaveCount(
          0,
          { timeout: ENTITY_APPEAR_TIMEOUT_MS },
        );
        await expect(pageB.getByTestId(`infra-card-${workbenchId}`)).toHaveCount(
          0,
          { timeout: ENTITY_APPEAR_TIMEOUT_MS },
        );
      });
      // シナリオどおり削除まで完了したので、afterAllの安全網対象から外す。
      const idx = addedWorkbenchIds.indexOf(workbenchId);
      if (idx >= 0) addedWorkbenchIds.splice(idx, 1);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("UI-MULTI-02: 切断中の変更がリロード後のスナップショットに反映される", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const label = "e2e-ui-multi-02";
    const workbenchId = serviceEntityId(label);

    const contextA = await browser.newContext();
    try {
      let pageA = await contextA.newPage();

      await test.step(
        "前提: ブラウザコンテキスト A で frontend を開き、対象ワークベンチが" +
          "無いことを確認している",
        async () => {
          await pageA.goto("/");
          await waitForBaselineNodes(pageA);
          await expect(pageA.getByTestId(`infra-card-${workbenchId}`)).toHaveCount(
            0,
          );
        },
      );

      await test.step("A のページを閉じる（切断）", async () => {
        await pageA.close();
      });

      const contextB = await browser.newContext();
      try {
        const pageB = await contextB.newPage();
        await test.step("別コンテキスト B でワークベンチを追加する", async () => {
          await pageB.goto("/");
          await submitAddWorkbench(pageB, label);
          addedWorkbenchIds.push(workbenchId);
          await expect(pageB.getByTestId(`infra-card-${workbenchId}`)).toBeVisible({
            timeout: ENTITY_APPEAR_TIMEOUT_MS,
          });
        });
      } finally {
        await contextB.close();
      }

      await test.step(
        "A で再度ページを開く（再接続 = 新しいスナップショット受信）",
        async () => {
          pageA = await contextA.newPage();
          await pageA.goto("/");
        },
      );

      await test.step(
        "A に切断中に追加されたワークベンチが表示される" +
          "（古いスナップショットのまま止まっていない）",
        async () => {
          await expect(pageA.getByTestId(`infra-card-${workbenchId}`)).toBeVisible(
            { timeout: ENTITY_APPEAR_TIMEOUT_MS },
          );
        },
      );
    } finally {
      await contextA.close();
    }
  });
});
