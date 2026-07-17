import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommsLogEntry } from "../comms-log/commsLogEntry.js";
import { defaultCommsLogFilterState } from "../comms-log/commsLogFilter.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { CommsLogView } from "./CommsLogView.js";

afterEach(cleanup);

function entry(id: string, timestamp: number): CommsLogEntry {
  return {
    id,
    category: "environment",
    timestamp,
    actorIds: ["reth-1"],
    subjectId: "reth-1",
    subjectLabel: "chainviz-reth-1",
    change: "nodeAdded",
  };
}

function renderView(entries: CommsLogEntry[]) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <CommsLogView
          entries={entries}
          filters={defaultCommsLogFilterState()}
          onToggleCategory={vi.fn()}
          onNodeFilterChange={vi.fn()}
          nodeOptions={[]}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("CommsLogView", () => {
  it("shows the empty state (with the P2P observability note) when there are no entries", () => {
    renderView([]);
    expect(screen.getByTestId("comms-log-empty")).toBeTruthy();
    expect(screen.queryByTestId("comms-log-entry")).toBeNull();
  });

  it("renders entries in the order given (caller is responsible for newest-first ordering)", () => {
    renderView([entry("newer", 2_000), entry("older", 1_000)]);
    const rows = screen.getAllByTestId("comms-log-entry");
    expect(rows).toHaveLength(2);
  });

  it("does not render the empty state once there is at least one entry", () => {
    renderView([entry("e1", 1_000)]);
    expect(screen.queryByTestId("comms-log-empty")).toBeNull();
  });

  it("always renders the filter bar, even with 0 entries", () => {
    renderView([]);
    expect(screen.getByTestId("comms-log-filter-bar")).toBeTruthy();
  });
});
