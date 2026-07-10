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

  it("disables submit and shows an error, without calling onSubmit, for a non-numeric uint constructor arg (Issue #209 bug reproduction)", () => {
    // 実際の不具合報告（"test"/"sss" のような非数値文字列）を再現する。
    // 型解釈（エンコード）自体は引き続き collector 側の ChainAdapter が
    // 行うが（§6.10-2）、明らかに型と矛盾する入力は送信前に弾く。
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-deploy-arg-initialSupply"), {
      target: { value: "test" },
    });
    expect(
      screen.getByTestId("operation-deploy-arg-initialSupply-error"),
    ).toBeTruthy();
    const button = screen.getByText("デプロイする") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables submit for a required constructor arg left blank", () => {
    // 必須引数（uint）を空のまま送信しようとしても、ボタンが無効化され
    // 送信されない。空欄そのものにはエラー文言は出さない（未入力の状態を
    // 「明らかな型違反」として赤字扱いしない、既存の amount 欄と同じ挙動）。
    const onSubmit = renderForm();
    expect(
      screen.queryByTestId("operation-deploy-arg-initialSupply-error"),
    ).toBeNull();
    const button = screen.getByText("デプロイする") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("enables submit once a valid uint value is entered", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-deploy-arg-initialSupply"), {
      target: { value: "1000000000000000000000000" },
    });
    const button = screen.getByText("デプロイする") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledWith({
      contractKey: "ChainvizToken",
      constructorArgs: ["1000000000000000000000000"],
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
