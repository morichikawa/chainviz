import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContractCatalogEntry } from "../chain-profiles/ethereum/operationCatalog.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { CallForm } from "./CallForm.js";
import type { DeployedContractCandidate } from "./deployedContracts.js";

afterEach(cleanup);

/**
 * 呼び出しタブでの `unit: "token"` 関数引数（Issue #219: トークン単位入力
 * ＋decimals換算）のテスト。ABI型チェック自体（#209）や通常の呼び出し
 * 挙動は `CallForm.test.tsx` が担う。
 */
const TOKEN_CATALOG: ContractCatalogEntry = {
  catalogKey: "ChainvizToken",
  displayName: { ja: "ChainvizToken", en: "ChainvizToken" },
  description: { ja: "最小のERC20", en: "minimal ERC20" },
  token: { symbol: "CVZ", decimals: 18 },
  constructorArgs: [],
  functions: [
    {
      signature: "transfer(address,uint256)",
      label: "transfer",
      description: { ja: "amountをtoへ送ります", en: "Sends amount to `to`." },
      args: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint", unit: "token" },
      ],
      payable: false,
    },
  ],
};

const deployedContracts: DeployedContractCandidate[] = [
  {
    address: "0xcccccccccccccccccccccccccccccccccccccc",
    label: "ChainvizToken (0xcccc…cccc)",
    catalog: TOKEN_CATALOG,
    token: { symbol: "CVZ", decimals: 18 },
  },
];

function renderForm(onSubmit = vi.fn()) {
  render(
    <LanguageProvider initialLanguage="ja">
      <CallForm
        deployedContracts={deployedContracts}
        walletCandidates={[]}
        onSubmit={onSubmit}
        onSwitchToDeploy={vi.fn()}
      />
    </LanguageProvider>,
  );
  return onSubmit;
}

