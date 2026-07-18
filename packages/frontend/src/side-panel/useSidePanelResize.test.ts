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

/** `button` 省略時は左ボタン(0)扱いにする(既存テストへの影響を避けるため)。 */
function pointerDownEvent(clientX: number, button = 0): ReactPointerEvent {
  return { clientX, button } as unknown as ReactPointerEvent;
}

function keyDownEvent(key: string): { event: ReactKeyboardEvent; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  return { event: { key, preventDefault } as unknown as ReactKeyboardEvent, preventDefault };
}

const ORIGINAL_INNER_WIDTH = window.innerWidth;

/** ビューポート幅（最大幅の算出に使う window.innerWidth）を差し替える。 */
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setViewportWidth(ORIGINAL_INNER_WIDTH);
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

  it("ignores a pointerdown from a non-primary button (e.g. right-click)", () => {
    // Issue #391: 右ボタンドラッグでもリサイズが開始してしまっていた回帰。
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));
    const startWidth = result.current.width;

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000, 2)); // 右ボタン
    });
    expect(result.current.resizing).toBe(false);

    act(() => {
      dispatchPointer("pointermove", 900);
    });
    expect(result.current.width).toBe(startWidth);
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

  it("clamps the width to the maximum while dragging far to the left", () => {
    setViewportWidth(1000); // max = 900
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    act(() => {
      dispatchPointer("pointermove", -5000); // far left => width would blow past max
    });
    expect(result.current.width).toBe(900);
  });

  it("re-reads the viewport during a drag so a shrinking window tightens the max", () => {
    setViewportWidth(2000); // max = 1800
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1500));
    });
    act(() => {
      dispatchPointer("pointermove", 500); // +1000 => 1420, within 1800
    });
    expect(result.current.width).toBe(SIDE_PANEL_DEFAULT_WIDTH + 1000);

    // ドラッグ継続中にウィンドウが縮む。同じ clientX でも新しい最大幅
    // （900）でクランプされる。
    setViewportWidth(1000); // max = 900
    act(() => {
      dispatchPointer("pointermove", 500);
    });
    expect(result.current.width).toBe(900);
  });

  it("re-anchors when a second pointerdown interrupts an in-progress drag", () => {
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));
    const startWidth = result.current.width;

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    act(() => {
      dispatchPointer("pointermove", 900); // width => startWidth + 100
    });
    expect(result.current.width).toBe(startWidth + 100);

    // 上げずに再度 pointerdown（別ポインタの割り込み等）。現在の幅を
    // 新しい開始幅としてアンカーし直す。
    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(900));
    });
    act(() => {
      dispatchPointer("pointermove", 850); // +50 from the re-anchored width
    });
    expect(result.current.width).toBe(startWidth + 150);
  });

  it("carries the ending width into the next drag as its start width", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useSidePanelResize(storage));
    const startWidth = result.current.width;

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    act(() => {
      dispatchPointer("pointerup", 900); // grew by 100
    });
    expect(result.current.width).toBe(startWidth + 100);

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    act(() => {
      dispatchPointer("pointerup", 800); // grows another 200 from the new start
    });
    expect(result.current.width).toBe(startWidth + 300);
    expect(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)).toBe(String(startWidth + 300));
  });

  it("persists the unchanged width when pointerup happens without any move", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useSidePanelResize(storage));
    const startWidth = result.current.width;

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });
    act(() => {
      dispatchPointer("pointerup", 1000); // same X => no change
    });
    expect(result.current.width).toBe(startWidth);
    expect(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)).toBe(String(startWidth));
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

  it("registers its window listeners under the pointer event names", () => {
    // ドラッグ中のリスナーは "pointermove"/"pointerup" で登録される。
    // テストヘルパー（type だけ差し替えた MouseEvent）がこの同じ
    // イベント名で dispatch している前提を固定する。実装が "mousemove"
    // 等に変わればこの前提が崩れるため、ここで契約として明示する。
    const addSpy = vi.spyOn(window, "addEventListener");
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));

    act(() => {
      result.current.handleProps.onPointerDown(pointerDownEvent(1000));
    });

    expect(addSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("pointerup", expect.any(Function));
    expect(addSpy).not.toHaveBeenCalledWith("mousemove", expect.any(Function));
    addSpy.mockRestore();
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

  it("clamps to the maximum when ArrowLeft would exceed it (respecting the viewport)", () => {
    setViewportWidth(1000); // max = 900
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "890" });
    const { result } = renderHook(() => useSidePanelResize(storage));
    expect(result.current.width).toBe(890);

    const left = keyDownEvent("ArrowLeft");
    act(() => {
      result.current.handleProps.onKeyDown(left.event); // 890 + 24 = 914 -> clamp 900
    });
    expect(result.current.width).toBe(900);
    expect(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)).toBe("900");

    // すでに最大なので、さらに ArrowLeft を押しても増えない。
    act(() => {
      result.current.handleProps.onKeyDown(keyDownEvent("ArrowLeft").event);
    });
    expect(result.current.width).toBe(900);
  });

  it("clamps to the minimum when ArrowRight would go below it", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "312" });
    const { result } = renderHook(() => useSidePanelResize(storage));
    expect(result.current.width).toBe(312);

    const right = keyDownEvent("ArrowRight");
    act(() => {
      result.current.handleProps.onKeyDown(right.event); // 312 - 24 = 288 -> clamp 300
    });
    expect(result.current.width).toBe(300);
    expect(storage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY)).toBe("300");

    // すでに最小なので、さらに ArrowRight を押しても減らない。
    act(() => {
      result.current.handleProps.onKeyDown(keyDownEvent("ArrowRight").event);
    });
    expect(result.current.width).toBe(300);
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

  it("reflects the viewport-derived maximum in aria-valuemax", () => {
    setViewportWidth(1000); // max = 900
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));
    expect(result.current.handleProps["aria-valuemax"]).toBe(900);
  });

  it("floors aria-valuemax to the minimum on a very narrow viewport", () => {
    setViewportWidth(200); // 0.9*200 = 180 < 300 -> floored to 300
    const { result } = renderHook(() => useSidePanelResize(memoryStorage()));
    expect(result.current.handleProps["aria-valuemax"]).toBe(300);
    expect(result.current.handleProps["aria-valuemin"]).toBe(300);
  });

  it("rounds a fractional width for aria-valuenow while keeping the raw width", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "512.4" });
    const { result } = renderHook(() => useSidePanelResize(storage));
    expect(result.current.width).toBe(512.4);
    expect(result.current.handleProps["aria-valuenow"]).toBe(512);
  });
});
