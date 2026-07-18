// サイドパネルの幅リサイズ（UI-PANEL-01。Issue #362）。
// packages/e2e/SCENARIOS.md「サイドパネルの幅リサイズ（UI-PANEL）」節の
// 実装（docs/ARCHITECTURE.md §8.4 の記法規約に従う）。
//
// 対象はシェル（`side-panel/SidePanel.tsx`）共通の挙動なので、開くのが
// 最も軽い通信ログパネルで検証する（comms-log.spec.ts の UI-LOG-01 と
// 同じ開き方）。ドラッグの実挙動（実ブラウザの pointer イベント）と
// リロード後の localStorage 永続化は、jsdom を使う unit test
// （side-panel/SidePanel.resize.test.tsx 等）では代用しきれない部分。

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

function openCommsLogPanel(page: Page) {
  return page.getByTestId("canvas-toolbar-comms-log").click();
}

/** サイドパネル本体の現在幅（px、整数）。インライン style を直接読む。 */
async function readPanelWidthPx(page: Page): Promise<number> {
  const style = await page.getByTestId("side-panel").evaluate(
    (el) => (el as HTMLElement).style.width,
  );
  const px = Number.parseFloat(style);
  if (!Number.isFinite(px)) {
    throw new Error(`side-panel width did not resolve to a number: "${style}"`);
  }
  return px;
}

test("UI-PANEL-01: ハンドルをドラッグして幅を変更すると、リロード後も保持される", async ({
  page,
}) => {
  await page.goto("/");
  await openCommsLogPanel(page);
  await expect(page.getByTestId("side-panel")).toBeVisible();

  const before = await readPanelWidthPx(page);
  let afterDrag = before;

  await test.step("パネル左端のリサイズハンドルを左へドラッグする", async () => {
    const handle = page.getByTestId("side-panel-resize-handle");
    const box = await handle.boundingBox();
    if (!box) throw new Error("side-panel-resize-handle has no bounding box");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // 複数ステップで移動させ、window の pointermove リスナーが確実に
    // 発火するようにする（infra-display.spec.ts の UI-A-04 と同じ理由）。
    await page.mouse.move(startX - 150, startY, { steps: 15 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        afterDrag = await readPanelWidthPx(page);
        return afterDrag - before;
      })
      .toBeGreaterThan(100); // 150px 左へ動かしたので、ほぼ+150幅広がる想定
  });

  await test.step("ページをリロードし、再び通信ログパネルを開く", async () => {
    await page.reload();
    await openCommsLogPanel(page);
    await expect(page.getByTestId("side-panel")).toBeVisible();
  });

  await test.step("リロード前にドラッグした幅のまま表示される", async () => {
    const afterReload = await readPanelWidthPx(page);
    expect(afterReload).toBe(afterDrag);
  });
});
