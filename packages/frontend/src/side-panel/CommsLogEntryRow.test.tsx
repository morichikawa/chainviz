import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CommsLogEntry } from "../comms-log/commsLogEntry.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { CommsLogEntryRow } from "./CommsLogEntryRow.js";

afterEach(cleanup);

function renderEntry(entry: CommsLogEntry) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <ul>
          <CommsLogEntryRow entry={entry} />
        </ul>
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("CommsLogEntryRow", () => {
  it("renders the category, subject and body for an operation entry", () => {
    renderEntry({
      id: "e1",
      category: "operation",
      timestamp: new Date(2024, 0, 1, 10, 20, 30).getTime(),
      actorIds: ["wb-1", "reth-1"],
      workbenchId: "wb-1",
      workbenchLabel: "Alice",
      nodeId: "reth-1",
      nodeLabel: "chainviz-reth-1",
      method: "eth_sendRawTransaction",
    });

    const row = screen.getByTestId("comms-log-entry");
    expect(row.getAttribute("data-category")).toBe("operation");
    expect(row.textContent).toContain("10:20:30");
    expect(row.textContent).toContain("Alice → chainviz-reth-1");
    expect(row.textContent).toContain("eth_sendRawTransaction");
  });

  it("colors the tx chip according to status (pending)", () => {
    renderEntry({
      id: "e2",
      category: "tx",
      timestamp: 1_000,
      actorIds: [],
      hash: "0xabc",
      status: "pending",
    });
    const chip = screen.getByTestId("comms-log-entry-chip");
    expect(chip.className).toContain("comms-log-entry__chip--tx-pending");
  });

  it("colors the peer chip using the network-specific color (inline style), not a fixed category class", () => {
    renderEntry({
      id: "e3",
      category: "peer",
      timestamp: 1_000,
      actorIds: ["a", "b"],
      fromNodeId: "a",
      fromLabel: "a",
      toNodeId: "b",
      toLabel: "b",
      networkId: "1337",
      change: "connected",
    });
    const chip = screen.getByTestId("comms-log-entry-chip");
    expect(chip.className).not.toMatch(/comms-log-entry__chip--peer/);
    expect(chip.getAttribute("style")).toBeTruthy();
  });

  it("wraps operation/internal body content in a <code> element", () => {
    renderEntry({
      id: "e4",
      category: "operation",
      timestamp: 1_000,
      actorIds: ["wb-1", "reth-1"],
      workbenchId: "wb-1",
      workbenchLabel: "Alice",
      nodeId: "reth-1",
      nodeLabel: "chainviz-reth-1",
      method: "eth_call",
    });
    expect(document.querySelector(".comms-log-entry__code")).toBeTruthy();
  });

  it("does not wrap block/tx/peer/environment body content in <code>", () => {
    renderEntry({
      id: "e5",
      category: "environment",
      timestamp: 1_000,
      actorIds: ["reth-1"],
      subjectId: "reth-1",
      subjectLabel: "chainviz-reth-1",
      change: "nodeAdded",
    });
    expect(document.querySelector(".comms-log-entry__code")).toBeNull();
  });
});
