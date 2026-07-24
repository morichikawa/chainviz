import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionHint } from "./ActionHint.js";

afterEach(() => {
  cleanup();
});

// Issue #410: 「操作を実行…」ボタンをクリックした瞬間、カーソルがまだボタン
// 上に残っていて内部のホバー状態は開いたままでも、呼び出し側が
// suppressed=true を渡せば予告ツールチップを即座に隠せることの確認
// （ActionHint.test.tsx はホバー/フォーカスの基本挙動、こちらは新規追加した
// suppressed の抑制挙動に関心事を分けて別ファイルにする）。
describe("ActionHint suppressed prop", () => {
  it("hides an already-open tooltip when suppressed becomes true, without closing the underlying hover state", () => {
    const { rerender } = render(
      <ActionHint hint="hello" suppressed={false}>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const wrapper = screen.getByRole("button").parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    rerender(
      <ActionHint hint="hello" suppressed>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();

    // suppressed が解除されれば、ホバー状態そのものは保持されていたので
    // 再度ホバーし直さなくても表示が戻る(内部の open 自体は変更していない)。
    rerender(
      <ActionHint hint="hello" suppressed={false}>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    expect(screen.getByRole("tooltip").textContent).toBe("hello");
  });

  it("does not open the tooltip on hover while suppressed is true", () => {
    render(
      <ActionHint hint="hello" suppressed>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const wrapper = screen.getByRole("button").parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("clears aria-describedby while suppressed even if hovered", () => {
    render(
      <ActionHint hint="hello" suppressed>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const wrapper = screen.getByRole("button").parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(wrapper.getAttribute("aria-describedby")).toBeNull();
  });

  it("defaults to not suppressed when the prop is omitted (existing callers unaffected)", () => {
    render(
      <ActionHint hint="default behavior">
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const wrapper = screen.getByRole("button").parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("tooltip").textContent).toBe("default behavior");
  });
});
