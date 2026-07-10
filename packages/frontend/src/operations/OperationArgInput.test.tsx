import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperationArgField } from "../chain-profiles/ethereum/operationCatalog.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { OperationArgInput } from "./OperationArgInput.js";
import type { WalletCandidate } from "./walletCandidates.js";

afterEach(cleanup);

function renderInput(
  field: OperationArgField,
  value: string,
  onChange = vi.fn(),
  walletCandidates: WalletCandidate[] = [],
) {
  render(
    <LanguageProvider initialLanguage="ja">
      <OperationArgInput
        field={field}
        value={value}
        onChange={onChange}
        walletCandidates={walletCandidates}
        testId="operation-arg-test"
      />
    </LanguageProvider>,
  );
  return onChange;
}

describe("OperationArgInput (Issue #209)", () => {
  it("renders a plain text input for a uint field and calls onChange", () => {
    const onChange = renderInput({ name: "amount", type: "uint" }, "");
    fireEvent.change(screen.getByTestId("operation-arg-test"), {
      target: { value: "100" },
    });
    expect(onChange).toHaveBeenCalledWith("100");
  });

  it("shows no error for an empty uint value", () => {
    renderInput({ name: "amount", type: "uint" }, "");
    expect(screen.queryByTestId("operation-arg-test-error")).toBeNull();
  });

  it("shows an error for a non-numeric uint value", () => {
    renderInput({ name: "amount", type: "uint" }, "test");
    expect(screen.getByTestId("operation-arg-test-error")).toBeTruthy();
  });

  it("shows no error for a valid uint value", () => {
    renderInput({ name: "amount", type: "uint" }, "100");
    expect(screen.queryByTestId("operation-arg-test-error")).toBeNull();
  });

  it("renders an address field with the wallet candidates as a datalist", () => {
    renderInput({ name: "to", type: "address" }, "", vi.fn(), [
      { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "Alice" },
    ]);
    const input = screen.getByTestId("operation-arg-test") as HTMLInputElement;
    const list = document.getElementById(input.getAttribute("list") ?? "");
    expect(list?.textContent).toContain("Alice");
  });

  it("shows an error for a malformed address value", () => {
    renderInput({ name: "to", type: "address" }, "0xbob");
    expect(screen.getByTestId("operation-arg-test-error")).toBeTruthy();
  });

  it("shows no error for a well-formed address value", () => {
    renderInput(
      { name: "to", type: "address" },
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(screen.queryByTestId("operation-arg-test-error")).toBeNull();
  });

  it("never shows an error for string/bool fields (out of validation scope)", () => {
    renderInput({ name: "label", type: "string" }, "anything goes");
    expect(screen.queryByTestId("operation-arg-test-error")).toBeNull();
  });

  it("shows the uint-specific message (not the address one) for a bad uint value", () => {
    // どの引数がなぜ無効かが伝わるよう、型ごとに文言が分かれていることを確認。
    renderInput({ name: "amount", type: "uint" }, "test");
    const error = screen.getByTestId("operation-arg-test-error");
    expect(error.textContent).toBe("0以上の整数を入力してください（例: 1000）");
  });

  it("shows the address-specific message (not the uint one) for a bad address value", () => {
    renderInput({ name: "to", type: "address" }, "0xbob");
    const error = screen.getByTestId("operation-arg-test-error");
    expect(error.textContent).toBe(
      "0xで始まる40桁の16進数のアドレスを入力してください（例: 0x1234…）",
    );
  });

  it("does not show an error for a whitespace-only uint value (blank is not flagged)", () => {
    // 未入力扱いの空白のみは赤字にしない（送信ボタンの無効化のみで防ぐ）。
    renderInput({ name: "amount", type: "uint" }, "   ");
    expect(screen.queryByTestId("operation-arg-test-error")).toBeNull();
  });

  it("keeps the error label tied to the field's own testId prefix", () => {
    // 複数の引数入力が並んだとき、エラー文言の data-testid が各入力の
    // testId に紐づくことを確認する（フォーム側でどの欄のエラーか特定できる）。
    render(
      <LanguageProvider initialLanguage="ja">
        <OperationArgInput
          field={{ name: "amount", type: "uint" }}
          value="test"
          onChange={vi.fn()}
          testId="operation-deploy-arg-initialSupply"
        />
      </LanguageProvider>,
    );
    expect(
      screen.getByTestId("operation-deploy-arg-initialSupply-error"),
    ).toBeTruthy();
  });
});
