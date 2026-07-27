// ブロック番号ジャンプ欄（Issue #428。ARCHITECTURE.md §18.3.1）の表示・
// 入力挙動のテスト。`resolveBlockJump` 自体のロジック
// （バリデーション・フォーク tie-break・範囲導出）は
// entities/blockDetail.jump.test.ts で扱うため、ここでは表示コンポーネント
// としての責務（入力欄の同期・送信ボタンの活性/非活性・エラー文の出し分け）
// に絞る（CLAUDE.md のテスト分割方針）。
import type { BlockEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { BlockJumpForm } from "./BlockJumpForm.js";

afterEach(cleanup);

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 10,
    parentHash: "0xparent",
    timestamp: 1_700_000_000,
    receivedAt: {},
    ...overrides,
  };
}

function renderForm(options: {
  block: BlockEntity;
  blocksByHash: ReadonlyMap<string, BlockEntity>;
  onNavigate?: (hash: string) => void;
}) {
  const onNavigate = options.onNavigate ?? vi.fn();
  const view = render(
    <LanguageProvider initialLanguage="ja">
      <BlockJumpForm block={options.block} blocksByHash={options.blocksByHash} onNavigate={onNavigate} />
    </LanguageProvider>,
  );
  return { ...view, onNavigate };
}

function getInput(): HTMLInputElement {
  return screen.getByTestId("block-jump-input") as HTMLInputElement;
}

function getSubmit(): HTMLButtonElement {
  return screen.getByTestId("block-jump-submit") as HTMLButtonElement;
}

describe("BlockJumpForm: initial value and sync", () => {
  it("initializes the input with the currently displayed block's number", () => {
    const target = block({ hash: "0xtarget", number: 42 });
    renderForm({ block: target, blocksByHash: new Map([[target.hash, target]]) });
    expect(getInput().value).toBe("42");
  });

  it("re-syncs the input to the new block's number when the displayed block (hash) changes", () => {
    const first = block({ hash: "0xfirst", number: 10 });
    const second = block({ hash: "0xsecond", number: 11 });
    const map = new Map([
      [first.hash, first],
      [second.hash, second],
    ]);
    const { rerender } = renderForm({ block: first, blocksByHash: map });
    expect(getInput().value).toBe("10");

    fireEvent.change(getInput(), { target: { value: "999" } });
    expect(getInput().value).toBe("999");

    rerender(
      <LanguageProvider initialLanguage="ja">
        <BlockJumpForm block={second} blocksByHash={map} onNavigate={vi.fn()} />
      </LanguageProvider>,
    );
    // 手で入力した中途半端な値は、表示中ブロックが切り替わった時点で
    // 新しいブロック番号に上書きされる（ARCHITECTURE.md §18.3.1）。
    expect(getInput().value).toBe("11");
  });
});

