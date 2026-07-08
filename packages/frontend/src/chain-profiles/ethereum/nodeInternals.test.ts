import { describe, expect, it } from "vitest";
import { describeEngineApiMethod } from "./nodeInternals.js";

describe("describeEngineApiMethod", () => {
  it("matches versioned newPayload methods by prefix", () => {
    expect(describeEngineApiMethod("engine_newPayloadV4")).toEqual({
      ja: "ブロックの実行依頼",
      en: "Execute new block",
    });
    expect(describeEngineApiMethod("engine_newPayloadV3")).toEqual({
      ja: "ブロックの実行依頼",
      en: "Execute new block",
    });
  });

  it("matches versioned forkchoiceUpdated methods by prefix", () => {
    expect(describeEngineApiMethod("engine_forkchoiceUpdatedV3")).toEqual({
      ja: "チェーン先端の更新",
      en: "Update chain head",
    });
  });

  it("matches versioned getPayload methods by prefix", () => {
    expect(describeEngineApiMethod("engine_getPayloadV4")).toEqual({
      ja: "ブロック構築の依頼",
      en: "Request block build",
    });
  });

  it("returns undefined for a method with no matching prefix (raw name fallback)", () => {
    expect(describeEngineApiMethod("engine_exchangeCapabilities")).toBeUndefined();
    expect(describeEngineApiMethod("eth_getBlockByNumber")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(describeEngineApiMethod("")).toBeUndefined();
  });
});
