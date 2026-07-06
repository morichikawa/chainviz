import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionHint } from "./ActionHint.js";

afterEach(cleanup);

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

  it("shows the hint text on mouse enter and hides it on mouse leave", () => {
    render(
      <ActionHint hint="hello world">
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const wrapper = screen.getByRole("button").parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("tooltip").textContent).toBe("hello world");
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

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
});
