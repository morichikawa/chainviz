// mempool パネルのレイアウト重なり回避（UI-OVERLAY-01。Issue #413 差し戻し
// 対応）。packages/e2e/SCENARIOS.md「浮遊オーバーレイパネルのレイアウト
// 重なり回避（UI-OVERLAY）」節の実装（docs/ARCHITECTURE.md §8.4 の記法規約
// に従う）。
//
// mempool パネル（`.mempool-panel`）は `bottom` 固定で内容量に応じて上方向
// に伸びる浮遊オーバーレイパネル。Issue #413 で frontRunning ヒント行を
// 追加した結果、1280x720（本テストの既定ビューポート。`playwright.config.ts`
// の `devices["Desktop Chrome"]`）でパネルのヘッダー行が左上の
// `.canvas-overlay-top`（キャンバスツールバー + レイヤーフィルターバー）に
// 覆われる退行が発生した。実レイアウト（`getBoundingClientRect` の実測値）
// に依存する検証なので、jsdom のユニットテストでは代用できない。

import { expect, test } from "@playwright/test";

/**
 * mempool パネルの「ノード別 txpool」欄（`NodeEntity.internals.mempool` 由来。
 * `nodeEntries.length > 0` のときだけ描画）が初めて埋まるのを待つ上限。
 * D層のノード内部メトリクスのスクレイプ間隔（`NODE_INTERNALS_POLL_INTERVAL_MS`、
 * 既定3000ms。`packages/collector/src/adapters/ethereum/reth-metrics-tracker.ts`）
 * に依存して埋まるため、`node-internals.spec.ts` の `INTERNALS_TIMEOUT_MS`
 * と同じ考え方・同じ値（コールドスタート・ネットワーク揺らぎ分の余裕を含む）
 * を採用する。
 *
 * ページ読み込み直後（1回目のスクレイプ前）はこの欄自体が無く、パネルの
 * 実際の高さが本来より低く出るため、ここを待たずに測定すると退行を
 * 見逃す（起動直後の collector に接続した場合に発生することを実測で
 * 確認済み。既に稼働しているスタックに接続する場合はすぐ埋まる）。
 */
const NODE_TXPOOL_SECTION_TIMEOUT_MS = 60_000;

test("UI-OVERLAY-01: mempool パネルのヘッダーが層フィルターバーに隠れず操作できる", async ({
  page,
}) => {
  await page.goto("/");

  const mempoolPanel = page.getByTestId("mempool-panel");
  const layerFilterBar = page.getByTestId("layer-filter-bar");
  await expect(mempoolPanel).toBeVisible();
  await expect(layerFilterBar).toBeVisible();
  // パネルの高さが最大になる状態（ノード別 txpool 欄が埋まった状態）で
  // 測定する。冒頭コメントのとおり、これを待たないとページ読み込み直後の
  // 低い高さで判定してしまい、退行を見逃しうる。
  await expect(mempoolPanel.locator(".mempool-panel__nodes")).toBeVisible({
    timeout: NODE_TXPOOL_SECTION_TIMEOUT_MS,
  });

  await test.step("mempool パネルのヘッダーが層フィルターバーの下端より下にある", async () => {
    const header = mempoolPanel.locator(".mempool-panel__header");
    const headerBox = await header.boundingBox();
    const barBox = await layerFilterBar.boundingBox();
    if (headerBox === null || barBox === null) {
      throw new Error(
        "mempool-panel__header または layer-filter-bar の bounding box を取得できない",
      );
    }
    expect(headerBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);
  });

  await test.step("mempool 用語アンカーのクリックが他要素にブロックされず用語集パネルを開く", async () => {
    const anchor = mempoolPanel.getByTestId("glossary-term-mempool");
    await anchor.click();
    await expect(page.getByTestId("side-panel")).toBeVisible();
  });
});
