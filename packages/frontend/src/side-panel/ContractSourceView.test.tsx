import type { ContractEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ContractSourceView } from "./ContractSourceView.js";

afterEach(cleanup);

// GlossaryTerm は未登録用語だと data-testid を付けない
// (withTermAnchor.test.tsx と同じ理由)ため、"abi" を登録済みにしておく。
const glossary: Glossary = {
  abi: {
    key: "abi",
    name: { ja: "ABI", en: "ABI" },
    definition: { ja: "説明", en: "Definition" },
    layer: "c",
    relatedTerms: [],
  },
};

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"e".repeat(40)}`,
    chainType: "ethereum",
    ...overrides,
  };
}

function wrap(entity: ContractEntity, lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={glossary}>
        <ContractSourceView contract={entity} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("ContractSourceView", () => {
  it("shows the contract name and shortened address in the header", () => {
    wrap(contract({ name: "ChainvizToken" }));
    expect(screen.getByText("ChainvizToken")).toBeTruthy();
    expect(screen.getByText("0xeeeeee…eeee")).toBeTruthy();
  });

  it("shows 'unknown contract' as the name when name is omitted", () => {
    wrap(contract({ name: undefined }));
    expect(screen.getByText("未知のコントラクト")).toBeTruthy();
  });

  it("shows the unavailable message, with an ABI glossary anchor, when sourceCode is absent", () => {
    wrap(contract({ name: "ChainvizToken" }));
    expect(screen.getByTestId("contract-source-unavailable")).toBeTruthy();
    expect(screen.getByTestId("glossary-term-abi")).toBeTruthy();
    expect(screen.queryByTestId("contract-source-code")).toBeNull();
  });

  it("shows the same unavailable message for an unknown contract (no hiding the button's reason)", () => {
    wrap(contract({ name: undefined }));
    expect(screen.getByTestId("contract-source-unavailable")).toBeTruthy();
  });

  it("renders the source code with line numbers when sourceCode is present", () => {
    const { container } = wrap(
      contract({
        name: "Counter",
        sourceCode: {
          fileName: "Counter.sol",
          language: "solidity",
          code: "uint256 public count;\ncount += 5;",
        },
      }),
    );
    expect(screen.queryByTestId("contract-source-unavailable")).toBeNull();
    const code = screen.getByTestId("contract-source-code");
    expect(code.textContent).toContain("uint256 public count;");
    expect(code.textContent).toContain("count += 5;");
    expect(screen.getByText("Counter.sol")).toBeTruthy();
    // 行番号(1, 2)がそれぞれ出ていること。
    const lineNumbers = Array.from(
      container.querySelectorAll(".contract-source-view__line-number"),
    ).map((el) => el.textContent);
    expect(lineNumbers).toEqual(["1", "2"]);
  });

  it("applies syntax-highlight classes to keywords/types in solidity source", () => {
    const { container } = wrap(
      contract({
        sourceCode: {
          fileName: "Counter.sol",
          language: "solidity",
          code: "uint256 public count;",
        },
      }),
    );
    expect(
      container.querySelector(".contract-source-view__token--type"),
    ).not.toBeNull();
    expect(
      container.querySelector(".contract-source-view__token--keyword"),
    ).not.toBeNull();
  });

  it("renders unknown-language source as undecorated plain text (no token classes)", () => {
    const { container } = wrap(
      contract({
        sourceCode: { fileName: "Example.vy", language: "vyper", code: "x = 1" },
      }),
    );
    expect(container.querySelector(".contract-source-view__token--type")).toBeNull();
    expect(
      container.querySelector(".contract-source-view__token--keyword"),
    ).toBeNull();
    expect(screen.getByTestId("contract-source-code").textContent).toContain(
      "x = 1",
    );
  });

  it("renders the source block (not the unavailable message) when sourceCode is present but code is empty", () => {
    // sourceCode があるかどうかで分岐するため、code が空文字でも「ソース有り」
    // 扱いになる（「ソース無し」の説明文には倒れない）。空ソースは 1 行分の
    // 空行として表示され、ファイル名は出る。境界（code: ""）の表示を固定する。
    const { container } = wrap(
      contract({
        name: "Empty",
        sourceCode: { fileName: "Empty.sol", language: "solidity", code: "" },
      }),
    );
    expect(screen.queryByTestId("contract-source-unavailable")).toBeNull();
    expect(screen.getByTestId("contract-source-code")).toBeTruthy();
    expect(screen.getByText("Empty.sol")).toBeTruthy();
    const lineNumbers = Array.from(
      container.querySelectorAll(".contract-source-view__line-number"),
    ).map((el) => el.textContent);
    expect(lineNumbers).toEqual(["1"]);
  });

  it("renders the header labels in English when the language is English", () => {
    wrap(contract({ name: undefined }), "en");
    expect(screen.getByText("Unknown contract")).toBeTruthy();
  });
});
