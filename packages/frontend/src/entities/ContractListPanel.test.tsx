import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { ContractListEntry } from "./contractList.js";
import { ContractListPanel } from "./ContractListPanel.js";

afterEach(cleanup);

const glossary: Glossary = {
  contract: {
    key: "contract",
    name: { ja: "コントラクト", en: "Contract" },
    definition: { ja: "定義", en: "definition" },
    layer: "c-transaction",
    relatedTerms: [],
  },
};

function wrap(entries: ContractListEntry[], onSelect: (nodeId: string) => void) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={glossary}>
        <ContractListPanel entries={entries} onSelect={onSelect} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("ContractListPanel", () => {
  it("renders nothing when there are no entries", () => {
    const { container } = wrap([], () => {});
    expect(container.querySelector(".contract-list-panel")).toBeNull();
  });

  it("shows the header with a count of entries", () => {
    wrap(
      [{ nodeId: "0xaaa", status: "deployed", name: "ChainvizToken", address: "0xaaa" }],
      () => {},
    );
    const panel = screen.getByTestId("contract-list-panel");
    expect(panel.textContent).toContain("コントラクト");
    expect(panel.textContent).toContain("1");
  });

  it("shows the shortened address and name for a deployed, cataloged contract", () => {
    const address = `0x${"a".repeat(40)}`;
    wrap([{ nodeId: address, status: "deployed", name: "ChainvizToken", address }], () => {});
    const row = screen.getByTestId(`contract-list-row-${address}`);
    expect(row.textContent).toContain("ChainvizToken");
    expect(row.textContent).toContain("0xaaaaaa…aaaa");
  });

  it("falls back to 'unknown contract' for an uncataloged contract", () => {
    const address = `0x${"b".repeat(40)}`;
    wrap([{ nodeId: address, status: "deployed", name: undefined, address }], () => {});
    const row = screen.getByTestId(`contract-list-row-${address}`);
    expect(row.textContent).toContain("未知のコントラクト");
  });

  it("appends the token symbol when present", () => {
    const address = `0x${"c".repeat(40)}`;
    wrap(
      [{ nodeId: address, status: "deployed", name: "ChainvizToken", address, tokenSymbol: "CVZ" }],
      () => {},
    );
    const row = screen.getByTestId(`contract-list-row-${address}`);
    expect(row.textContent).toContain("CVZ");
  });

  it("shows a deploying row with the ghost's label", () => {
    wrap([{ nodeId: "ghost-cmd-1", status: "deploying", name: "Counter" }], () => {});
    const row = screen.getByTestId("contract-list-row-ghost-cmd-1");
    expect(row.textContent).toContain("デプロイ中");
    expect(row.textContent).toContain("Counter");
  });

  it("calls onSelect with the node id when a row is clicked", () => {
    const onSelect = vi.fn();
    const address = `0x${"d".repeat(40)}`;
    wrap([{ nodeId: address, status: "deployed", name: "Counter", address }], onSelect);
    fireEvent.click(screen.getByTestId(`contract-list-row-${address}`));
    expect(onSelect).toHaveBeenCalledWith(address);
  });

  it("calls onSelect with the ghost id when a deploying row is clicked", () => {
    const onSelect = vi.fn();
    wrap([{ nodeId: "ghost-cmd-2", status: "deploying", name: "Counter" }], onSelect);
    fireEvent.click(screen.getByTestId("contract-list-row-ghost-cmd-2"));
    expect(onSelect).toHaveBeenCalledWith("ghost-cmd-2");
  });

  it("renders one row per entry, preserving the given order", () => {
    wrap(
      [
        { nodeId: "0x1", status: "deployed", name: "First", address: "0x1" },
        { nodeId: "0x2", status: "deployed", name: "Second", address: "0x2" },
      ],
      () => {},
    );
    const rows = screen.getAllByTestId(/^contract-list-row-/);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("First");
    expect(rows[1]?.textContent).toContain("Second");
  });

  it("localizes to English", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <GlossaryProvider glossary={glossary}>
          <ContractListPanel
            entries={[{ nodeId: "ghost-cmd-1", status: "deploying", name: "Counter" }]}
            onSelect={() => {}}
          />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    const panel = screen.getByTestId("contract-list-panel");
    expect(panel.textContent).toContain("Contract");
    expect(panel.textContent).toContain("Deploying");
  });
});
