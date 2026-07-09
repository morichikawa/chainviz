// 操作: ワークベンチの追加・削除(UI-CMD-05〜07)。packages/e2e/SCENARIOS.md
// 「操作: ノード/ワークベンチの追加・削除(UI-CMD)」節の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。
//
// UI-CMD-05→06→07 は「05/06 で追加したワークベンチを 07 でまとめて削除する」
// という前提の連鎖(SCENARIOS.md に明記)。commands-node.spec.ts と同じ理由で
// test.describe.serial でグルーピングし、追加したワークベンチの entity id を
// モジュールスコープの変数で引き継ぐ(docs/worklog/issue-200.md 設計メモ参照)。

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { serviceEntityId } from "./support/serviceIds.js";

/**
 * addWorkbench で追加したワークベンチのカード/所有エッジ/ウォレットカードが
 * 出現するまでの待ち上限。既存プロトコル層テスト(commands.test.ts /
 * error-paths.test.ts)が同じ観測に対して timeoutMs: 30_000 で安定して
 * 通っている実績値をそのまま踏襲する。
 */
const ADD_WORKBENCH_CARD_TIMEOUT_MS = 30_000;

/** 生成中のゴーストカード(種類を問わない)を指すロケータ。 */
function anyGhostCard(page: Page): Locator {
  return page.locator('[data-testid^="ghost-card-"]');
}

/**
 * ワークベンチ→ウォレットの所有エッジ(`own-<workbenchId>-<address>` の
 * data-id)から、対象ウォレットのアドレスを取り出す。
 *
 * prefixに`-0x`まで含めるのは、workbenchIdどうしが前方一致してしまう
 * ケース(例: "e2e-ui-carol" と "e2e-ui-carol-2")でロケータが曖昧に
 * ならないようにするため(アドレスは常に0x始まりのため、この位置まで
 * 含めれば別workbenchIdのエッジを誤って拾わない)。
 */
async function ownershipEdgeWalletAddress(
  page: Page,
  workbenchId: string,
): Promise<string> {
  const prefix = `own-${workbenchId}-0x`;
  const edge = page.locator(`[data-id^="${prefix}"]`).first();
  await expect(edge).toHaveCount(1, { timeout: ADD_WORKBENCH_CARD_TIMEOUT_MS });
  const dataId = await edge.getAttribute("data-id");
  if (!dataId) {
    throw new Error(`ownership edge for ${workbenchId} has no data-id`);
  }
  // prefixには曖昧さ回避のため"0x"まで含めているが、戻り値のアドレス
  // 自体は"0x"を含める必要があるため、その分(2文字)を巻き戻して切り出す。
  return dataId.slice(prefix.length - 2);
}

/** ツールバーからラベルを入力してワークベンチ追加ボタンを押す。 */
async function submitAddWorkbench(page: Page, label: string): Promise<void> {
  await page.getByTestId("canvas-toolbar-workbench-label").fill(label);
  await page.getByTestId("canvas-toolbar-add-workbench").click();
}

