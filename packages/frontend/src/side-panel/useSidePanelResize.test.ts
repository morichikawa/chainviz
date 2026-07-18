// useSidePanelResize（Issue #362）のテスト。ドラッグ・キーボード操作に
// よる幅変更と、保存タイミング（pointerup / キー操作時のみ）を検証する。
// クランプの境界値そのものは sidePanelWidth.test.ts でカバー済みなので、
// ここではフックの状態遷移（resizing フラグ・保存タイミング）に絞る。
import { act, renderHook } from "@testing-library/react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "../platform/storage.js";
import { SIDE_PANEL_DEFAULT_WIDTH, SIDE_PANEL_WIDTH_STORAGE_KEY } from "./sidePanelWidth.js";
import { useSidePanelResize } from "./useSidePanelResize.js";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

/** jsdom は PointerEvent を実装していないため、type だけ差し替えた
 * MouseEvent で代用する（フック側は event.clientX しか見ないため十分）。 */
function dispatchPointer(type: "pointermove" | "pointerup", clientX: number) {
  window.dispatchEvent(new MouseEvent(type, { clientX }));
}

function pointerDownEvent(clientX: number): ReactPointerEvent {
  return { clientX } as unknown as ReactPointerEvent;
}

function keyDownEvent(key: string): { event: ReactKeyboardEvent; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  return { event: { key, preventDefault } as unknown as ReactKeyboardEvent, preventDefault };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSidePanelResize", () => {
  it("starts at the default width when nothing is stored", () => {
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));
    expect(result.current.width).toBe(SIDE_PANEL_DEFAULT_WIDTH);
    expect(result.current.resizing).toBe(false);
  });

  it("starts at the stored width", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "500" });
    const { result } = renderHook(() => useSidePanelResize(storage));
    expect(result.current.width).toBe(500);
  });

  it("grows the width while dragging the handle to the left", () => {
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));
    const startWidth = result.current.width;

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    expect(result.current.resizing).toBe(true);

    act(() => {
      dispatchPointer("pointermove", 900); // 100px left => width grows by 100
    });
    expect(result.current.width).toBe(startWidth + 100);
  });

  it("shrinks the width while dragging the handle to the right", () => {
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));
    const startWidth = result.current.width;

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    act(() => {
      dispatchPointer("pointermove", 1100); // 100px right => width shrinks by 100
    });
    expect(result.current.width).toBe(startWidth - 100);
  });

  it("does not persist the width during pointermove (only on pointerup)", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useSidePanelResize(storage));

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    act(() => {
      dispatchPointer("pointermove", 900);
    });
    expect(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)).toBeNull();

    act(() => {
      dispatchPointer("pointerup", 900);
    });
    expect(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)).toBe(String(result.current.width));
    expect(result.current.resizing).toBe(false);
  });

  it("clamps the width to the minimum while dragging far to the right", () => {
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    act(() => {
      dispatchPointer("pointermove", 5000);
    });
    expect(result.current.width).toBe(300);
  });

  it("stops reacting to window pointer events after pointerup", () => {
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    act(() => {
      dispatchPointer("pointerup", 900);
    });
    const widthAfterUp = result.current.width;

    act(() => {
      dispatchPointer("pointermove", 100);
    });
    expect(result.current.width).toBe(widthAfterUp);
  });

  it("removes its window listeners on unmount while dragging", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => useSidePanelResize(memoryStorage()));

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    unmount();

    expect(removeSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("pointerup", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("widens the panel on ArrowLeft and narrows it on ArrowRight, saving each time", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useSidePanelResize(storage));
    const startWidth = result.current.width;

    const left = keyDownEvent("ArrowLeft");
    act(() => {
      result.current.handleProps.onKeyDown(left.event);
    });
    expect(result.current.width).toBe(startWidth + 24);
    expect(left.preventDefault).toHaveBeenCalledTimes(1);
    expect(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)).toBe(String(startWidth + 24));

    const right = keyDownEvent("ArrowRight");
    act(() => {
      result.current.handleProps.onKeyDown(right.event);
    });
    expect(result.current.width).toBe(startWidth);
    expect(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)).toBe(String(startWidth));
  });

  it("ignores other keys", () => {
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));
    const startWidth = result.current.width;
    const enter = keyDownEvent("Enter");
    act(() => {
      result.current.handleProps.onKeyDown(enter.event);
    });
    expect(result.current.width).toBe(startWidth);
    expect(enter.preventDefault).not.toHaveBeenCalled();
  });

  it("exposes aria attributes reflecting the current width and bounds", () => {
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));
    expect(result.current.handleProps.role).toBe("separator");
    expect(result.current.handleProps["aria-orientation"]).toBe("vertical");
    expect(result.current.handleProps["aria-valuenow"]).toBe(result.current.width);
    expect(result.current.handleProps["aria-valuemin"]).toBe(300);
    expect(result.current.handleProps.tabIndex).toBe(0);
  });
});
