import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOVER_POPOVER_CLOSE_DELAY_MS } from "../interaction/useHoverPopover.js";
import { ActionHint } from "./ActionHint.js";

/**
 * Issue #410: `suppressed` は内部のホバー/フォーカス状態（`useHoverPopover`
 * の `open`）は変えず、表示（`visible = open && !suppressed`）だけを隠す。
 * ActionHint.suppressed.test.tsx が「開いた状態を隠す/戻す」基本挙動を
 * 押さえているのに対し、こちらは「suppressed で表示を隠している最中に
 * 起きたホバー/フォーカスの遷移が、抑制解除後の表示と食い違わない」
 * （＝表示と内部状態の整合）という境界に関心事を絞る。
 *
 * onMouseEnter/onFocus/onMouseLeave/onBlur のハンドラは suppressed に
 * 関係なく常に配線されているため、抑制中でも内部状態は変化し続ける。
 * その結果、抑制解除の瞬間に「解除時点で本当にホバー/フォーカスして
 * いるか」がそのまま表示に反映されなければならない。
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ActionHint suppressed vs. underlying hover/focus state (Issue #410)", () => {
  it("does not resurrect the tooltip after suppression lifts if the mouse genuinely left while suppressed", () => {
    const { rerender } = render(
      <ActionHint hint="hello" suppressed={false}>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const wrapper = screen.getByRole("button").parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    // 操作パネルが開く＝suppressed=true。表示は隠れる。
    rerender(
      <ActionHint hint="hello" suppressed>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();

    // 抑制中にカーソルがボタンから離れる。遅延クローズが満了すると内部の
    // ホバー状態も閉じる（ハンドラは suppressed でも生きているため）。
    fireEvent.mouseLeave(wrapper);
    act(() => {
      vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
    });

    // 抑制が解除されても、既にホバーは終わっているので復活してはいけない。
    rerender(
      <ActionHint hint="hello" suppressed={false}>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not resurrect the tooltip after suppression lifts if focus was lost while suppressed", () => {
    const { rerender } = render(
      <ActionHint hint="hello" suppressed={false}>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const button = screen.getByRole("button");
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    rerender(
      <ActionHint hint="hello" suppressed>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();

    // 操作パネルを開いた直後にパネル内の入力欄へフォーカスが移る、を再現。
    // blur は即座に内部状態を閉じる（遅延なし）。
    fireEvent.blur(button);

    rerender(
      <ActionHint hint="hello" suppressed={false}>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("remembers a hover that STARTED while suppressed and reveals the tooltip once suppression lifts", () => {
    // suppressed.test.tsx の「抑制前に開いていたものを戻す」とは順序が逆で、
    // 抑制中に新しく始まったホバーが内部状態として記憶され、解除時に現れる。
    const { rerender } = render(
      <ActionHint hint="hello" suppressed>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const wrapper = screen.getByRole("button").parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    // 抑制中なので見た目は出ないが、内部の open は true になっている。
    expect(screen.queryByRole("tooltip")).toBeNull();

    rerender(
      <ActionHint hint="hello" suppressed={false}>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    expect(screen.getByRole("tooltip").textContent).toBe("hello");
  });

  it("remembers a focus that started while suppressed and reveals the tooltip once suppression lifts", () => {
    const { rerender } = render(
      <ActionHint hint="hello" suppressed>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    const button = screen.getByRole("button");
    fireEvent.focus(button);
    expect(screen.queryByRole("tooltip")).toBeNull();

    rerender(
      <ActionHint hint="hello" suppressed={false}>
        <button type="button">Click me</button>
      </ActionHint>,
    );
    expect(screen.getByRole("tooltip").textContent).toBe("hello");
  });
});
