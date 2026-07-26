// ブロック番号ジャンプ欄（UI-B-07a。Issue #428）。
// packages/e2e/SCENARIOS.md「B層: P2P グラフ（UI-B）」節の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。UI-B-07（前後ナビゲーション）
// に隣接する新規シナリオのため、既存 block-detail.spec.ts とは別ファイルに
// 分離する（1ファイル1責務）。

import { expect, type Page, test } from "@playwright/test";
import { SLOT_DURATION_MS } from "../helpers/slot-time.js";

/** `chain-ribbon.spec.ts` / `block-detail.spec.ts` と同じ考え方の待ち上限。 */
const BLOCK_DETAIL_TIMEOUT_MS = SLOT_DURATION_MS * 3 + 20_000;

const CHAIN_RIBBON_TILE_SELECTOR =
  '[data-testid^="chain-ribbon-tile-"][data-connected-to-previous]';

/** `block-detail-view` に表示中のブロック番号（ヘッダーの "#NNN"）を取得する。 */
async function getDisplayedBlockNumber(page: Page): Promise<number> {
  const text = await page
    .getByTestId("block-detail-view")
    .locator(".block-detail-view__number")
    .textContent();
  const match = text?.match(/#(\d+)/);
  if (!match) throw new Error(`block detail view header has no block number: ${text}`);
  return Number(match[1]);
}

async function openFirstTileBlockDetail(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("chain-ribbon-card")).toBeVisible({
    timeout: BLOCK_DETAIL_TIMEOUT_MS,
  });
  const tile = page.locator(CHAIN_RIBBON_TILE_SELECTOR).first();
  await expect(tile).toBeVisible({ timeout: BLOCK_DETAIL_TIMEOUT_MS });
  const hash = (await tile.getAttribute("data-testid"))?.replace(
    "chain-ribbon-tile-",
    "",
  );
  if (!hash) throw new Error("chain ribbon tile has no data-testid");
  await tile.hover();
  await page.getByTestId(`chain-ribbon-popover-block-detail-open-${hash}`).click();
  await expect(page.getByTestId("block-detail-view")).toBeVisible();
}

test("UI-B-07a: ブロック詳細パネルでブロック番号を直接指定して移動できる（保持窓内ジャンプ成功）", async ({
  page,
}) => {
  test.setTimeout(BLOCK_DETAIL_TIMEOUT_MS + 30_000);

  await test.step("最初のタイルのブロック詳細を開く", async () => {
    await openFirstTileBlockDetail(page);
  });

  const firstNumber = await getDisplayedBlockNumber(page);
  let laterNumber = firstNumber;

  await test.step(
    "「次のブロック」で1つ先へ進み、番号を記録してから「前のブロック」で最初のブロックへ戻る",
    async () => {
      const nextButton = page.getByTestId(`block-detail-next-${await currentHash(page)}`);
      await expect(nextButton).toBeEnabled({ timeout: BLOCK_DETAIL_TIMEOUT_MS });
      await nextButton.click();
      laterNumber = await getDisplayedBlockNumber(page);
      expect(laterNumber).toBeGreaterThan(firstNumber);

      const prevButton = page.getByTestId(`block-detail-prev-${await currentHash(page)}`);
      await expect(prevButton).toBeEnabled();
      await prevButton.click();
      expect(await getDisplayedBlockNumber(page)).toBe(firstNumber);
    },
  );

  await test.step("ジャンプ欄に記録した番号を入力して「移動」を押す", async () => {
    await page.getByTestId("block-jump-input").fill(String(laterNumber));
    await page.getByTestId("block-jump-submit").click();
  });

  await test.step("パネルの中身が指定した番号のブロックへ差し替わり、ジャンプ欄もその番号に同期する", async () => {
    expect(await getDisplayedBlockNumber(page)).toBe(laterNumber);
    await expect(page.getByTestId("side-panel")).toHaveCount(1);
    await expect(page.getByTestId("block-jump-input")).toHaveValue(String(laterNumber));
  });
});

test("UI-B-07a: 保持窓外の番号を入力するとエラーが表示されパネルは移動しない", async ({
  page,
}) => {
  test.setTimeout(BLOCK_DETAIL_TIMEOUT_MS + 30_000);

  await test.step("最初のタイルのブロック詳細を開く", async () => {
    await openFirstTileBlockDetail(page);
  });

  const displayedNumber = await getDisplayedBlockNumber(page);
  // 「今この瞬間に観測できる状態に依存した固定値を埋め込まない」ため、絶対
  // 番号を決め打ちせず、現在表示中の番号からの相対オフセットで確実に保持窓
  // （最大 32 ブロック分）の外になる値を作る。
  const outOfRangeNumber = displayedNumber + 1_000_000;

  await test.step("保持窓より明らかに大きい番号を入力して「移動」を押す", async () => {
    await page.getByTestId("block-jump-input").fill(String(outOfRangeNumber));
    await page.getByTestId("block-jump-submit").click();
  });

  await test.step("notFound エラーが表示され、パネルの中身は変わらない", async () => {
    await expect(page.getByTestId("block-jump-error-notFound")).toBeVisible();
    expect(await getDisplayedBlockNumber(page)).toBe(displayedNumber);
  });
});

test("UI-B-07a: 数値以外を入力すると invalid エラーが表示され「移動」ボタンが disabled になる", async ({
  page,
}) => {
  test.setTimeout(BLOCK_DETAIL_TIMEOUT_MS + 30_000);

  await test.step("最初のタイルのブロック詳細を開く", async () => {
    await openFirstTileBlockDetail(page);
  });

  await test.step("ジャンプ欄に数値以外を入力する", async () => {
    await page.getByTestId("block-jump-input").fill("abc");
  });

  await test.step("invalid エラーが表示され、送信ボタンが disabled になる", async () => {
    await expect(page.getByTestId("block-jump-error-invalid")).toBeVisible();
    await expect(page.getByTestId("block-jump-submit")).toBeDisabled();
  });
});

/** 表示中のブロックの hash（prev ボタンの data-testid から読み取る）。 */
async function currentHash(page: Page): Promise<string> {
  const testId = await page
    .getByTestId("block-detail-view")
    .locator('[data-testid^="block-detail-prev-"]')
    .getAttribute("data-testid");
  const hash = testId?.replace("block-detail-prev-", "");
  if (!hash) throw new Error("block detail view has no prev button data-testid");
  return hash;
}
