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
