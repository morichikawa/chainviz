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

  it("renders a durationMs of 0 with the outcome icon and a matching aria-label", () => {
    renderEntry(operationEntry({ outcome: "error", durationMs: 0 }));
    const outcome = screen.getByTestId("comms-log-entry-outcome");
    expect(outcome.textContent).toBe(" · ✕ 0ms");
    expect(outcome.getAttribute("aria-label")).toBe("失敗（0ms）");
  });

  it("renders a duration-only 0ms as plain uncolored text (no outcome span)", () => {
    renderEntry(operationEntry({ durationMs: 0 }));
    expect(screen.queryByTestId("comms-log-entry-outcome")).toBeNull();
    expect(document.querySelector(".comms-log-entry__code")?.textContent).toBe("eth_call · 0ms");
  });

  it("always attaches a non-empty aria-label whenever an outcome span is rendered", () => {
    // aria-label のモレ検出: tone を持つ suffix（=outcome span）は必ず
    // 言語化テキストを伴うこと。子テキストは aria-label があると読まれない
    // ため、ラベル欠落は成否情報の欠落に直結する。
    for (const entry of [
      operationEntry({ outcome: "ok" }),
      operationEntry({ outcome: "error" }),
      operationEntry({ outcome: "ok", durationMs: 0 }),
      operationEntry({ outcome: "error", durationMs: 42 }),
    ]) {
      renderEntry(entry);
      const outcome = screen.getByTestId("comms-log-entry-outcome");
      const label = outcome.getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(label?.length).toBeGreaterThan(0);
      cleanup();
    }
  });
});
