import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOVER_POPOVER_CLOSE_DELAY_MS,
  useHoverPopover,
} from "./useHoverPopover.js";

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useHoverPopover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts closed", () => {
    const { result } = renderHook(() => useHoverPopover());
    expect(result.current.isOpen).toBe(false);
  });

  it("opens immediately on mouse enter", () => {
    const { result } = renderHook(() => useHoverPopover());
    act(() => result.current.onMouseEnter());
    expect(result.current.isOpen).toBe(true);
  });

  it(
    "does not close immediately on mouse leave (Issue #221: cursor may still be " +
      "crossing the gap toward the popover)",
    () => {
      const { result } = renderHook(() => useHoverPopover());
      act(() => result.current.onMouseEnter());
      act(() => result.current.onMouseLeave());
      expect(result.current.isOpen).toBe(true);
    },
  );

  it("closes after the close delay elapses following mouse leave", () => {
    const { result } = renderHook(() => useHoverPopover());
    act(() => result.current.onMouseEnter());
    act(() => result.current.onMouseLeave());

    advance(HOVER_POPOVER_CLOSE_DELAY_MS - 1);
    expect(result.current.isOpen).toBe(true);

    advance(1);
    expect(result.current.isOpen).toBe(false);
  });

  it(
    "stays open if the pointer re-enters before the close delay elapses " +
      "(simulates reaching the popover across the gap)",
    () => {
      const { result } = renderHook(() => useHoverPopover());
      act(() => result.current.onMouseEnter());
      act(() => result.current.onMouseLeave());

      advance(HOVER_POPOVER_CLOSE_DELAY_MS / 2);
      act(() => result.current.onMouseEnter());

      // 元のタイマーが生きていたら消えていたはずの時間まで進めても開いたまま。
      advance(HOVER_POPOVER_CLOSE_DELAY_MS);
      expect(result.current.isOpen).toBe(true);
    },
  );

  it("opens immediately on focus", () => {
    const { result } = renderHook(() => useHoverPopover());
    act(() => result.current.onFocus());
    expect(result.current.isOpen).toBe(true);
  });

  it("closes immediately on blur (no delay)", () => {
    const { result } = renderHook(() => useHoverPopover());
    act(() => result.current.onFocus());
    act(() => result.current.onBlur());
    expect(result.current.isOpen).toBe(false);
  });

  it("blur cancels a pending mouse-leave close timer without error", () => {
    const { result } = renderHook(() => useHoverPopover());
    act(() => result.current.onMouseEnter());
    act(() => result.current.onMouseLeave());
    act(() => result.current.onBlur());
    expect(result.current.isOpen).toBe(false);

    // 元のクローズタイマーが残っていても二重に閉じようとして例外にならない。
    expect(() => advance(HOVER_POPOVER_CLOSE_DELAY_MS)).not.toThrow();
  });

  it("respects a custom close delay", () => {
    const { result } = renderHook(() => useHoverPopover(500));
    act(() => result.current.onMouseEnter());
    act(() => result.current.onMouseLeave());

    advance(499);
    expect(result.current.isOpen).toBe(true);
    advance(1);
    expect(result.current.isOpen).toBe(false);
  });

  it("does not throw and cleans up its timer when unmounted with a pending close", () => {
    const { result, unmount } = renderHook(() => useHoverPopover());
    act(() => result.current.onMouseEnter());
    act(() => result.current.onMouseLeave());

    expect(() => {
      unmount();
      advance(HOVER_POPOVER_CLOSE_DELAY_MS);
    }).not.toThrow();
  });

  it(
    "close() closes immediately even mid-hover, and cancels a pending " +
      "mouse-leave close timer (Issue #313: GlossaryTerm click closes its own " +
      "hover popover on the way to opening the glossary panel)",
    () => {
      const { result } = renderHook(() => useHoverPopover());
      act(() => result.current.onMouseEnter());
      expect(result.current.isOpen).toBe(true);

      act(() => result.current.close());
      expect(result.current.isOpen).toBe(false);

      // 保留中のクローズタイマーが無くても close() 後に例外にならない。
      expect(() => advance(HOVER_POPOVER_CLOSE_DELAY_MS)).not.toThrow();
    },
  );

  it("repeated mouse leave calls do not each schedule an independent close", () => {
    const { result } = renderHook(() => useHoverPopover());
    act(() => result.current.onMouseEnter());
    act(() => result.current.onMouseLeave());
    advance(HOVER_POPOVER_CLOSE_DELAY_MS / 2);
    // 重複した mouseleave（例: 子要素間の移動で複数回発火するケース）。
    act(() => result.current.onMouseLeave());
    advance(HOVER_POPOVER_CLOSE_DELAY_MS / 2);
    // 2回目の呼び出し時点から数えて delay 経過するまでは開いたまま。
    expect(result.current.isOpen).toBe(true);
    advance(HOVER_POPOVER_CLOSE_DELAY_MS / 2);
    expect(result.current.isOpen).toBe(false);
  });
});
