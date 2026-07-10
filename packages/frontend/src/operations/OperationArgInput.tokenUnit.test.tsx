import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperationArgField } from "../chain-profiles/ethereum/operationCatalog.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { OperationArgInput } from "./OperationArgInput.js";

afterEach(cleanup);

/**
 * `unit: "token"` + `tokenInfo` の組み合わせ（Issue #219: トークン単位入力）
 * に関する `OperationArgInput` のテスト。ABI型のみの通常挙動（#209）は
 * `OperationArgInput.test.tsx` が担う。
 */
const TOKEN_FIELD: OperationArgField = { name: "amount", type: "uint", unit: "token" };

const DEFAULT_TOKEN_INFO = { symbol: "CVZ", decimals: 18 };

/**
 * `tokenInfo` は「省略」と「明示的に undefined」を同一視するため、通常の
 * デフォルト引数（`= DEFAULT_TOKEN_INFO`）では書けない（呼び出し側が
 * `undefined` を渡すと JS のデフォルト引数機構がそれを補ってしまい、
 * 「tokenInfo が無いケース」を再現できない）。そのため必ず明示的に渡す。
 */
function renderInput(
  value: string,
  onChange: (value: string) => void,
  tokenInfo: { symbol: string; decimals: number } | undefined,
) {
  render(
    <LanguageProvider initialLanguage="ja">
      <OperationArgInput
        field={TOKEN_FIELD}
        value={value}
        onChange={onChange}
        tokenInfo={tokenInfo}
        testId="operation-arg-token-test"
      />
    </LanguageProvider>,
  );
  return onChange;
}

describe("OperationArgInput with a token-unit field (Issue #219)", () => {
  it("appends the token symbol suffix to the label", () => {
    renderInput("", vi.fn(), DEFAULT_TOKEN_INFO);
    expect(screen.getByText("amount（CVZ単位）")).toBeTruthy();
  });

  it("accepts a decimal token-unit value without showing an error", () => {
    renderInput("1.5", vi.fn(), DEFAULT_TOKEN_INFO);
    expect(screen.queryByTestId("operation-arg-token-test-error")).toBeNull();
  });

  it("shows the token-specific error message (not the plain uint one) for a value exceeding the token's decimals", () => {
    renderInput("1.0000000000000000001", vi.fn(), DEFAULT_TOKEN_INFO);
    const error = screen.getByTestId("operation-arg-token-test-error");
    expect(error.textContent).toBe(
      "0以上のトークン量を10進数で入力してください（例: 1.5）",
    );
  });

  it("falls back to plain uint validation (raw minimal-unit integer) when tokenInfo is not provided", () => {
    // tokenInfo が無い（対象コントラクトのtoken情報が取れない）ときは、
    // unit: "token" を指定していても通常のuintフィールドとして扱う。
    renderInput("1.5", vi.fn(), undefined);
    expect(screen.getByTestId("operation-arg-token-test-error")).toBeTruthy();
    const error = screen.getByTestId("operation-arg-token-test-error");
    expect(error.textContent).toBe("0以上の整数を入力してください（例: 1000）");
  });

  it("does not append a unit suffix when tokenInfo is not provided", () => {
    renderInput("", vi.fn(), undefined);
    expect(screen.queryByText(/単位/)).toBeNull();
  });

  it("calls onChange with the raw text as typed (conversion happens at submit time, not on keystroke)", () => {
    const onChange = renderInput("", vi.fn(), DEFAULT_TOKEN_INFO);
    fireEvent.change(screen.getByTestId("operation-arg-token-test"), {
      target: { value: "1.5" },
    });
    expect(onChange).toHaveBeenCalledWith("1.5");
  });
});
