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

  it("submits the destination address as-is and converts the ETH amount to wei", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-transfer-to"), {
      target: { value: "0xbob" },
    });
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByText("送金する"));
    expect(onSubmit).toHaveBeenCalledWith({
      to: "0xbob",
      amountWei: "1500000000000000000",
    });
  });

  it("trims whitespace from the destination address before submitting", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-transfer-to"), {
      target: { value: "  0xbob  " },
    });
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByText("送金する"));
    expect(onSubmit).toHaveBeenCalledWith({
      to: "0xbob",
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
      target: { value: "0xbob" },
    });
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "not-a-number" },
    });
    const button = screen.getByText("送金する") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
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