describe("BlockJumpForm: submit behavior", () => {
  it("disables the submit button while the input is empty", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    renderForm({ block: target, blocksByHash: new Map([[target.hash, target]]) });
    fireEvent.change(getInput(), { target: { value: "" } });
    expect(getSubmit().disabled).toBe(true);
  });

  it("enables the submit button and navigates to the matching block's hash when a retained number is entered", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    const other = block({ hash: "0xother", number: 20 });
    const map = new Map([
      [target.hash, target],
      [other.hash, other],
    ]);
    const onNavigate = vi.fn();
    renderForm({ block: target, blocksByHash: map, onNavigate });

    fireEvent.change(getInput(), { target: { value: "20" } });
    expect(getSubmit().disabled).toBe(false);
    fireEvent.click(getSubmit());
    expect(onNavigate).toHaveBeenCalledWith("0xother");
  });

  it("submits via the Enter key (form submit), not only via the button click", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    const other = block({ hash: "0xother", number: 20 });
    const map = new Map([
      [target.hash, target],
      [other.hash, other],
    ]);
    const onNavigate = vi.fn();
    const { container } = renderForm({ block: target, blocksByHash: map, onNavigate });

    fireEvent.change(getInput(), { target: { value: "20" } });
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    expect(onNavigate).toHaveBeenCalledWith("0xother");
  });

  it("disables the submit button and does not navigate for a non-numeric input", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    const onNavigate = vi.fn();
    const { container } = renderForm({
      block: target,
      blocksByHash: new Map([[target.hash, target]]),
      onNavigate,
    });

    fireEvent.change(getInput(), { target: { value: "abc" } });
    expect(getSubmit().disabled).toBe(true);
    const form = container.querySelector("form");
    fireEvent.submit(form as HTMLFormElement);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("disables the submit button and does not navigate for a well-formed number outside the retention window", () => {
    // UI-B-07a のシナリオ2に対応する分岐。notFound は「対象ブロックが一意に
    // 定まらない」状態なので、エラー表示だけでなく送信自体もできない
    // （ARCHITECTURE.md §18.3.1）。
    const target = block({ hash: "0xtarget", number: 10 });
    const onNavigate = vi.fn();
    const { container } = renderForm({
      block: target,
      blocksByHash: new Map([[target.hash, target]]),
      onNavigate,
    });

    fireEvent.change(getInput(), { target: { value: "999999" } });
    expect(getSubmit().disabled).toBe(true);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only input like an empty one (disabled, no navigation)", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    const onNavigate = vi.fn();
    const { container } = renderForm({
      block: target,
      blocksByHash: new Map([[target.hash, target]]),
      onNavigate,
    });

    fireEvent.change(getInput(), { target: { value: "   " } });
    expect(getSubmit().disabled).toBe(true);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("accepts a number typed with surrounding whitespace", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    const other = block({ hash: "0xother", number: 20 });
    const map = new Map([
      [target.hash, target],
      [other.hash, other],
    ]);
    const onNavigate = vi.fn();
    renderForm({ block: target, blocksByHash: map, onNavigate });

    fireEvent.change(getInput(), { target: { value: "  20  " } });
    expect(getSubmit().disabled).toBe(false);
    fireEvent.click(getSubmit());
    expect(onNavigate).toHaveBeenCalledWith("0xother");
  });

  it("accepts a number typed with leading zeros", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    const other = block({ hash: "0xother", number: 20 });
    const map = new Map([
      [target.hash, target],
      [other.hash, other],
    ]);
    const onNavigate = vi.fn();
    renderForm({ block: target, blocksByHash: map, onNavigate });

    fireEvent.change(getInput(), { target: { value: "0020" } });
    expect(getSubmit().disabled).toBe(false);
    fireEvent.click(getSubmit());
    expect(onNavigate).toHaveBeenCalledWith("0xother");
  });

  it("keeps the submit button enabled for the currently displayed block's own number (navigating to itself is harmless)", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    const onNavigate = vi.fn();
    renderForm({
      block: target,
      blocksByHash: new Map([[target.hash, target]]),
      onNavigate,
    });

    // 入力欄の初期値は表示中のブロック番号そのもの。開いた直後に「移動」を
    // 押せてしまうが、同じ hash へ移動するだけで表示は変わらない。
    expect(getSubmit().disabled).toBe(false);
    fireEvent.click(getSubmit());
    expect(onNavigate).toHaveBeenCalledWith("0xtarget");
  });

  it("navigates to the fork tie-break winner when the entered number is forked", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    const forkEarly = block({
      hash: "0xearly",
      number: 20,
      receivedAt: { node1: 100 },
    });
    const forkLate = block({ hash: "0xlate", number: 20, receivedAt: { node1: 200 } });
    const map = new Map([
      [target.hash, target],
      [forkEarly.hash, forkEarly],
      [forkLate.hash, forkLate],
    ]);
    const onNavigate = vi.fn();
    renderForm({ block: target, blocksByHash: map, onNavigate });

    fireEvent.change(getInput(), { target: { value: "20" } });
    fireEvent.click(getSubmit());
    expect(onNavigate).toHaveBeenCalledWith("0xlate");
  });

  it("navigates once per click when the submit button is pressed repeatedly before the parent updates", () => {
    // 連続クリック。親が block prop を差し替えるまで入力欄の値は変わらない
    // ため、同じ hash への移動要求が繰り返し飛ぶ（冪等な操作で、状態が
    // 壊れたり別のブロックへ飛んだりしない）ことを固定する。
    const target = block({ hash: "0xtarget", number: 10 });
    const other = block({ hash: "0xother", number: 20 });
    const map = new Map([
      [target.hash, target],
      [other.hash, other],
    ]);
    const onNavigate = vi.fn();
    renderForm({ block: target, blocksByHash: map, onNavigate });

    fireEvent.change(getInput(), { target: { value: "20" } });
    fireEvent.click(getSubmit());
    fireEvent.click(getSubmit());
    fireEvent.click(getSubmit());
    expect(onNavigate).toHaveBeenCalledTimes(3);
    expect(onNavigate.mock.calls.every(([hash]) => hash === "0xother")).toBe(true);
    expect(getInput().value).toBe("20");
    expect(getSubmit().disabled).toBe(false);
  });
});

