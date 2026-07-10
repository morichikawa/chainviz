import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { TransferForm } from "./TransferForm.js";
import type { WalletCandidate } from "./walletCandidates.js";

afterEach(cleanup);

const candidates: WalletCandidate[] = [
  { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "0xaaaa (Alice)" },
];

function renderForm(onSubmit = vi.fn()) {
  render(
    <LanguageProvider initialLanguage="ja">
      <TransferForm walletCandidates={candidates} onSubmit={onSubmit} />
    </LanguageProvider>,
  );
  return onSubmit;
}

describe("TransferForm (ARCHITECTURE.md §6.5-1)", () => {
  it("shows a one-line description of what the transfer tab does (Issue #213)", () => {
    renderForm();
    expect(
      screen.getByText("あなたのウォレットから別のアドレスへ ETH を送る操作です"),
    ).toBeTruthy();
  });

  const validAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  it("submits the destination address as-is and converts the ETH amount to wei", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-transfer-to"), {
      target: { value: validAddress },
    });
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByText("送金する"));
    expect(onSubmit).toHaveBeenCalledWith({
      to: validAddress,
      amountWei: "1500000000000000000",
    });
  });

  it("trims whitespace from the destination address before submitting", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-transfer-to"), {
      target: { value: `  ${validAddress}  ` },
    });
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByText("送金する"));
    expect(onSubmit).toHaveBeenCalledWith({
      to: validAddress,
      amountWei: "1000000000000000000",
    });
  });

  it("disables the submit button while the destination is empty", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "1" },
    });
    const button = screen.getByText("送金する") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("disables the submit button while the amount is invalid", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("operation-transfer-to"), {
      target: { value: validAddress },
    });
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "not-a-number" },
    });
    const button = screen.getByText("送金する") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  // Issue #236: 宛先が「0x」+40桁16進の形式と矛盾する場合、送信ボタンを
  // 無効化しインラインエラーを表示する（デプロイ/呼び出しフォームの
  // address型引数と同じバリデーション・表示パターン）。
  it("disables the submit button and shows an error while the destination has an invalid address format", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("operation-transfer-to"), {
      target: { value: "0x123" },
    });
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "1" },
    });
    const button = screen.getByText("送金する") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId("operation-transfer-to-error")).toBeTruthy();
  });

  it("does not show a destination validation message while the destination field is empty", () => {
    renderForm();
    expect(screen.queryByTestId("operation-transfer-to-error")).toBeNull();
  });

  it("hides the destination validation message and re-enables submit once the address is corrected", () => {
    renderForm();
    const toInput = screen.getByTestId("operation-transfer-to");
    fireEvent.change(toInput, { target: { value: "0x123" } });
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "1" },
    });
    expect(screen.getByTestId("operation-transfer-to-error")).toBeTruthy();

    fireEvent.change(toInput, { target: { value: validAddress } });
    expect(screen.queryByTestId("operation-transfer-to-error")).toBeNull();
    const button = screen.getByText("送金する") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("does not call onSubmit when the destination address has an invalid format", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-transfer-to"), {
      target: { value: "0x123" },
    });
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByTestId("operation-transfer-to").closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a validation message once an invalid amount has been typed", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "abc" },
    });
    expect(
      screen.getByText("0以上のETH数量を10進数で入力してください（例: 0.5）"),
    ).toBeTruthy();
  });

  it("does not show a validation message while the amount field is empty", () => {
    renderForm();
    expect(
      screen.queryByText("0以上のETH数量を10進数で入力してください（例: 0.5）"),
    ).toBeNull();
  });

  it("lists existing wallets as datalist candidates for the destination field", () => {
    renderForm();
    const input = screen.getByTestId("operation-transfer-to") as HTMLInputElement;
    const list = document.getElementById(input.getAttribute("list") ?? "");
    expect(list?.textContent).toContain("0xaaaa (Alice)");
  });

  it("does not call onSubmit when the form is invalid and submit is attempted anyway", () => {
    const onSubmit = renderForm();
    // ボタンは disabled だが、フォーム自体の submit イベント発火（Enterキー等）
    // でもガードが効くことを確認する。
    fireEvent.submit(screen.getByTestId("operation-transfer-to").closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
