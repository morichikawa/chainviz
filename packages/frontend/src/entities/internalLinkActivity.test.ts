import type { InternalCallStats } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import { formatInternalCallEntry, formatInternalCallList } from "./internalLinkActivity.js";

const tJa = (key: MessageKey) => translate(key, "ja");
const tEn = (key: MessageKey) => translate(key, "en");

describe("formatInternalCallEntry", () => {
  it("shows the raw method name and count with no suffix when unclassified and no latency", () => {
    expect(formatInternalCallEntry({ method: "engine_exchangeCapabilities", count: 1 }, "ja", tJa)).toBe(
      "engine_exchangeCapabilities ×1",
    );
  });

  it("appends the classification label in the current language when the method matches a known prefix", () => {
    const call: InternalCallStats = { method: "engine_newPayloadV4", count: 2 };
    expect(formatInternalCallEntry(call, "ja", tJa)).toBe(
      "engine_newPayloadV4 ×2 (ブロックの実行依頼)",
    );
    expect(formatInternalCallEntry(call, "en", tEn)).toBe(
      "engine_newPayloadV4 ×2 (Execute new block)",
    );
  });

  it("appends the rounded average latency when observed", () => {
    const call: InternalCallStats = {
      method: "engine_forkchoiceUpdatedV3",
      count: 2,
      latencyMs: 12.4,
    };
    expect(formatInternalCallEntry(call, "ja", tJa)).toBe(
      "engine_forkchoiceUpdatedV3 ×2 (チェーン先端の更新) (平均 12 ms)",
    );
    expect(formatInternalCallEntry(call, "en", tEn)).toBe(
      "engine_forkchoiceUpdatedV3 ×2 (Update chain head) (avg 12 ms)",
    );
  });

  it("omits the latency suffix when latencyMs is not observed", () => {
    const call: InternalCallStats = { method: "engine_getPayloadV4", count: 1 };
    expect(formatInternalCallEntry(call, "ja", tJa)).toBe(
      "engine_getPayloadV4 ×1 (ブロック構築の依頼)",
    );
  });
});

describe("formatInternalCallList", () => {
  it("joins multiple call entries with a middle dot separator", () => {
    const calls: InternalCallStats[] = [
      { method: "engine_newPayloadV4", count: 2 },
      { method: "engine_forkchoiceUpdatedV3", count: 2, latencyMs: 12 },
    ];
    expect(formatInternalCallList(calls, "ja", tJa)).toBe(
      "engine_newPayloadV4 ×2 (ブロックの実行依頼) · engine_forkchoiceUpdatedV3 ×2 (チェーン先端の更新) (平均 12 ms)",
    );
  });

  it("returns an empty string for an empty call list", () => {
    expect(formatInternalCallList([], "ja", tJa)).toBe("");
  });
});
