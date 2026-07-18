// 操作（RPC）エントリの成否・所要時間表示（Issue #352。設計メモ §3.4）。
// `commsLogText.test.ts` の operation カテゴリ基本ケース（method のみ）とは
// 別に、`outcome`/`durationMs` の4通りの組み合わせを固定する回帰テストとして
// 分離する（CLAUDE.md のテスト分割方針）。
import { describe, expect, it } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { Language, MessageKey } from "../i18n/messages.js";
import type { CommsLogOperationEntry } from "./commsLogEntry.js";
import { describeCommsLogEntry } from "./commsLogText.js";

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
    method: "eth_sendRawTransaction",
    ...overrides,
  };
}

describe("describeCommsLogEntry: operation outcome/duration suffix", () => {
  it("omits operationSuffix when neither outcome nor durationMs is observed (unchanged body)", () => {
    const text = describeCommsLogEntry(operationEntry({}), (key: MessageKey) => translate(key, "en"));
    expect(text.body).toBe("eth_sendRawTransaction");
    expect(text.operationSuffix).toBeUndefined();
  });

  it("shows duration-only text matching commsLog.internal.latency's format, with no tone/ariaLabel", () => {
    const text = describeCommsLogEntry(
      operationEntry({ durationMs: 12 }),
      (key: MessageKey) => translate(key, "en"),
    );
    expect(text.operationSuffix).toEqual({ text: " · 12ms" });
  });

  it("shows an ok icon with tone/ariaLabel when outcome is observed without durationMs", () => {
    const text = describeCommsLogEntry(
      operationEntry({ outcome: "ok" }),
      (key: MessageKey) => translate(key, "en"),
    );
    expect(text.operationSuffix).toEqual({
      text: " · ✓",
      tone: "ok",
      ariaLabel: "Succeeded",
    });
  });

  it("shows an error icon with tone/ariaLabel when outcome is observed without durationMs", () => {
    const text = describeCommsLogEntry(
      operationEntry({ outcome: "error" }),
      (key: MessageKey) => translate(key, "en"),
    );
    expect(text.operationSuffix).toEqual({
      text: " · ✕",
      tone: "error",
      ariaLabel: "Failed",
    });
  });

  it("bundles icon + duration into one colored suffix, with both facts in ariaLabel (ok)", () => {
    const text = describeCommsLogEntry(
      operationEntry({ outcome: "ok", durationMs: 12 }),
      (key: MessageKey) => translate(key, "en"),
    );
    expect(text.operationSuffix).toEqual({
      text: " · ✓ 12ms",
      tone: "ok",
      ariaLabel: "Succeeded (12ms)",
    });
  });

  it("bundles icon + duration into one colored suffix, with both facts in ariaLabel (error)", () => {
    const text = describeCommsLogEntry(
      operationEntry({ outcome: "error", durationMs: 8 }),
      (key: MessageKey) => translate(key, "en"),
    );
    expect(text.operationSuffix).toEqual({
      text: " · ✕ 8ms",
      tone: "error",
      ariaLabel: "Failed (8ms)",
    });
  });

  it("(ja) uses the Japanese wording for ariaLabel", () => {
    const t = (key: MessageKey) => translate(key, "ja" as Language);
    expect(describeCommsLogEntry(operationEntry({ outcome: "ok", durationMs: 5 }), t).operationSuffix).toEqual({
      text: " · ✓ 5ms",
      tone: "ok",
      ariaLabel: "成功（5ms）",
    });
    expect(describeCommsLogEntry(operationEntry({ outcome: "error" }), t).operationSuffix).toEqual({
      text: " · ✕",
      tone: "error",
      ariaLabel: "失敗",
    });
  });
});

describe("describeCommsLogEntry: operation suffix boundary durations", () => {
  const en = (key: MessageKey) => translate(key, "en");

  it("shows a durationMs of 0 rather than omitting it (0 is distinct from undefined)", () => {
    // durationMs === 0 は「所要時間 0ms」であって欠落ではない。undefined と
    // 取り違えて suffix を落とさないことを固定する。
    const text = describeCommsLogEntry(operationEntry({ durationMs: 0 }), en);
    expect(text.operationSuffix).toEqual({ text: " · 0ms" });
  });

  it("shows a durationMs of 0 alongside an outcome icon and in the ariaLabel", () => {
    const text = describeCommsLogEntry(operationEntry({ outcome: "ok", durationMs: 0 }), en);
    expect(text.operationSuffix).toEqual({
      text: " · ✓ 0ms",
      tone: "ok",
      ariaLabel: "Succeeded (0ms)",
    });
  });

  it("keeps a plain ms unit for very large durations (no switch to seconds)", () => {
    // 設計メモ §5 で単位切替は実装判断に委ねられ、実装は ms 表記のまま。
    const text = describeCommsLogEntry(operationEntry({ outcome: "error", durationMs: 123456 }), en);
    expect(text.operationSuffix).toEqual({
      text: " · ✕ 123456ms",
      tone: "error",
      ariaLabel: "Failed (123456ms)",
    });
  });

  it("keeps a plain ms unit for a very large duration-only suffix", () => {
    const text = describeCommsLogEntry(operationEntry({ durationMs: 987654 }), en);
    expect(text.operationSuffix).toEqual({ text: " · 987654ms" });
  });
});
