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

  it("defaults the gap to 8px when gapPx is omitted", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = { current: anchor };

    render(
      <PopoverPortal anchorRef={anchorRef} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );

    // gapPx 未指定なら DEFAULT_GAP_PX(8) が使われ、bottom(40) + 8 = 48。
    expect(screen.getByTestId("popover-content").style.top).toBe("48px");
    anchor.remove();
  });

  it("renders nothing while the anchor ref is null at mount (no position yet)", () => {
    const anchorRef = createRef<HTMLElement>();

    render(
      <PopoverPortal anchorRef={anchorRef} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );

    // アンカーがまだ無い間は座標が定まらないため何も描画しない（null を返す）。
    expect(screen.queryByTestId("popover-content")).toBeNull();
  });

  it("starts tracking once the anchor is attached after mount (ref was null first)", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 60, left: 70, right: 170, bottom: 90 });
    const anchorRef = createRef<HTMLElement>();

    render(
      <PopoverPortal anchorRef={anchorRef} gapPx={8} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );
    // 最初は null。
    expect(screen.queryByTestId("popover-content")).toBeNull();

    // 後からアンカーが割り当てられたら、次フレームで座標が定まり描画される。
    (anchorRef as { current: HTMLElement | null }).current = anchor;
    act(() => {
      vi.advanceTimersByTime(16);
    });

    const el = screen.getByTestId("popover-content");
    expect(el.style.top).toBe("98px");
    expect(el.style.left).toBe("70px");
    anchor.remove();
  });

  it("recomputes the position when gapPx changes (effect re-runs on prop change)", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = { current: anchor };

    const { rerender } = render(
      <PopoverPortal anchorRef={anchorRef} gapPx={8} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );
    expect(screen.getByTestId("popover-content").style.top).toBe("48px");

    rerender(
      <PopoverPortal anchorRef={anchorRef} gapPx={20} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );
    // bottom(40) + 新 gap(20) = 60。
    expect(screen.getByTestId("popover-content").style.top).toBe("60px");
    anchor.remove();
  });

  it("keeps scheduling animation frames every frame while mounted (continuous follow)", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = { current: anchor };
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

    render(
      <PopoverPortal anchorRef={anchorRef} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );
    const callsAfterMount = rafSpy.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(64);
    });
    // 表示中は毎フレーム次フレームを予約し続ける（イベント依存ではなく rAF
    // ポーリングで追従する設計）。フレームを進めた分だけ予約が増える。
    expect(rafSpy.mock.calls.length).toBeGreaterThan(callsAfterMount);
    rafSpy.mockRestore();
    anchor.remove();
  });

  it("cancels its pending animation frame on unmount (no leaked rAF loop)", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = { current: anchor };
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");

    const { unmount } = render(
      <PopoverPortal anchorRef={anchorRef} data-testid="popover-content">
        detail
      </PopoverPortal>,
    );
    unmount();

    // クリーンアップで確実に cancelAnimationFrame を呼ぶ（rAF ループが
    // アンマウント後も走り続けてリークしないこと）。
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
    anchor.remove();
  });

  it("does not re-render the children when the anchor position is unchanged", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    stubRect(anchor, { top: 10, left: 20, right: 120, bottom: 40 });
    const anchorRef = { current: anchor };

    let renderCount = 0;
    function Child() {
      renderCount += 1;
      return <span>child</span>;
    }

    render(
      <PopoverPortal anchorRef={anchorRef} data-testid="popover-content">
        <Child />
      </PopoverPortal>,
    );
    const countAfterMount = renderCount;

    // 位置が変わらないまま何フレーム進めても setState をスキップするため、
    // 子は再レンダーされない（無駄な再描画を避ける最適化）。
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(renderCount).toBe(countAfterMount);
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
