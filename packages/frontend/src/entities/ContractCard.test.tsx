import type { ContractEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ContractCard } from "./ContractCard.js";
import type { ContractFlowNode } from "./contractNode.js";

afterEach(cleanup);

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"c".repeat(40)}`,
    chainType: "ethereum",
    ...overrides,
  };
}

function renderCard(data: ContractFlowNode["data"], lang: "ja" | "en" = "ja") {
  const props = { data } as unknown as Parameters<typeof ContractCard>[0];
  return render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage={lang}>
        <GlossaryProvider glossary={{}}>
          <ContractCard {...props} />
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

function data(
  overrides: Partial<ContractFlowNode["data"]> = {},
): ContractFlowNode["data"] {
  return {
    entity: contract(),
    ...overrides,
  };
}

describe("ContractCard", () => {
  it("shows the contract name and shortened address", () => {
    renderCard(data({ entity: contract({ name: "ChainvizToken" }) }));
    expect(screen.getByText("ChainvizToken")).toBeTruthy();
    expect(screen.getByText("0xcccccc…cccc")).toBeTruthy();
  });

  it("shows 'unknown contract' as the name when name is omitted", () => {
    renderCard(data({ entity: contract({ name: undefined }) }));
    expect(screen.getByText("未知のコントラクト")).toBeTruthy();
  });

  it("shows the 'runs on every node' pill regardless of catalog status", () => {
    renderCard(data({ entity: contract({ name: "ChainvizToken" }) }));
    expect(
      screen.getByTestId(`contract-card-everynode-${contract().address}`),
    ).toBeTruthy();
  });

  it("shows the 'not in catalog' pill only for uncataloged contracts", () => {
    renderCard(data({ entity: contract({ name: undefined }) }));
    expect(
      screen.getByTestId(`contract-card-uncataloged-${contract().address}`),
    ).toBeTruthy();
  });

  it("does not show the 'not in catalog' pill for cataloged contracts", () => {
    renderCard(data({ entity: contract({ name: "ChainvizToken" }) }));
    expect(
      screen.queryByTestId(`contract-card-uncataloged-${contract().address}`),
    ).toBeNull();
  });

  it("applies the dashed/unknown card class only for uncataloged contracts", () => {
    const { container } = renderCard(
      data({ entity: contract({ name: undefined }) }),
    );
    expect(
      container.querySelector(".infra-card--contract-unknown"),
    ).not.toBeNull();
  });

  it("does not apply the unknown card class for cataloged contracts", () => {
    const { container } = renderCard(
      data({ entity: contract({ name: "ChainvizToken" }) }),
    );
    expect(container.querySelector(".infra-card--contract-unknown")).toBeNull();
  });

  it("shows the token symbol in the subtitle when the contract manages a token", () => {
    renderCard(
      data({
        entity: contract({
          name: "ChainvizToken",
          token: { symbol: "CVT", decimals: 18 },
        }),
      }),
    );
    expect(screen.getByText(/CVT/)).toBeTruthy();
  });

  it("omits the token subtitle segment when the contract has no token", () => {
    renderCard(data({ entity: contract({ name: "Counter" }) }));
    expect(screen.queryByText(/decimals/)).toBeNull();
  });

  it("does not show a remove button (chain-side state cannot be deleted, Issue #103)", () => {
    renderCard(data());
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
  });

  it("applies the new-arrival highlight class when isNew is true", () => {
    const { container } = renderCard(data({ isNew: true }));
    expect(container.querySelector(".infra-card--new")).not.toBeNull();
  });

  it("does not apply the new-arrival highlight class when isNew is false/omitted", () => {
    const { container } = renderCard(data());
    expect(container.querySelector(".infra-card--new")).toBeNull();
  });

  it("treats an empty-string name as cataloged (name === undefined is the only uncataloged trigger)", () => {
    // カタログ照合の境界は `name === undefined` の一点。空文字 name は「既知」
    // 扱いになり、破線化も「カタログ外」ピルも出さず、名前欄は空のまま出す。
    // （collector 側が空文字 name を送らない前提。送ってきた場合の現挙動を固定）
    const { container } = renderCard(data({ entity: contract({ name: "" }) }));
    expect(container.querySelector(".infra-card--contract-unknown")).toBeNull();
    expect(
      screen.queryByTestId(`contract-card-uncataloged-${contract().address}`),
    ).toBeNull();
    const nameEl = container.querySelector(".infra-card__name");
    expect(nameEl?.textContent).toBe("");
  });

  it("shows the token symbol even for an uncataloged contract that manages a token", () => {
    // name 省略（未知）でも token があれば副題にシンボルを出す。型上あり得る
    // 組み合わせ（カタログ外だがトークンメタは観測できた）を確認する。
    renderCard(
      data({
        entity: contract({
          name: undefined,
          token: { symbol: "CVT", decimals: 18 },
        }),
      }),
    );
    expect(
      screen.getByTestId(`contract-card-uncataloged-${contract().address}`),
    ).toBeTruthy();
    expect(screen.getByText(/CVT/)).toBeTruthy();
  });

  it("renders the card labels in English when the language is English", () => {
    renderCard(data({ entity: contract({ name: undefined }) }), "en");
    expect(screen.getByText("Contract")).toBeTruthy();
    expect(screen.getByText("Unknown contract")).toBeTruthy();
    expect(screen.getByText("Runs on every node")).toBeTruthy();
    expect(screen.getByText("Not in catalog")).toBeTruthy();
  });

  it("shows the popover on hover", () => {
    renderCard(data({ entity: contract({ name: "ChainvizToken" }) }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    const card = screen.getByTestId(`contract-card-${contract().address}`);
    fireEvent.mouseEnter(card);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.mouseLeave(card);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
