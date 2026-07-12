import type { ContractEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ContractPopover } from "./ContractPopover.js";

afterEach(cleanup);

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"a".repeat(40)}`,
    chainType: "ethereum",
    ...overrides,
  };
}

function wrap(entity: ContractEntity, lang: "ja" | "en" = "ja") {
  // PopoverPortal(Issue #245)の必須 prop anchorRef 用の detached 要素。
  // このテストの関心は表示内容であり、実際の画面上の位置は対象外。
  const anchorRef = { current: document.createElement("div") };
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={{}}>
        <ContractPopover anchorRef={anchorRef} entity={entity} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("ContractPopover layer badge (Issue #299)", () => {
  it("shows the C-layer badge in the heading", () => {
    wrap(contract());
    expect(screen.getByTestId("layer-badge-c")).toBeTruthy();
  });
});

describe("ContractPopover", () => {
  it("has a tooltip role for accessibility", () => {
    wrap(contract());
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("shows the known-contract description for a cataloged contract", () => {
    wrap(contract({ name: "ChainvizToken" }));
    expect(
      screen.getByText(
        "チェーンに複製され、全ノードが同じ実行をするプログラムです。特定のサーバーやノードの中では動いていません",
      ),
    ).toBeTruthy();
  });

  it("shows the unknown-contract description for an uncataloged contract", () => {
    wrap(contract({ name: undefined }));
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName.toLowerCase() === "p" &&
          (element.textContent ?? "").includes(
            "chainviz のカタログに載っていないため、関数やイベントの意味（",
          ) &&
          (element.textContent ?? "").includes("ABI"),
      ),
    ).toBeTruthy();
  });

  it("anchors the 'ABI' word in the unknown description with a glossary term", () => {
    wrap(contract({ name: undefined }));
    // GlossaryTerm はキーがなければ role="button" を付けない未登録スタイルに
    // フォールバックするため、ここでは glossary-term のラベル文字列で判定する。
    expect(screen.getByText("ABI")).toBeTruthy();
  });

  it("shows the shortened full address", () => {
    wrap(contract());
    expect(
      screen.getByText(`0x${"a".repeat(10)}…${"a".repeat(6)}`),
    ).toBeTruthy();
  });

  it("shows the deployer field only when deployerAddress is present", () => {
    wrap(contract({ deployerAddress: `0x${"b".repeat(40)}` }));
    expect(screen.getByText("デプロイした人")).toBeTruthy();
  });

  it("omits the deployer field when deployerAddress is absent", () => {
    wrap(contract());
    expect(screen.queryByText("デプロイした人")).toBeNull();
  });

  it("shows the created-by-tx field only when createdByTxHash is present", () => {
    wrap(contract({ createdByTxHash: `0x${"d".repeat(64)}` }));
    expect(screen.getByText("作成 tx")).toBeTruthy();
  });

  it("omits the created-by-tx field when createdByTxHash is absent", () => {
    wrap(contract());
    expect(screen.queryByText("作成 tx")).toBeNull();
  });

  it("shows the token field with symbol and decimals only when token is present", () => {
    wrap(contract({ token: { symbol: "CVT", decimals: 18 } }));
    expect(screen.getByText("CVT / decimals 18")).toBeTruthy();
  });

  it("omits the token field when token is absent", () => {
    wrap(contract());
    expect(screen.queryByText(/decimals/)).toBeNull();
  });

  it("shows the English description when the language is English", () => {
    wrap(contract({ name: "ChainvizToken" }), "en");
    expect(
      screen.getByText(
        "A program replicated on the chain; every node runs the same execution. It does not live on any single server or node.",
      ),
    ).toBeTruthy();
  });

  it("treats an empty-string name as cataloged and shows the known description", () => {
    // カード側と同じ境界: `name === undefined` のみが未知。空文字は既知扱いで
    // 通常説明文を出す（未知向けの ABI 復号不可の説明にはしない）。
    wrap(contract({ name: "" }));
    expect(
      screen.getByText(
        "チェーンに複製され、全ノードが同じ実行をするプログラムです。特定のサーバーやノードの中では動いていません",
      ),
    ).toBeTruthy();
  });

  it("shows the English field labels when the language is English", () => {
    wrap(
      contract({
        deployerAddress: `0x${"b".repeat(40)}`,
        createdByTxHash: `0x${"d".repeat(64)}`,
        token: { symbol: "CVT", decimals: 18 },
      }),
      "en",
    );
    expect(screen.getByText("Deployed by")).toBeTruthy();
    expect(screen.getByText("Created by tx")).toBeTruthy();
    expect(screen.getByText("Token")).toBeTruthy();
  });
});