test.describe.serial("UI-CMD ワークベンチ追加・削除の連鎖シナリオ", () => {
  /** UI-CMD-05/06 で追加したワークベンチの entity id。07 がまとめて削除する。 */
  const addedWorkbenchIds: string[] = [];

  test.afterAll(async ({ browser }) => {
    // UI-CMD-07 が失敗して削除できなかった場合の後始末(残存コンテナを
    // 残さない。commands.test.ts の afterAll と同じ考え方)。
    if (addedWorkbenchIds.length === 0) return;
    const page = await browser.newPage();
    try {
      await page.goto("/");
      for (const workbenchId of addedWorkbenchIds) {
        const removeButton = page.getByTestId(`infra-card-remove-${workbenchId}`);
        if ((await removeButton.count()) > 0) {
          await removeButton.click();
        }
      }
    } finally {
      await page.close();
    }
  });

  test("UI-CMD-05: ラベルを入れてワークベンチを追加できる", async ({ page }) => {
    await page.goto("/");
    const label = "e2e-ui-alice";
    const workbenchId = serviceEntityId(label);

    await test.step(
      'ツールバーのラベル入力欄に「e2e-ui-alice」と入れて「ワークベンチ追加」ボタンを押す',
      async () => {
        await submitAddWorkbench(page, label);
      },
    );

    await test.step(
      "ゴーストカードの後、ワークベンチのカードが現れる",
      async () => {
        // addWorkbench はワークベンチ 1 枚分のゴーストを生む
        // (frontend useCommands.ts の dispatch)。ボタンを 1 回だけ押した前提
        // (Issue #220 の連打防止は未実装)なので、ゴーストはちょうど 1 枚。
        // 件数を固定し、コマンドの二重発行(2 枚になる)を早期に検知する。
        await expect(anyGhostCard(page)).toHaveCount(1);
        await expect(anyGhostCard(page).first()).toBeVisible();
        await expect(page.getByTestId(`infra-card-${workbenchId}`)).toBeVisible({
          timeout: ADD_WORKBENCH_CARD_TIMEOUT_MS,
        });
        await expect(anyGhostCard(page)).toHaveCount(0);
      },
    );

    await test.step(
      "しばらく待つと、そのワークベンチのウォレットカード（wallet-card-<address>）と所有エッジが現れる（C層）",
      async () => {
        const address = await ownershipEdgeWalletAddress(page, workbenchId);
        await expect(page.getByTestId(`wallet-card-${address}`)).toBeVisible();
      },
    );

    addedWorkbenchIds.push(workbenchId);
  });

  test("UI-CMD-06: 同じラベルで 2 回追加すると 2 枚が共存する", async ({
    page,
  }) => {
    await page.goto("/");
    const label = "e2e-ui-carol";
    const firstId = serviceEntityId(label);
    const secondId = serviceEntityId(`${label}-2`);

    await test.step("同じラベルでワークベンチを 2 回追加する", async () => {
      await submitAddWorkbench(page, label);
      await expect(page.getByTestId(`infra-card-${firstId}`)).toBeVisible({
        timeout: ADD_WORKBENCH_CARD_TIMEOUT_MS,
      });

      await submitAddWorkbench(page, label);
      await expect(page.getByTestId(`infra-card-${secondId}`)).toBeVisible({
        timeout: ADD_WORKBENCH_CARD_TIMEOUT_MS,
      });
    });

    await test.step(
      "2 枚のワークベンチカードが別々の ID（2 枚目は -2 付き）で共存する",
      async () => {
        await expect(page.getByTestId(`infra-card-${firstId}`)).toBeVisible();
        await expect(page.getByTestId(`infra-card-${secondId}`)).toBeVisible();
      },
    );

    addedWorkbenchIds.push(firstId, secondId);
  });

  test("UI-CMD-07: 追加したワークベンチは削除ボタンで消える", async ({ page }) => {
    expect(addedWorkbenchIds.length, "UI-CMD-05/06 must have run first").toBe(3);

    await page.goto("/");
    // 削除前に、各ワークベンチが所有するウォレットのアドレスを控えておく
    // (削除後にオーファン表示で残ることを確認するため)。
    const walletAddressByWorkbenchId = new Map<string, string>();
    for (const workbenchId of addedWorkbenchIds) {
      await expect(page.getByTestId(`infra-card-${workbenchId}`)).toBeVisible();
      walletAddressByWorkbenchId.set(
        workbenchId,
        await ownershipEdgeWalletAddress(page, workbenchId),
      );
    }

    await test.step(
      "UI-CMD-05/06 で追加したワークベンチの削除ボタンを押す",
      async () => {
        for (const workbenchId of addedWorkbenchIds) {
          await page.getByTestId(`infra-card-remove-${workbenchId}`).click();
        }
      },
    );

    await test.step("ワークベンチのカードが消える", async () => {
      for (const workbenchId of addedWorkbenchIds) {
        await expect(page.getByTestId(`infra-card-${workbenchId}`)).toHaveCount(
          0,
          { timeout: ADD_WORKBENCH_CARD_TIMEOUT_MS },
        );
      }
    });

    await test.step(
      "付随するウォレットカードは削除されず残るが、所有者削除済み（オーファン）の表示になる（CONCEPT.md「ノード/ワークベンチを削除したときの過去データの扱い」の設計どおり）",
      async () => {
        for (const workbenchId of addedWorkbenchIds) {
          const address = walletAddressByWorkbenchId.get(workbenchId);
          if (!address) throw new Error(`no wallet address recorded for ${workbenchId}`);
          await expect(page.getByTestId(`wallet-card-${address}`)).toBeVisible();
          await expect(page.getByTestId(`wallet-orphan-${address}`)).toBeVisible();
        }
      },
    );

    addedWorkbenchIds.length = 0;
  });
});
