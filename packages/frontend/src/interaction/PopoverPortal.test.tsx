import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PopoverPortal } from "./PopoverPortal.js";

function stubRect(
  el: HTMLElement,
  rect: { top: number; left: number; right: number; bottom: number },
) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...rect,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PopoverPortal (Issue #245)", () => {
  it("renders into document.body rather than the local render container", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = { current: anchor };

    const { container } = render(
      <PopoverPortal anchorRef={anchorRef} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );

    expect(container.querySelector('[data-testid="popover-content"]')).toBeNull();
    expect(screen.getByTestId("popover-content").textContent).toBe("detail");
    anchor.remove();
  });

  it("computes a fixed position from the anchor's bounding rect on mount", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = { current: anchor };

    render(
      <PopoverPortal anchorRef={anchorRef} gapPx={8} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );

    const el = screen.getByTestId("popover-content");
    expect(el.style.position).toBe("fixed");
    expect(el.style.top).toBe("48px");
    expect(el.style.left).toBe("20px");
    anchor.remove();
  });

  it("keeps tracking the anchor across frames (canvas pan/zoom does not fire scroll/resize)", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = { current: anchor };

    render(
      <PopoverPortal anchorRef={anchorRef} gapPx={8} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );

    // アンカーが動いた(パン/ズーム/ドラッグ相当)後も、次フレームで追従する。
    stubRect(anchor, { top: 200, left: 340, right: 440, bottom: 230 });
    act(() => {
      vi.advanceTimersByTime(32);
    });

    const el = screen.getByTestId("popover-content");
    expect(el.style.top).toBe("238px");
    expect(el.style.left).toBe("340px");
    anchor.remove();
  });

  it("stops updating once the anchor is detached (ref.current becomes null)", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = createRef<HTMLElement>();
    (anchorRef as { current: HTMLElement | null }).current = anchor;

    render(
      <PopoverPortal anchorRef={anchorRef} gapPx={8} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );

    (anchorRef as { current: HTMLElement | null }).current = null;
    stubRect(anchor, { top: 999, left: 999, right: 1099, bottom: 1029 });
    act(() => {
      vi.advanceTimersByTime(32);
    });

    // ref が外れた後は最後に計算した位置のまま据え置かれ、クラッシュもしない。
    const el = screen.getByTestId("popover-content");
    expect(el.style.top).toBe("48px");
    expect(el.style.left).toBe("20px");
    anchor.remove();
  });

  it("cancels the animation frame loop on unmount without throwing", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = { current: anchor };

    const { unmount } = render(
      <PopoverPortal anchorRef={anchorRef} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );

    expect(() => {
      unmount();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }).not.toThrow();
    anchor.remove();
  });

  it("passes through className, role and other DOM attributes to the portaled element", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = { current: anchor };

    render(
      <PopoverPortal
        anchorRef={anchorRef}
        className="infra-popover"
        role="tooltip"
        data-testid="popover-content"
      >
        detail
      </PopoverPortal>,
    );

    const el = screen.getByTestId("popover-content");
    expect(el.className).toBe("infra-popover");
    expect(el.getAttribute("role")).toBe("tooltip");
    anchor.remove();
  });
});
