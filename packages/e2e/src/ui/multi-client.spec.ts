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
import {
  ENTITY_APPEAR_TIMEOUT_MS,
  submitAddWorkbench,
} from "./support/operations.js";
import { serviceEntityId } from "./support/serviceIds.js";

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
    if (addedWorkbenchIds.length === 0) return;
    const page = await browser.newPage();
    try {
      await page.goto("/");
      // スナップショット反映前に `count()` を同期的に読むと「まだカードが
      // 届いていないだけ」を「既に削除済み」と誤判定し、後片付けを
      // 静かにスキップしてしまう(commands-node.spec.ts/commands-workbench.spec.ts
      // にも同型の即時 count() チェックがあり、同じ race の可能性がある。
      // 既存ファイルへの手当ては本Issueの範囲を超えるため、この点は
      // Issue #238 に追記して別途フォローアップする)。ここでは
      // `.click()` 自体にPlaywrightの自動待機(タイムアウト付き)を
      // 任せ、最初から存在しない(=既に削除済み)場合だけタイムアウトを
      // 握りつぶす。
      for (const workbenchId of addedWorkbenchIds) {
        const removeButton = page.getByTestId(`infra-card-remove-${workbenchId}`);
        await removeButton.click({ timeout: ENTITY_APPEAR_TIMEOUT_MS }).catch(() => {});
      }
    } finally {
      await page.close();
    }
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
        await pageB.getByTestId(`infra-card-remove-${workbenchId}`).click();
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
