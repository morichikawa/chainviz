// useSidePanelFontScale（Issue #377）のテスト。increase/decrease/reset に
// よる状態遷移・保存タイミング・can フラグの境界を検証する。刻み送りの
// 計算そのものは sidePanelFontScale.test.ts でカバー済みなので、ここでは
// フックの挙動に絞る（CLAUDE.md のテスト分割方針）。
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "../platform/storage.js";
import { SIDE_PANEL_FONT_SCALE_STORAGE_KEY } from "./sidePanelFontScale.js";
import { useSidePanelFontScale } from "./useSidePanelFontScale.js";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("useSidePanelFontScale", () => {
  it("starts at the default scale (1.0) when nothing is stored", () => {
    const { result } = renderHook(() => useSidePanelFontScale(memoryStorage()));
    expect(result.current.scale).toBe(1);
  });

  it("starts at the stored scale when present", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.3" });
    const { result } = renderHook(() => useSidePanelFontScale(storage));
    expect(result.current.scale).toBe(1.3);
  });

  it("increases the scale and persists it", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useSidePanelFontScale(storage));

    act(() => result.current.increase());

    expect(result.current.scale).toBe(1.15);
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("1.15");
  });

  it("decreases the scale and persists it", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useSidePanelFontScale(storage));

    act(() => result.current.decrease());

    expect(result.current.scale).toBe(0.85);
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("0.85");
  });

  it("resets to the default scale and persists it, even from the maximum", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.5" });
    const { result } = renderHook(() => useSidePanelFontScale(storage));

    act(() => result.current.reset());

    expect(result.current.scale).toBe(1);
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("1");
  });

  it("does not change once at the maximum step and reports canIncrease as false", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.5" });
    const { result } = renderHook(() => useSidePanelFontScale(storage));

    expect(result.current.canIncrease).toBe(false);
    expect(result.current.canDecrease).toBe(true);

    act(() => result.current.increase());
    expect(result.current.scale).toBe(1.5);
  });

  it("does not change once at the minimum step and reports canDecrease as false", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "0.85" });
    const { result } = renderHook(() => useSidePanelFontScale(storage));

    expect(result.current.canDecrease).toBe(false);
    expect(result.current.canIncrease).toBe(true);

    act(() => result.current.decrease());
    expect(result.current.scale).toBe(0.85);
  });

  it("reports both flags true at the default (middle) scale", () => {
    const { result } = renderHook(() => useSidePanelFontScale(memoryStorage()));
    expect(result.current.canIncrease).toBe(true);
    expect(result.current.canDecrease).toBe(true);
  });

  it("walks through multiple increase calls sequentially", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useSidePanelFontScale(storage));

    act(() => result.current.increase());
    act(() => result.current.increase());
    act(() => result.current.increase());
    act(() => result.current.increase());

    // 1 -> 1.15 -> 1.3 -> 1.5 -> 1.5(端で停止)
    expect(result.current.scale).toBe(1.5);
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("1.5");
  });

  it("resets idempotently when already at the default scale", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useSidePanelFontScale(storage));

    act(() => result.current.reset());

    expect(result.current.scale).toBe(1);
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("1");
  });

  it("returns to the original scale after a decrease then increase round trip", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useSidePanelFontScale(storage));

    act(() => result.current.decrease());
    expect(result.current.scale).toBe(0.85);
    act(() => result.current.increase());

    expect(result.current.scale).toBe(1);
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("1");
  });

  it("snaps a stored non-step value to the nearest step on mount", () => {
    // 1.4 は同点タイで若い刻み 1.3 に丸められる(loadSidePanelFontScale の帰結)。
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.4" });
    const { result } = renderHook(() => useSidePanelFontScale(storage));
    expect(result.current.scale).toBe(1.3);
    expect(result.current.canIncrease).toBe(true);
    expect(result.current.canDecrease).toBe(true);
  });

  it("updates the can flags as the scale walks toward each edge", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useSidePanelFontScale(storage));

    // 1.0(中央) -> 1.15 -> 1.3 -> 1.5(最大)
    act(() => result.current.increase());
    expect(result.current.canIncrease).toBe(true);
    expect(result.current.canDecrease).toBe(true);

    act(() => result.current.increase());
    expect(result.current.scale).toBe(1.3);
    expect(result.current.canIncrease).toBe(true);

    act(() => result.current.increase());
    expect(result.current.scale).toBe(1.5);
    expect(result.current.canIncrease).toBe(false);
    expect(result.current.canDecrease).toBe(true);
  });

  it("keeps persisting the edge value when increase is called past the maximum", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.5" });
    const { result } = renderHook(() => useSidePanelFontScale(storage));

    act(() => result.current.increase());
    act(() => result.current.increase());

    expect(result.current.scale).toBe(1.5);
    expect(storage.getItem(SIDE_PANEL_FONT_SCALE_STORAGE_KEY)).toBe("1.5");
  });
});