describe("CallForm with a token-unit function arg (Issue #219)", () => {
  it("shows the symbol suffix on the token-unit arg label", () => {
    renderForm();
    expect(screen.getByText("amount（CVZ単位）")).toBeTruthy();
  });

  it("converts a decimal token-unit amount to the minimal unit on submit", () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-call-arg-to"), {
      target: { value: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    });
    fireEvent.change(screen.getByTestId("operation-call-arg-amount"), {
      target: { value: "2.5" },
    });
    fireEvent.click(screen.getByText("実行する"));
    expect(onSubmit).toHaveBeenCalledWith({
      contractAddress: "0xcccccccccccccccccccccccccccccccccccccc",
      functionName: "transfer(address,uint256)",
      args: [
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "2500000000000000000",
      ],
      amountWei: undefined,
    });
  });

  it("disables submit for a token-unit amount whose fractional digits exceed the token's decimals", () => {
    renderForm();
    fireEvent.change(screen.getByTestId("operation-call-arg-to"), {
      target: { value: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    });
    fireEvent.change(screen.getByTestId("operation-call-arg-amount"), {
      target: { value: "1.0000000000000000001" },
    });
    expect(screen.getByTestId("operation-call-arg-amount-error")).toBeTruthy();
    expect((screen.getByText("実行する") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not treat a valid whole-number token amount (e.g. what used to be misread as raw wei) as invalid", () => {
    // #219 の再現ケース: "1000" は1000トークン（=1000 * 10^18の最小単位）を
    // 意味するようになり、そのまま生の最小単位として弾かれることはない。
    const onSubmit = renderForm();
    fireEvent.change(screen.getByTestId("operation-call-arg-to"), {
      target: { value: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    });
    fireEvent.change(screen.getByTestId("operation-call-arg-amount"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByText("実行する"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "1000000000000000000000",
        ],
      }),
    );
  });

  it("switches label and validation when moving from a token-unit function to a plain-uint function on the same contract", () => {
    // 同一コントラクト内で unit:"token" の関数（transfer.amount）から unit なし
    // の関数（incrementBy.amount）へ切り替えたとき、ラベルのトークン単位
    // サフィックスとバリデーション（小数許容→整数のみ）が正しく入れ替わる
    // ことを確認する。切り替え時に args がリセットされる副作用も併せて見る。
    const mixedCatalog: ContractCatalogEntry = {
      catalogKey: "ChainvizToken",
      displayName: { ja: "ChainvizToken", en: "ChainvizToken" },
      description: { ja: "最小のERC20", en: "minimal ERC20" },
      token: { symbol: "CVZ", decimals: 18 },
      constructorArgs: [],
      functions: [
        {
          signature: "transfer(address,uint256)",
          label: "transfer",
          description: { ja: "amountをtoへ送ります", en: "Sends amount to `to`." },
          args: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint", unit: "token" },
          ],
          payable: false,
        },
        {
          // トークンを持つコントラクトでも unit を付けない生の整数引数を
          // 持つ関数はありうる（Counter.incrementBy を模した非トークン引数）。
          signature: "incrementBy(uint256)",
          label: "incrementBy",
          description: { ja: "amountだけ増やします", en: "Increases by amount." },
          args: [{ name: "amount", type: "uint" }],
          payable: false,
        },
      ],
    };
    render(
      <LanguageProvider initialLanguage="ja">
        <CallForm
          deployedContracts={[
            {
              address: "0xcccccccccccccccccccccccccccccccccccccc",
              label: "ChainvizToken (0xcccc…cccc)",
              catalog: mixedCatalog,
              token: { symbol: "CVZ", decimals: 18 },
            },
          ]}
          walletCandidates={[]}
          onSubmit={vi.fn()}
          onSwitchToDeploy={vi.fn()}
        />
      </LanguageProvider>,
    );

    // transfer（トークン単位）: 単位サフィックス付きラベル、小数 1.5 は有効。
    expect(screen.getByText("amount（CVZ単位）")).toBeTruthy();
    fireEvent.change(screen.getByTestId("operation-call-arg-amount"), {
      target: { value: "1.5" },
    });
    expect(screen.queryByTestId("operation-call-arg-amount-error")).toBeNull();

    // incrementBy（生の整数）へ切り替え: 単位サフィックスが消え、直前に入れた
    // 小数 1.5 はリセットされた上で、改めて 1.5 を入れると uint エラーになる。
    fireEvent.change(screen.getByTestId("operation-call-function"), {
      target: { value: "incrementBy(uint256)" },
    });
    expect(screen.queryByText("amount（CVZ単位）")).toBeNull();
    expect(screen.getByText("amount")).toBeTruthy();
    fireEvent.change(screen.getByTestId("operation-call-arg-amount"), {
      target: { value: "1.5" },
    });
    const uintError = screen.getByTestId("operation-call-arg-amount-error");
    expect(uintError.textContent).toBe("0以上の整数を入力してください（例: 1000）");
  });

  it("does not convert a plain-uint amount to the minimal unit on submit (only token-unit args are scaled)", () => {
    // トークンを持つコントラクトでも、unit を付けていない引数は生の整数値の
    // まま送信される（decimals 換算は unit:"token" の引数だけに掛かる）。
    const mixedCatalog: ContractCatalogEntry = {
      catalogKey: "ChainvizToken",
      displayName: { ja: "ChainvizToken", en: "ChainvizToken" },
      description: { ja: "最小のERC20", en: "minimal ERC20" },
      token: { symbol: "CVZ", decimals: 18 },
      constructorArgs: [],
      functions: [
        {
          signature: "incrementBy(uint256)",
          label: "incrementBy",
          description: { ja: "amountだけ増やします", en: "Increases by amount." },
          args: [{ name: "amount", type: "uint" }],
          payable: false,
        },
      ],
    };
    const onSubmit = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <CallForm
          deployedContracts={[
            {
              address: "0xcccccccccccccccccccccccccccccccccccccc",
              label: "ChainvizToken (0xcccc…cccc)",
              catalog: mixedCatalog,
              token: { symbol: "CVZ", decimals: 18 },
            },
          ]}
          walletCandidates={[]}
          onSubmit={onSubmit}
          onSwitchToDeploy={vi.fn()}
        />
      </LanguageProvider>,
    );
    fireEvent.change(screen.getByTestId("operation-call-arg-amount"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByText("実行する"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["1000"] }),
    );
  });

  it("disables submit for a token-unit arg when the contract has no resolvable token metadata", () => {
    const contractsWithoutToken: DeployedContractCandidate[] = [
      {
        address: "0xdddddddddddddddddddddddddddddddddddddddd",
        label: "ChainvizToken (0xdddd…dddd)",
        catalog: TOKEN_CATALOG,
        token: undefined,
      },
    ];
    const onSubmit = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <CallForm
          deployedContracts={contractsWithoutToken}
          walletCandidates={[]}
          onSubmit={onSubmit}
          onSwitchToDeploy={vi.fn()}
        />
      </LanguageProvider>,
    );
    fireEvent.change(screen.getByTestId("operation-call-arg-to"), {
      target: { value: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    });
    fireEvent.change(screen.getByTestId("operation-call-arg-amount"), {
      target: { value: "1" },
    });
    expect((screen.getByText("実行する") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("実行する"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
