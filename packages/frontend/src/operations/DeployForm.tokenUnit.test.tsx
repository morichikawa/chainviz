import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContractCatalogEntry } from "../chain-profiles/ethereum/operationCatalog.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { DeployForm } from "./DeployForm.js";

afterEach(cleanup);

/**
 * デプロイタブでの `unit: "token"` コンストラクタ引数（Issue #219: トークン
 * 単位入力＋decimals換算）のテスト。ABI型チェック自体（#209）や通常の
 * デプロイ挙動は `DeployForm.test.tsx` が担う。
 */
const TOKEN_WITH_UNIT: ContractCatalogEntry = {
  catalogKey: "ChainvizToken",
  displayName: { ja: "ChainvizToken", en: "ChainvizToken" },
  description: { ja: "最小のERC20", en: "minimal ERC20" },
  token: { symbol: "CVZDEMO", decimals: 18 },
  constructorArgs: [{ name: "initialSupply", type: "uint", unit: "token" }],
  functions: [],
};

function renderForm(onSubmit = vi.fn()) {
  render(
    <LanguageProvider initialLanguage="ja">
      <DeployForm catalog={[TOKEN_WITH_UNIT]} onSubmit={onSubmit} />
    </LanguageProvider>,
  );
  return onSubmit;
}

describe("DeployForm with a token-unit constructor arg (Issue #219)", () => {
  it("shows the symbol suffix on the constructor arg label", () => {
    renderForm();
    expect(screen.getByText("initialSupply（CVZDEMO単位）")).toBeTruthy();
  });

  it("converts a decimal token-unit amount to the minimal unit on submit", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-deploy-arg-initialSupply"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByText("デプロイする"));
    expect(onSubmit).toHaveBeenCalledWith({
      contractKey: "ChainvizToken",
      constructorArgs: ["1000000000000000000000"],
    });
  });

  it("disables submit for a value with more fractional digits than the token's decimals allow", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("operation-deploy-arg-initialSupply"), {
      target: { value: "1.0000000000000000001" },
    });
    expect(
      screen.getByTestId("operation-deploy-arg-initialSupply-error"),
    ).toBeTruthy();
    expect((screen.getByText("デプロイする") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("accepts a fractional token-unit amount (e.g. half a token)", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-deploy-arg-initialSupply"), {
      target: { value: "0.5" },
    });
    fireEvent.click(screen.getByText("デプロイする"));
    expect(onSubmit).toHaveBeenCalledWith({
      contractKey: "ChainvizToken",
      constructorArgs: ["500000000000000000"],
    });
  });
});
