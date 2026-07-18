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
      [{ nodeId: address, status: "deployed", name: "ChainvizToken", address, tokenSymbol: "CVZDEMO" }],
      () => {},
    );
    const row = screen.getByTestId(`contract-list-row-${address}`);
    expect(row.textContent).toContain("CVZDEMO");
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

  it("renders deployed and deploying rows together, keeping the given order", () => {
    wrap(
      [
        { nodeId: "ghost-1", status: "deploying", name: "Counter" },
        { nodeId: "0xaaa", status: "deployed", name: "ChainvizToken", address: "0xaaa" },
      ],
      () => {},
    );
    const rows = screen.getAllByTestId(/^contract-list-row-/);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("デプロイ中");
    expect(rows[1]?.textContent).toContain("ChainvizToken");
    // 件数バッジは deployed/deploying を合わせた総数。
    expect(screen.getByTestId("contract-list-panel").textContent).toContain("2");
  });

  it("renders a deploying row without crashing when the name is undefined", () => {
    wrap([{ nodeId: "ghost-x", status: "deploying", name: undefined }], () => {});
    const row = screen.getByTestId("contract-list-row-ghost-x");
    expect(row.textContent).toContain("デプロイ中");
  });

  it("renders a deployed row with an empty shortened address when address is missing", () => {
    // deployed 行は本来 address を持つが、欠落しても shortHex("") = "" で
    // 落ちずに描画する（防御的挙動を固定）。
    wrap([{ nodeId: "n1", status: "deployed", name: "Counter", address: undefined }], () => {});
    const row = screen.getByTestId("contract-list-row-n1");
    expect(row.textContent).toContain("Counter");
  });

  it("shows a count that matches the number of rows for many entries", () => {
    const entries: ContractListEntry[] = Array.from({ length: 12 }, (_, i) => ({
      nodeId: `0x${i}`,
      status: "deployed" as const,
      name: `C${i}`,
      address: `0x${i}`,
    }));
    wrap(entries, () => {});
    expect(screen.getAllByTestId(/^contract-list-row-/)).toHaveLength(12);
    expect(screen.getByTestId("contract-list-panel").textContent).toContain("12");
  });

  it("fires onSelect for whichever row is clicked even if the caller must guard a stale id", () => {
    // パネルは onSelect を呼ぶだけの薄い層。対象ノードが React Flow 上に
    // 既に無い場合の防御（if (!node) return）は Canvas 側の責務であり、
    // パネルは id を渡す責務のみを持つ（関心の分離を固定する）。
    const onSelect = vi.fn();
    wrap(
      [
        { nodeId: "0xaaa", status: "deployed", name: "A", address: "0xaaa" },
        { nodeId: "0xbbb", status: "deployed", name: "B", address: "0xbbb" },
      ],
      onSelect,
    );
    fireEvent.click(screen.getByTestId("contract-list-row-0xbbb"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("0xbbb");
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
