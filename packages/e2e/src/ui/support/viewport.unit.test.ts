// support/viewport.ts の `fitCanvasView` に対するユニットテスト(Issue #373)。
// 実ブラウザには依存せず、Playwright の `Page`/`Locator` をフェイクして
// 「安定クラス名のフィットボタンをクリックする」「対象が視野内へ入るまで
// 再試行する」という配線・リトライロジックを確認する。

import type { Locator, Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { fitCanvasView } from "./viewport.js";

/** ビューポートに収まっている/いないの2状態を表すボックス。 */
const IN_VIEW_BOX = { x: 10, y: 10, width: 100, height: 40 };
const OUT_OF_VIEW_BOX = { x: 1940, y: 10, width: 100, height: 40 };
const VIEWPORT = { width: 1280, height: 720 };

/** フィットボタン用のフェイク Locator(クリック回数を記録)。 */
function makeFitViewButton() {
  const click = vi.fn().mockResolvedValue(undefined);
  return { click } as unknown as Locator;
}

/** `boundingBox` が固定値を返すフェイク対象 Locator。 */
function makeTargetLocator(
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>,
): Locator {
  return { boundingBox } as unknown as Locator;
}

function makePage(fitViewButton: Locator, viewport: typeof VIEWPORT | null = VIEWPORT): {
  page: Page;
  locator: ReturnType<typeof vi.fn>;
} {
  const locator = vi.fn((selector: string): Locator => {
    expect(selector).toBe(".react-flow__controls-fitview");
    return fitViewButton;
  });
  const viewportSize = vi.fn(() => viewport);
  const page = { locator, viewportSize } as unknown as Page;
  return { page, locator };
}

describe("fitCanvasView", () => {
  it("対象が最初のフィットで既に視野内なら、フィットボタンを1回だけ押して即座に成功する", async () => {
    const fitViewButton = makeFitViewButton();
    const { page, locator } = makePage(fitViewButton);
    const target = makeTargetLocator(async () => IN_VIEW_BOX);

    await fitCanvasView(page, target);

    expect(locator).toHaveBeenCalledTimes(1);
    expect(fitViewButton.click).toHaveBeenCalledTimes(1);
  });

  it(
    "対象が最初はビューポート外(diff直後の未計測ノード相当)でも、" +
      "再試行の末に視野内へ入れば成功する(Issue #373 差し戻し対応)",
    async () => {
      const fitViewButton = makeFitViewButton();
      const { page } = makePage(fitViewButton);
      const boundingBox = vi
        .fn()
        .mockResolvedValueOnce(OUT_OF_VIEW_BOX)
        .mockResolvedValueOnce(OUT_OF_VIEW_BOX)
        .mockResolvedValueOnce(IN_VIEW_BOX);
      const target = makeTargetLocator(boundingBox);

      await fitCanvasView(page, target, { pollIntervalMs: 0 });

      expect(fitViewButton.click).toHaveBeenCalledTimes(3);
      expect(boundingBox).toHaveBeenCalledTimes(3);
    },
  );

  it(
    "対象が timeoutMs を超えても視野内へ入らない場合、握りつぶさずに" +
      "具体的な理由付きで例外を投げる",
    async () => {
      const fitViewButton = makeFitViewButton();
      const { page } = makePage(fitViewButton);
      const target = makeTargetLocator(async () => OUT_OF_VIEW_BOX);

      await expect(
        fitCanvasView(page, target, { timeoutMs: 5, pollIntervalMs: 0 }),
      ).rejects.toThrow(/did not enter the viewport/);

      // 少なくとも複数回リトライした上で諦めていること。
      expect(vi.mocked(fitViewButton.click).mock.calls.length).toBeGreaterThan(0);
    },
  );

  it("対象が非表示(boundingBoxがnull)の間は視野内と判定せず再試行する", async () => {
    const fitViewButton = makeFitViewButton();
    const { page } = makePage(fitViewButton);
    const boundingBox = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(IN_VIEW_BOX);
    const target = makeTargetLocator(boundingBox);

    await fitCanvasView(page, target, { pollIntervalMs: 0 });

    expect(fitViewButton.click).toHaveBeenCalledTimes(2);
  });

  it("viewportSize が null を返す(型上ありうる異常系)間は安全側に倒して視野内と判定しない", async () => {
    const fitViewButton = makeFitViewButton();
    const { page } = makePage(fitViewButton, null);
    const target = makeTargetLocator(async () => IN_VIEW_BOX);

    await expect(
      fitCanvasView(page, target, { timeoutMs: 5, pollIntervalMs: 0 }),
    ).rejects.toThrow(/did not enter the viewport/);
  });

  it("フィットボタンのクリックが失敗した場合、例外を握りつぶさずそのまま伝播させる", async () => {
    const clickError = new Error("locator.click: Target closed");
    const fitViewButton = { click: () => Promise.reject(clickError) } as unknown as Locator;
    const { page } = makePage(fitViewButton);
    const target = makeTargetLocator(async () => IN_VIEW_BOX);

    await expect(fitCanvasView(page, target)).rejects.toThrow(clickError);
  });
});
