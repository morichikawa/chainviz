// ブロック詳細パネル（UI-B-07。Issue #409）。
// packages/e2e/SCENARIOS.md「B層: P2P グラフ（UI-B）」節の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。

import { expect, test } from "@playwright/test";
import { SLOT_DURATION_MS } from "../helpers/slot-time.js";

/**
 * 新しいタイル・次ブロックの観測を待つ上限。`chain-ribbon.spec.ts` の
 * `RIBBON_TILE_TIMEOUT_MS` と同じ考え方（次スロットまでの slot 比例分 +
 * コールドスタック等の固定オーバーヘッド）で、ここではブロック詳細パネル
 * 固有の待ちにも同じ式を使う（1ファイル1責務のため定数自体は複製するが、
 * 導出式・値の出所は同じ `SLOT_DURATION_MS` に一元化されている）。
 */
const BLOCK_DETAIL_TIMEOUT_MS = SLOT_DURATION_MS * 3 + 20_000;

const CHAIN_RIBBON_TILE_SELECTOR =
  '[data-testid^="chain-ribbon-tile-"][data-connected-to-previous]';

test("UI-B-07: ブロック詳細パネルで保持窓内を前後に辿れる", async ({ page }) => {
  await test.step(
    "frontend を開き、チェーンリボンカードにタイルが1件以上表示されるまで待つ",
    async () => {
      await page.goto("/");
      await expect(page.getByTestId("chain-ribbon-card")).toBeVisible({
        timeout: BLOCK_DETAIL_TIMEOUT_MS,
      });
      await expect(page.locator(CHAIN_RIBBON_TILE_SELECTOR).first()).toBeVisible({
        timeout: BLOCK_DETAIL_TIMEOUT_MS,
      });
    },
  );

  let firstHash = "";

  await test.step(
    "最初に表示されたタイルにホバーし、ポップオーバーの「ブロック詳細を見る」からパネルを開く",
    async () => {
      const tile = page.locator(CHAIN_RIBBON_TILE_SELECTOR).first();
      firstHash =
        (await tile.getAttribute("data-testid"))?.replace("chain-ribbon-tile-", "") ?? "";
      if (!firstHash) throw new Error("chain ribbon tile has no data-testid");
      await tile.hover();
      await page
        .getByTestId(`chain-ribbon-popover-block-detail-open-${firstHash}`)
        .click();
    },
  );

  await test.step(
    "サイドパネル（block-detail-view）が開き、対象ブロックの hash が表示される",
    async () => {
      const panel = page.getByTestId("block-detail-view");
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(firstHash);
    },
  );

  await test.step(
    "保持期間の境界（起動直後に観測できる最古のブロックの親は保持窓の外）で「前のブロック」が disabled になり、理由が示される",
    async () => {
      // Issue #409 の設計メモの通り、collector は起動（サブスクライブ開始）
      // 以前のブロックをそもそも観測していないため、この確認に32ブロック分
      // 待つ必要はない。テスト開始直後の最古タイルで自然に境界へ到達する。
      await expect(page.getByTestId(`block-detail-prev-${firstHash}`)).toBeDisabled();
      await expect(page.getByTestId("block-detail-prev-reason")).toBeVisible();
    },
  );

  await test.step(
    "しばらく待つと次のブロックが観測されて「次のブロック」ボタンが有効になり、クリックするとパネルの中身が子ブロックへ差し替わる",
    async () => {
      const nextButton = page.getByTestId(`block-detail-next-${firstHash}`);
      await expect(nextButton).toBeEnabled({ timeout: BLOCK_DETAIL_TIMEOUT_MS });
      await nextButton.click();
      await expect(page.getByTestId("block-detail-view")).not.toContainText(firstHash);
      // 1枚のパネルのまま中身だけが差し替わる（新しいパネルが重ねて開かない）。
      await expect(page.getByTestId("side-panel")).toHaveCount(1);
    },
  );

  await test.step(
    "差し替わった後の「前のブロック」で元のブロックへ戻れる",
    async () => {
      const childHash =
        (await page
          .getByTestId("block-detail-view")
          .locator('[data-testid^="block-detail-prev-"]')
          .getAttribute("data-testid"))?.replace("block-detail-prev-", "") ?? "";
      if (!childHash) throw new Error("block detail view has no prev button data-testid");
      await page.getByTestId(`block-detail-prev-${childHash}`).click();
      await expect(page.getByTestId("block-detail-view")).toContainText(firstHash);
    },
  );

  await test.step(
    "チェーンリボンの最新タイル（chain-ribbon-latest と同じブロック）のブロック詳細を開くと、「次のブロック」が disabled になり「最新のブロックです」の理由が示される",
    async () => {
      const latestTile = page.locator(CHAIN_RIBBON_TILE_SELECTOR).last();
      const latestHash =
        (await latestTile.getAttribute("data-testid"))?.replace(
          "chain-ribbon-tile-",
          "",
        ) ?? "";
      if (!latestHash) throw new Error("chain ribbon tile has no data-testid");
      await latestTile.hover();
      await page
        .getByTestId(`chain-ribbon-popover-block-detail-open-${latestHash}`)
        .click();
      await expect(page.getByTestId("block-detail-view")).toContainText(latestHash);
      await expect(page.getByTestId(`block-detail-next-${latestHash}`)).toBeDisabled();
      await expect(page.getByTestId("block-detail-next-reason")).toHaveText(
        "最新のブロックです",
      );
    },
  );
});
