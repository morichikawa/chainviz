import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { TransferForm } from "./TransferForm.js";
import type { WalletCandidate } from "./walletCandidates.js";

// Issue #236: 宛先アドレス形式バリデーションの境界値・異常系・状態遷移を
// 集中的に検証する。基本挙動（送信成功・trim・未入力/金額不正など）は
// TransferForm.test.tsx に、`isValidOperationArgValue` 単体の網羅は
// operationArgValidation.test.ts にある。ここではフォーム全体としての
// 表示・ボタン活性・複数エラーの共存を対象にする。

afterEach(cleanup);

const candidates: WalletCandidate[] = [
  { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "0xaaaa (Alice)" },
];

const AMOUNT_ERROR = "0以上のETH数量を10進数で入力してください（例: 0.5）";

function renderForm(onSubmit = vi.fn()) {
  render(
    <LanguageProvider initialLanguage="ja">
      <TransferForm walletCandidates={candidates} onSubmit={onSubmit} />
    </LanguageProvider>,
  );
  return onSubmit;
}

function setTo(value: string) {
  fireEvent.change(screen.getByTestId("operation-transfer-to"), {
    target: { value },
  });
}

function setAmount(value: string) {
  fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
    target: { value },
  });
}

function submitButton() {
  return screen.getByText("送金する") as HTMLButtonElement;
}

describe("TransferForm destination address boundary values (Issue #236)", () => {
  // 金額は常に有効な値を入れておき、送信可否がアドレスのみで決まるようにする。
  const invalidBoundaryCases: Array<[string, string]> = [
    ["39 hex digits (one short)", `0x${"a".repeat(39)}`],
    ["41 hex digits (one over)", `0x${"a".repeat(41)}`],
    ["40 hex digits without the 0x prefix", "a".repeat(40)],
    ["uppercase 0X prefix", `0X${"a".repeat(40)}`],
    ["non-hex character inside", `0x${"g".repeat(40)}`],
    [
      "whitespace embedded between hex digits",
      `0x${"a".repeat(20)} ${"a".repeat(19)}`,
    ],
    ["only the 0x prefix", "0x"],
    ["a wallet-like label instead of an address", "0xaaaa (Alice)"],
  ];

  for (const [name, value] of invalidBoundaryCases) {
    it(`keeps submit disabled and shows the error for ${name}`, () => {
      const onSubmit = renderForm();
      setTo(value);
      setAmount("1");
      expect(submitButton().disabled).toBe(true);
      expect(screen.getByTestId("operation-transfer-to-error")).toBeTruthy();
      // Enter キー相当の submit イベントでも送出されないことまで確認する。
      fireEvent.submit(screen.getByTestId("operation-transfer-to").closest("form")!);
      expect(onSubmit).not.toHaveBeenCalled();
    });
  }

  it("accepts a mixed-case checksummed address (no EIP-55 enforcement) and enables submit", () => {
    const onSubmit = renderForm();
    const checksummed = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
    setTo(checksummed);
    setAmount("1");
    expect(screen.queryByTestId("operation-transfer-to-error")).toBeNull();
    expect(submitButton().disabled).toBe(false);
    fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledWith({
      to: checksummed,
      amountWei: "1000000000000000000",
    });
  });

  it("accepts a valid address with surrounding whitespace without showing an error", () => {
    const onSubmit = renderForm();
    const validAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    setTo(`  ${validAddress}  `);
    setAmount("1");
    expect(screen.queryByTestId("operation-transfer-to-error")).toBeNull();
    expect(submitButton().disabled).toBe(false);
    fireEvent.click(submitButton());
    // 送出時は trim 済みの値が渡る。
    expect(onSubmit).toHaveBeenCalledWith({
      to: validAddress,
      amountWei: "1000000000000000000",
    });
  });

  it("does not show the error while the destination is only whitespace (treated as empty, not invalid)", () => {
    renderForm();
    setTo("   ");
    setAmount("1");
    // 空欄と同じ扱い: エラーは出さず、ボタンだけ無効。
    expect(screen.queryByTestId("operation-transfer-to-error")).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });
});

describe("TransferForm error coexistence and priority (Issue #236)", () => {
  it("shows the destination and amount errors simultaneously when both are invalid", () => {
    renderForm();
    setTo("0x123");
    setAmount("not-a-number");
    expect(screen.getByTestId("operation-transfer-to-error")).toBeTruthy();
    expect(screen.getByText(AMOUNT_ERROR)).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });

  it("keeps submit disabled while only the destination is fixed but the amount stays invalid", () => {
    renderForm();
    setTo("0x123");
    setAmount("not-a-number");

    setTo("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    // 宛先エラーは消えるが、金額エラーが残る。
    expect(screen.queryByTestId("operation-transfer-to-error")).toBeNull();
    expect(screen.getByText(AMOUNT_ERROR)).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });

  it("keeps submit disabled while only the amount is fixed but the destination stays invalid", () => {
    renderForm();
    setTo("0x123");
    setAmount("not-a-number");

    setAmount("1");
    // 金額エラーは消えるが、宛先エラーが残る。
    expect(screen.queryByText(AMOUNT_ERROR)).toBeNull();
    expect(screen.getByTestId("operation-transfer-to-error")).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });

  it("enables submit only once both the destination and the amount are valid", () => {
    const onSubmit = renderForm();
    setTo("0x123");
    setAmount("not-a-number");
    expect(submitButton().disabled).toBe(true);

    setTo("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    setAmount("2");
    expect(screen.queryByTestId("operation-transfer-to-error")).toBeNull();
    expect(screen.queryByText(AMOUNT_ERROR)).toBeNull();
    expect(submitButton().disabled).toBe(false);
    fireEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledWith({
      to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      amountWei: "2000000000000000000",
    });
  });
});

describe("TransferForm destination error tracks repeated edits (Issue #236)", () => {
  it("follows an invalid -> valid -> invalid round trip", () => {
    renderForm();
    const validAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    setAmount("1");

    // 1) 不正
    setTo("0x123");
    expect(screen.getByTestId("operation-transfer-to-error")).toBeTruthy();
    expect(submitButton().disabled).toBe(true);

    // 2) 訂正 -> エラー消滅・送信可能
    setTo(validAddress);
    expect(screen.queryByTestId("operation-transfer-to-error")).toBeNull();
    expect(submitButton().disabled).toBe(false);

    // 3) 再び不正 -> エラー復活・送信不可
    setTo(`${validAddress}00`);
    expect(screen.getByTestId("operation-transfer-to-error")).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });

  it("clears the error when an invalid value is fully deleted back to empty", () => {
    renderForm();
    setAmount("1");
    setTo("0x123");
    expect(screen.getByTestId("operation-transfer-to-error")).toBeTruthy();

    // 全消し -> 未入力扱いに戻り、エラーは出さない（ボタンは無効のまま）。
    setTo("");
    expect(screen.queryByTestId("operation-transfer-to-error")).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });
});
