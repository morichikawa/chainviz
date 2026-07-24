// ブロック詳細パネル（UI-B-07。Issue #409）。
// packages/e2e/SCENARIOS.md「B層: P2P グラフ（UI-B）」節の実装
// (docs/ARCHITECTURE.md §8.4 の記法規約に従う)。

import { expect, type Page, test } from "@playwright/test";
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

/**
 * `block-detail-view` に表示中のブロックの hash を取得する。「前のブロック」
 * ボタンの `data-testid`（`block-detail-prev-<hash>`）は常に「今表示している
 * ブロック」の hash で採番される（disabled でも要素自体は残る）ため、これを
 * 読み取ることで表示内容の hash を確実に取得できる。
 */
async function getDisplayedBlockHash(page: Page): Promise<string> {
  const testId = await page
    .getByTestId("block-detail-view")
    .locator('[data-testid^="block-detail-prev-"]')
    .getAttribute("data-testid");
  const hash = testId?.replace("block-detail-prev-", "") ?? "";
  if (!hash) throw new Error("block detail view has no prev button data-testid");
  return hash;
}

test("UI-B-07: ブロック詳細パネルで保持窓内を前後に辿れる", async ({ page }) => {
  // 「次のブロックが観測されるまで待つ」ステップと、最終ステップの「ライブの
  // チェーン先端へ追いつくまで next を辿るフォールバックループ」の両方が
  // 最大 BLOCK_DETAIL_TIMEOUT_MS 分の待ちを持ちうる（chain-ribbon.spec.ts の
  // UI-B-06 と同じ考え方で、直列に重なる待ちの合計に安全マージンを載せて
  // 既定のテストタイムアウトを個別に緩める）。
  test.setTimeout(2 * BLOCK_DETAIL_TIMEOUT_MS + 30_000);

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
      // 差し替わったことは「表示中ブロックに紐づく nav ボタンの hash」で判定する。
      // 子ブロックはヘッダ以外に親hash欄へ firstHash を全文表示するため、
      // block-detail-view のテキストに firstHash が含まれるか否かでは判定
      // できない（親hash欄が firstHash を含むので not.toContainText は誤判定
      // になる）。prev/next ボタンの data-testid は常に「今表示している
      // ブロック」の hash で採番されるので、firstHash 採番の next ボタンが
      // 消えたことをもって子ブロックへ切り替わったと判定する。
      await expect(page.getByTestId(`block-detail-next-${firstHash}`)).toHaveCount(0);
      // 1枚のパネルのまま中身だけが差し替わる（新しいパネルが重ねて開かない）。
      await expect(page.getByTestId("side-panel")).toHaveCount(1);
    },
  );

  await test.step(
    "差し替わった後の「前のブロック」で元のブロックへ戻れる",
    async () => {
      const childHash = await getDisplayedBlockHash(page);
      await page.getByTestId(`block-detail-prev-${childHash}`).click();
      await expect(page.getByTestId("block-detail-view")).toContainText(firstHash);
    },
  );

  await test.step(
    "チェーンリボンの最新タイル（chain-ribbon-latest と同じブロック）のブロック詳細を開き、実際のチェーン先端に達すると「次のブロック」が disabled になり「最新のブロックです」の理由が示される",
    async () => {
      // QA差し戻し(Issue #409): チェーンリボンの表示は Issue #298/#351 の
      // `useFrozenRibbonTiles` によりホバー中（このテストではここまでの
      // ステップで開いたポップオーバーの余韻を含む）表示窓の前進が凍結
      // される。一方パネルの blocksByHash/latestBlockHash は Canvas.tsx が
      // 常にライブの data.tiles/data.blocks から導出しており、データの
      // 出所が異なる。凍結が残ったまま「最新に見えるタイル」を選ぶと、
      // 実際のチェーン先端より遅れたブロックを開いてしまい、next が
      // disabled にならず不安定になる（実機7回中6回失敗）。
      // まずホバーを明示的に外して凍結を解除し、`HOVER_POPOVER_CLOSE_DELAY_MS`
      // (200ms) の遅延クローズ猶予より十分長く待ってから表示窓の再計算を
      // 待つことで、なるべくライブに近いタイルを選び直す。
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);

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

      // 上記の対策後もなお、選んだタイルが実際のチェーン先端よりわずかに
      // 遅れていた場合（例: 選択直後に次ブロックが到着した）に備え、
      // パネル自身の「次のブロック」ナビゲーションでライブの先端に追いつく
      // まで辿ってから disabled を検証する（QAの提案「検証対象が子を持たない
      // 状態を確実に保証する」を、パネル自身の遷移で実現する）。追いつく
      // 前に BLOCK_DETAIL_TIMEOUT_MS（他の待ちと同じ SLOT_DURATION_MS 由来の
      // 式）を超えたらループを打ち切り、以降の disabled アサーションに委ねる
      // （真に製品側の不具合であればここで失敗し、フレークとは区別できる）。
      const followDeadline = Date.now() + BLOCK_DETAIL_TIMEOUT_MS;
      let hash = latestHash;
      while (Date.now() < followDeadline) {
        const nextButton = page.getByTestId(`block-detail-next-${hash}`);
        if (await nextButton.isDisabled()) break;
        await nextButton.click();
        hash = await getDisplayedBlockHash(page);
      }

      await expect(page.getByTestId(`block-detail-next-${hash}`)).toBeDisabled();
      await expect(page.getByTestId("block-detail-next-reason")).toHaveText(
        "最新のブロックです",
      );
    },
  );
});
