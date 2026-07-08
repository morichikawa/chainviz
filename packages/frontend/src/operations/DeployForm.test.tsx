import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContractCatalogEntry } from "../chain-profiles/ethereum/operationCatalog.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { DeployForm } from "./DeployForm.js";

afterEach(cleanup);

const TOKEN: ContractCatalogEntry = {
  catalogKey: "ChainvizToken",
  displayName: { ja: "ChainvizToken", en: "ChainvizToken" },
  description: { ja: "最小のERC20", en: "minimal ERC20" },
  constructorArgs: [{ name: "initialSupply", type: "uint" }],
  functions: [],
};

const COUNTER: ContractCatalogEntry = {
  catalogKey: "Counter",
  displayName: { ja: "Counter", en: "Counter" },
  description: { ja: "一番単純な学習用コントラクト", en: "simplest contract" },
  constructorArgs: [],
  functions: [],
};

const catalog = [TOKEN, COUNTER];

function renderForm(onSubmit = vi.fn()) {
  render(
    <LanguageProvider initialLanguage="ja">
      <DeployForm catalog={catalog} onSubmit={onSubmit} />
    </LanguageProvider>,
  );
  return onSubmit;
}

describe("DeployForm (ARCHITECTURE.md §6.5-2)", () => {
  it("defaults to the first catalog entry and shows its constructor arg field", () => {
    renderForm();
    expect(screen.getByTestId("operation-deploy-arg-initialSupply")).toBeTruthy();
  });

  it("submits the selected contractKey with the entered constructor args", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-deploy-arg-initialSupply"), {
      target: { value: "1000000000000000000000000" },
    });
    fireEvent.click(screen.getByText("デプロイする"));
    expect(onSubmit).toHaveBeenCalledWith({
      contractKey: "ChainvizToken",
      constructorArgs: ["1000000000000000000000000"],
    });
  });

  it("switches to Counter (no constructor args) and submits an empty args array", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-deploy-contract"), {
      target: { value: "Counter" },
    });
    expect(
      screen.queryByTestId("operation-deploy-arg-initialSupply"),
    ).toBeNull();
    fireEvent.click(screen.getByText("デプロイする"));
    expect(onSubmit).toHaveBeenCalledWith({
      contractKey: "Counter",
      constructorArgs: [],
    });
  });

  it("submits raw constructor arg strings without client-side type validation (type interpretation is the collector's job, §6.10-2)", () => {
    // フォームは引数の型を検証しない（ABI 型情報を持たない設計）。数値が
    // 期待される initialSupply に非数値を入れても、そのまま文字列で collector
    // へ渡す（型不一致の判定・エラーは collector 側 ChainAdapter が行う）。
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-deploy-arg-initialSupply"), {
      target: { value: "not-a-number" },
    });
    fireEvent.click(screen.getByText("デプロイする"));
    expect(onSubmit).toHaveBeenCalledWith({
      contractKey: "ChainvizToken",
      constructorArgs: ["not-a-number"],
    });
  });

  it("submits an empty string for a required constructor arg left blank (no required-arg guard on the client)", () => {
    // 必須引数を空のまま送信しても、フロントは阻止しない（空文字のまま渡し、
    // 欠落・不正は collector が弾く設計）。ボタンは selected があれば有効。
    const onSubmit = renderForm();
    fireEvent.click(screen.getByText("デプロイする"));
    expect(onSubmit).toHaveBeenCalledWith({
      contractKey: "ChainvizToken",
      constructorArgs: [""],
    });
  });

  it("clears the previous contract's arg values when switching selection", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("operation-deploy-arg-initialSupply"), {
      target: { value: "123" },
    });
    fireEvent.change(screen.getByTestId("operation-deploy-contract"), {
      target: { value: "Counter" },
    });
    fireEvent.change(screen.getByTestId("operation-deploy-contract"), {
      target: { value: "ChainvizToken" },
    });
    const input = screen.getByTestId(
      "operation-deploy-arg-initialSupply",
    ) as HTMLInputElement;
    expect(input.value).toBe("");
  });
});
