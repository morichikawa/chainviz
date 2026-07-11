import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOVER_POPOVER_CLOSE_DELAY_MS } from "../interaction/useHoverPopover.js";
import { ActionHint } from "./ActionHint.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ActionHint", () => {
  it("renders the children without a tooltip by default", () => {
    render(
      <ActionHint hint="hello">
        <button type="button">Click me</button>
      </ActionHint>,
    );
    expect(screen.getByRole("button", { name: "Click me" })).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it(
    "shows the hint text on mouse enter and hides it on mouse leave " +
      "after the close delay (Issue #221: not immediately, so the cursor can " +
      "still reach the popover across the gap)",
    () => {
      render(
        <ActionHint hint="hello world">
          <button type="button">Click me</button>
        </ActionHint>,
      );
      const wrapper = screen.getByRole("button").parentElement as HTMLElement;
      fireEvent.mouseEnter(wrapper);
      expect(screen.getByRole("tooltip").textContent).toBe("hello world");
      fireEvent.mouseLeave(wrapper);
      // 即座には消えない（隙間通過中の可能性があるため）。
      expect(screen.getByRole("tooltip")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
      });
      expect(screen.queryByRole("tooltip")).toBeNull();
    },
  );

  it("shows the hint text on focus and hides it on blur (keyboard accessibility)", () => {
    render(
      <ActionHint hint="focus hint">
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const button = screen.getByRole("button");
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip").textContent).toBe("focus hint");
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("sets aria-describedby on the wrapper only while the tooltip is open", () => {
    render(
      <ActionHint hint="described">
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const wrapper = screen.getByRole("button").parentElement as HTMLElement;
    expect(wrapper.getAttribute("aria-describedby")).toBeNull();
    fireEvent.mouseEnter(wrapper);
    const tooltip = screen.getByRole("tooltip");
    expect(wrapper.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("renders an empty hint without crashing", () => {
    render(
      <ActionHint hint="">
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const wrapper = screen.getByRole("button").parentElement as HTMLElement;
    expect(() => fireEvent.mouseEnter(wrapper)).not.toThrow();
    expect(screen.getByRole("tooltip").textContent).toBe("");
  });

  it(
    "accepts a ReactNode hint (not just a plain string), e.g. multi-line " +
      "markup with a nested element (Issue #251)",
    () => {
      render(
        <ActionHint
          hint={
            <>
              <span>line one</span>
              <span data-testid="hint-nested">line two</span>
            </>
          }
        >
          <button type="button">Click me</button>
        </ActionHint>,
      );
      const wrapper = screen.getByRole("button").parentElement as HTMLElement;
      fireEvent.mouseEnter(wrapper);
      const tooltip = screen.getByRole("tooltip");
      expect(tooltip.textContent).toBe("line oneline two");
      expect(tooltip.querySelector('[data-testid="hint-nested"]')).toBeTruthy();
    },
  );
});
