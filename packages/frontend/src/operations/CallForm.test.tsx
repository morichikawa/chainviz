import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContractCatalogEntry } from "../chain-profiles/ethereum/operationCatalog.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { CallForm } from "./CallForm.js";
import type { DeployedContractCandidate } from "./deployedContracts.js";
import type { WalletCandidate } from "./walletCandidates.js";

afterEach(cleanup);

const TOKEN_CATALOG: ContractCatalogEntry = {
  catalogKey: "ChainvizToken",
  displayName: { ja: "ChainvizToken", en: "ChainvizToken" },
  description: { ja: "最小のERC20", en: "minimal ERC20" },
  constructorArgs: [],
  functions: [
    {
      signature: "transfer(address,uint256)",
      label: "transfer",
      args: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint" },
      ],
      payable: false,
    },
    {
      signature: "donate()",
      label: "donate",
      args: [],
      payable: true,
    },
  ],
};

const deployedContracts: DeployedContractCandidate[] = [
  {
    address: "0xcccccccccccccccccccccccccccccccccccccc",
    label: "ChainvizToken (0xcccc…cccc)",
    catalog: TOKEN_CATALOG,
  },
];

const walletCandidates: WalletCandidate[] = [
  { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "0xaaaa (Alice)" },
];

function renderForm(
  onSubmit = vi.fn(),
  onSwitchToDeploy = vi.fn(),
  contracts = deployedContracts,
) {
  render(
    <LanguageProvider initialLanguage="ja">
      <CallForm
        deployedContracts={contracts}
        walletCandidates={walletCandidates}
        onSubmit={onSubmit}
        onSwitchToDeploy={onSwitchToDeploy}
      />
    </LanguageProvider>,
  );
  return { onSubmit, onSwitchToDeploy };
}

describe("CallForm (ARCHITECTURE.md §6.5-3)", () => {
  it("shows an empty-state message with a deploy shortcut when there are no callable contracts", () => {
    const { onSwitchToDeploy } = renderForm(vi.fn(), vi.fn(), []);
    expect(
      screen.getByText(
        "呼び出せるコントラクトがまだありません。先に「デプロイ」タブからデプロイしてください",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("operation-call-switch-to-deploy"));
    expect(onSwitchToDeploy).toHaveBeenCalledTimes(1);
  });

  it("defaults to the first function of the first contract and renders its arg fields", () => {
    renderForm();
    expect(screen.getByTestId("operation-call-arg-to")).toBeTruthy();
    expect(screen.getByTestId("operation-call-arg-amount")).toBeTruthy();
  });

  it("submits the contract address, function signature, and args in order", () => {
    const { onSubmit } = renderForm();
    fireEvent.change(screen.getByTestId("operation-call-arg-to"), {
      target: { value: "0xbob" },
    });
    fireEvent.change(screen.getByTestId("operation-call-arg-amount"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByText("実行する"));
    expect(onSubmit).toHaveBeenCalledWith({
      contractAddress: "0xcccccccccccccccccccccccccccccccccccccc",
      functionName: "transfer(address,uint256)",
      args: ["0xbob", "42"],
      amountWei: undefined,
    });
  });

  it("shows an amount field only for a payable function, and converts it to wei on submit", () => {
    const { onSubmit } = renderForm();
    expect(screen.queryByTestId("operation-call-amount")).toBeNull();

    fireEvent.change(screen.getByTestId("operation-call-function"), {
      target: { value: "donate()" },
    });
    expect(screen.getByTestId("operation-call-amount")).toBeTruthy();

    fireEvent.change(screen.getByTestId("operation-call-amount"), {
      target: { value: "0.1" },
    });
    fireEvent.click(screen.getByText("実行する"));
    expect(onSubmit).toHaveBeenCalledWith({
      contractAddress: "0xcccccccccccccccccccccccccccccccccccccc",
      functionName: "donate()",
      args: [],
      amountWei: "100000000000000000",
    });
  });

  it("disables submit and does not call onSubmit when the payable amount is invalid", () => {
    const { onSubmit } = renderForm();
    fireEvent.change(screen.getByTestId("operation-call-function"), {
      target: { value: "donate()" },
    });
    fireEvent.change(screen.getByTestId("operation-call-amount"), {
      target: { value: "abc" },
    });
    const button = screen.getByText("実行する") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses the wallet candidates for an address-type argument's suggestions", () => {
    renderForm();
    const input = screen.getByTestId("operation-call-arg-to") as HTMLInputElement;
    const list = document.getElementById(input.getAttribute("list") ?? "");
    expect(list?.textContent).toContain("0xaaaa (Alice)");
  });

  it("resets the args when switching to a function with a different arg list", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("operation-call-arg-to"), {
      target: { value: "0xbob" },
    });
    fireEvent.change(screen.getByTestId("operation-call-function"), {
      target: { value: "donate()" },
    });
    expect(screen.queryByTestId("operation-call-arg-to")).toBeNull();
  });

  it("disables submit for a contract whose catalog exposes no callable functions (no crash on empty functions)", () => {
    // カタログエントリはあるが functions が空、という将来ありうる構成でも
    // 落ちず、選択できる関数が無いので送信は不可にする。
    const emptyContract: DeployedContractCandidate = {
      address: "0xdddddddddddddddddddddddddddddddddddddddd",
      label: "Empty (0xdddd…dddd)",
      catalog: {
        catalogKey: "Empty",
        displayName: { ja: "Empty", en: "Empty" },
        description: { ja: "関数なし", en: "no functions" },
        constructorArgs: [],
        functions: [],
      },
    };
    const { onSubmit } = renderForm(vi.fn(), vi.fn(), [emptyContract]);
    const button = screen.getByText("実行する") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a no-arg non-payable function with an empty args array and no amount", () => {
    // increment() のような引数なし・非 payable 関数の最小送信パス。
    const counterContract: DeployedContractCandidate = {
      address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      label: "Counter (0xeeee…eeee)",
      catalog: {
        catalogKey: "Counter",
        displayName: { ja: "Counter", en: "Counter" },
        description: { ja: "カウンタ", en: "counter" },
        constructorArgs: [],
        functions: [
          { signature: "increment()", label: "increment", args: [], payable: false },
        ],
      },
    };
    const { onSubmit } = renderForm(vi.fn(), vi.fn(), [counterContract]);
    expect(screen.queryByTestId("operation-call-amount")).toBeNull();
    fireEvent.click(screen.getByText("実行する"));
    expect(onSubmit).toHaveBeenCalledWith({
      contractAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      functionName: "increment()",
      args: [],
      amountWei: undefined,
    });
  });
});
