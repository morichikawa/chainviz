// SidePanelHost の commsLog ケース（Issue #317）専用のテスト。contractSource
// 側は SidePanelHost.test.tsx にあるため分ける（CLAUDE.mdのテスト分割方針）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { CommsLogEntry } from "../comms-log/commsLogEntry.js";
import { defaultCommsLogFilterState } from "../comms-log/commsLogFilter.js";
import { SidePanelProvider, useSidePanel } from "./SidePanelContext.js";
import { SidePanelHost } from "./SidePanelHost.js";

afterEach(cleanup);

function OpenCommsLogButton() {
  const { open } = useSidePanel();
  return (
    <button type="button" onClick={() => open({ kind: "commsLog" })}>
      open
    </button>
  );
}

function environmentEntry(id: string): CommsLogEntry {
  return {
    id,
    category: "environment",
    timestamp: 1_000,
    actorIds: ["reth-1"],
    subjectId: "reth-1",
    subjectLabel: "chainviz-reth-1",
    change: "nodeAdded",
  };
}

function renderHost({
  visibleEntries = [] as CommsLogEntry[],
  toggleCategory = vi.fn(),
  setNodeFilter = vi.fn(),
} = {}) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <SidePanelProvider>
          <OpenCommsLogButton />
          <SidePanelHost
            contractsByAddress={new Map()}
            commsLog={{
              visibleEntries,
              filters: defaultCommsLogFilterState(),
              toggleCategory,
              setNodeFilter,
            }}
            commsLogNodeOptions={[{ id: "reth-1", label: "chainviz-reth-1" }]}
          />
        </SidePanelProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("SidePanelHost: commsLog", () => {
  it("renders the comms log panel when opened", () => {
    renderHost();
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("comms-log-view")).toBeTruthy();
  });

  it("shows the provided entries", () => {
    renderHost({ visibleEntries: [environmentEntry("e1")] });
    fireEvent.click(screen.getByText("open"));
    expect(screen.getAllByTestId("comms-log-entry")).toHaveLength(1);
  });

  it("shows the empty state when there are no visible entries", () => {
    renderHost();
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("comms-log-empty")).toBeTruthy();
  });

  it("is not affected by the contractSource dangling guard (stays open with no target entity)", () => {
    // commsLog はどのエンティティも指さないため、対象アドレスが無いこと自体は
    // ダングリングと判定されてはならない（SidePanelHost.tsx の dangling は
    // contractSource 限定の判定であることの回帰確認）。
    renderHost();
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
  });

  it("forwards filter interactions to the provided handlers", () => {
    const toggleCategory = vi.fn();
    const setNodeFilter = vi.fn();
    renderHost({ toggleCategory, setNodeFilter });
    fireEvent.click(screen.getByText("open"));

    fireEvent.click(screen.getByTestId("comms-log-filter-tx"));
    expect(toggleCategory).toHaveBeenCalledWith("tx");

    fireEvent.change(screen.getByTestId("comms-log-node-filter"), {
      target: { value: "reth-1" },
    });
    expect(setNodeFilter).toHaveBeenCalledWith("reth-1");
  });
});
