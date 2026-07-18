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

  it(
    "クリック対象のカードやビューポート状態に関する前提を持たない" +
      "（フィットボタン以外の locator を一切参照しない。対象が既に視野内でも" +
      "安全に呼べることの裏づけ。点検観点4）",
    async () => {
      const click = vi.fn().mockResolvedValue(undefined);
      const seenSelectors: string[] = [];
      const locator = vi.fn((selector: string): Locator => {
        seenSelectors.push(selector);
        return { click } as unknown as Locator;
      });
      const page = { locator } as unknown as Page;

      await fitCanvasView(page);

      // 参照した locator はフィットボタンだけ。カードの視野内外を判定する
      // ような条件分岐を持たず、常にフィット操作へ一本化されている。
      expect(seenSelectors).toEqual([".react-flow__controls-fitview"]);
    },
  );

  it(
    "続けて複数回呼んでも毎回フィットボタンを押すだけで冪等に成功する" +
      "（既に全体が視野に収まっている状態で再度呼んでも安全）",
    async () => {
      const click = vi.fn().mockResolvedValue(undefined);
      const locator = vi.fn(
        (): Locator => ({ click } as unknown as Locator),
      );
      const page = { locator } as unknown as Page;

      await fitCanvasView(page);
      await fitCanvasView(page);

      expect(click).toHaveBeenCalledTimes(2);
    },
  );
});