describe("BlockJumpForm: error messages", () => {
  it("shows no error message while the input is empty", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    renderForm({ block: target, blocksByHash: new Map([[target.hash, target]]) });
    fireEvent.change(getInput(), { target: { value: "" } });
    expect(screen.queryByTestId("block-jump-error-invalid")).toBeNull();
    expect(screen.queryByTestId("block-jump-error-notFound")).toBeNull();
  });

  it("shows the invalid-input message for a non-numeric value", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    renderForm({ block: target, blocksByHash: new Map([[target.hash, target]]) });
    fireEvent.change(getInput(), { target: { value: "abc" } });
    expect(screen.getByTestId("block-jump-error-invalid").textContent).toBe(
      "0以上の整数を入力してください",
    );
    expect(screen.queryByTestId("block-jump-error-notFound")).toBeNull();
  });

  it("shows the not-found message with the current retained range for a well-formed but absent number", () => {
    const a = block({ hash: "0xa", number: 100 });
    const b = block({ hash: "0xb", number: 131 });
    const map = new Map([
      [a.hash, a],
      [b.hash, b],
    ]);
    renderForm({ block: a, blocksByHash: map });
    fireEvent.change(getInput(), { target: { value: "50" } });
    expect(screen.getByTestId("block-jump-error-notFound").textContent).toBe(
      "指定したブロック番号は見つかりませんでした（現在保持しているのは #100 〜 #131）",
    );
    expect(screen.queryByTestId("block-jump-error-invalid")).toBeNull();
  });

  it("shows no error message while the input contains only whitespace", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    renderForm({ block: target, blocksByHash: new Map([[target.hash, target]]) });
    fireEvent.change(getInput(), { target: { value: "   " } });
    expect(screen.queryByTestId("block-jump-error-invalid")).toBeNull();
    expect(screen.queryByTestId("block-jump-error-notFound")).toBeNull();
  });

  it("shows the invalid-input message (not the not-found one) for digits beyond the safe integer range", () => {
    // 数字のみでも桁が大きすぎる入力は「保持範囲外」ではなく「入力が不正」。
    // 出し分けを取り違えると、存在しえない番号に対して保持範囲を提示して
    // しまい、ユーザーを「範囲内なら見つかるはず」と誤解させる。
    const target = block({ hash: "0xtarget", number: 10 });
    renderForm({ block: target, blocksByHash: new Map([[target.hash, target]]) });
    fireEvent.change(getInput(), { target: { value: "9007199254740992" } });
    expect(screen.getByTestId("block-jump-error-invalid")).toBeTruthy();
    expect(screen.queryByTestId("block-jump-error-notFound")).toBeNull();
  });

  it("shows the invalid-input message for full-width digits typed via an IME", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    renderForm({ block: target, blocksByHash: new Map([[target.hash, target]]) });
    fireEvent.change(getInput(), { target: { value: "２０" } });
    expect(screen.getByTestId("block-jump-error-invalid")).toBeTruthy();
    expect(screen.queryByTestId("block-jump-error-notFound")).toBeNull();
    expect(getSubmit().disabled).toBe(true);
  });

  it("shows a degenerate '#7 〜 #7' range when only one block is retained", () => {
    const only = block({ hash: "0xonly", number: 7 });
    renderForm({ block: only, blocksByHash: new Map([[only.hash, only]]) });
    fireEvent.change(getInput(), { target: { value: "8" } });
    expect(screen.getByTestId("block-jump-error-notFound").textContent).toBe(
      "指定したブロック番号は見つかりませんでした（現在保持しているのは #7 〜 #7）",
    );
  });

  it("substitutes min and max into the English not-found message too", () => {
    const a = block({ hash: "0xa", number: 100 });
    const b = block({ hash: "0xb", number: 131 });
    const map = new Map([
      [a.hash, a],
      [b.hash, b],
    ]);
    render(
      <LanguageProvider initialLanguage="en">
        <BlockJumpForm block={a} blocksByHash={map} onNavigate={vi.fn()} />
      </LanguageProvider>,
    );
    fireEvent.change(getInput(), { target: { value: "50" } });
    expect(screen.getByTestId("block-jump-error-notFound").textContent).toBe(
      "No block found with that number (currently retained: #100–#131)",
    );
  });

  it("switches from the not-found message to the invalid one as the input changes", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    renderForm({ block: target, blocksByHash: new Map([[target.hash, target]]) });

    fireEvent.change(getInput(), { target: { value: "99" } });
    expect(screen.getByTestId("block-jump-error-notFound")).toBeTruthy();
    expect(screen.queryByTestId("block-jump-error-invalid")).toBeNull();

    fireEvent.change(getInput(), { target: { value: "99x" } });
    expect(screen.getByTestId("block-jump-error-invalid")).toBeTruthy();
    expect(screen.queryByTestId("block-jump-error-notFound")).toBeNull();

    fireEvent.change(getInput(), { target: { value: "" } });
    expect(screen.queryByTestId("block-jump-error-invalid")).toBeNull();
    expect(screen.queryByTestId("block-jump-error-notFound")).toBeNull();
  });

  it("shows no error message once a previously-invalid input becomes a found block", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    renderForm({ block: target, blocksByHash: new Map([[target.hash, target]]) });
    fireEvent.change(getInput(), { target: { value: "abc" } });
    expect(screen.getByTestId("block-jump-error-invalid")).toBeTruthy();

    fireEvent.change(getInput(), { target: { value: "10" } });
    expect(screen.queryByTestId("block-jump-error-invalid")).toBeNull();
    expect(screen.queryByTestId("block-jump-error-notFound")).toBeNull();
  });
});
