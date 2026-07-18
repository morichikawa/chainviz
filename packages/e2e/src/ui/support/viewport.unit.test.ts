// support/viewport.ts の `fitCanvasView` に対するユニットテスト(Issue #373)。
// 実ブラウザには依存せず、Playwright の `Page`/`Locator` をフェイクして
// 「安定クラス名のフィットボタンをクリックする」という配線だけを確認する。

import type { Locator, Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { fitCanvasView } from "./viewport.js";

describe("fitCanvasView", () => {
  it("React Flow Controls のフィットボタン（.react-flow__controls-fitview）をクリックする", async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    const locator = vi.fn((selector: string): Locator => {
      expect(selector).toBe(".react-flow__controls-fitview");
      return { click } as unknown as Locator;
    });
    const page = { locator } as unknown as Page;

    await fitCanvasView(page);

    expect(locator).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("クリックが失敗した場合、例外を握りつぶさずそのまま伝播させる", async () => {
    const clickError = new Error("locator.click: Target closed");
    const locator = vi.fn(
      (): Locator => ({ click: () => Promise.reject(clickError) }) as unknown as Locator,
    );
    const page = { locator } as unknown as Page;

    await expect(fitCanvasView(page)).rejects.toThrow(clickError);
  });
});
