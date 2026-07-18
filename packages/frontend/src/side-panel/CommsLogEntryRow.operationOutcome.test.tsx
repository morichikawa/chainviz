// 操作（RPC）エントリの成否・所要時間表示（Issue #352）。
// `CommsLogEntryRow.test.tsx` の基本描画テストとは別に、色分け・aria-label・
// outcome/durationMsの欠落パターンを固定する回帰テストとして分離する
// （CLAUDE.md のテスト分割方針）。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CommsLogOperationEntry } from "../comms-log/commsLogEntry.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { CommsLogEntryRow } from "./CommsLogEntryRow.js";

afterEach(cleanup);

function operationEntry(
  overrides: Partial<Pick<CommsLogOperationEntry, "outcome" | "durationMs">>,
): CommsLogOperationEntry {
  return {
    id: "op-1",
    category: "operation",
    timestamp: 1_000,
    actorIds: ["wb-1", "reth-1"],
    workbenchId: "wb-1",
    workbenchLabel: "Alice",
    nodeId: "reth-1",
    nodeLabel: "chainviz-reth-1",
    method: "eth_call",
    ...overrides,
  };
}

function renderEntry(entry: CommsLogOperationEntry) {
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

describe("CommsLogEntryRow: operation outcome/duration display", () => {
  it("shows only the method name when neither outcome nor durationMs is observed", () => {
    renderEntry(operationEntry({}));
    expect(screen.queryByTestId("comms-log-entry-outcome")).toBeNull();
    expect(document.querySelector(".comms-log-entry__code")?.textContent).toBe("eth_call");
  });

  it("shows the duration as plain (uncolored) text when outcome is not observed", () => {
    renderEntry(operationEntry({ durationMs: 12 }));
    expect(screen.queryByTestId("comms-log-entry-outcome")).toBeNull();
    expect(document.querySelector(".comms-log-entry__code")?.textContent).toBe("eth_call · 12ms");
  });

  it("colors the outcome span with the success color and labels it for screen readers (ok)", () => {
    renderEntry(operationEntry({ outcome: "ok", durationMs: 12 }));
    const outcome = screen.getByTestId("comms-log-entry-outcome");
    expect(outcome.className).toContain("comms-log-entry__outcome--ok");
    expect(outcome.getAttribute("aria-label")).toBe("成功（12ms）");
    expect(outcome.textContent).toBe(" · ✓ 12ms");
  });

  it("colors the outcome span with the failure color and labels it for screen readers (error)", () => {
    renderEntry(operationEntry({ outcome: "error", durationMs: 8 }));
    const outcome = screen.getByTestId("comms-log-entry-outcome");
    expect(outcome.className).toContain("comms-log-entry__outcome--error");
    expect(outcome.getAttribute("aria-label")).toBe("失敗（8ms）");
  });

  it("still colors/labels the outcome when durationMs is not observed", () => {
    renderEntry(operationEntry({ outcome: "ok" }));
    const outcome = screen.getByTestId("comms-log-entry-outcome");
    expect(outcome.className).toContain("comms-log-entry__outcome--ok");
    expect(outcome.getAttribute("aria-label")).toBe("成功");
    expect(outcome.textContent).toBe(" · ✓");
  });
});
