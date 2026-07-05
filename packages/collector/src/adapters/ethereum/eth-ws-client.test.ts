import { describe, expect, it } from "vitest";
import { parseSubscriptionResult } from "./eth-ws-client.js";

describe("parseSubscriptionResult", () => {
  it("extracts the header object from a newHeads notification", () => {
    const header = {
      hash: "0xabc",
      number: "0x10",
      parentHash: "0xpar",
      timestamp: "0x64",
    };
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x1", result: header },
    });
    expect(parseSubscriptionResult(raw)).toEqual(header);
  });

  it("extracts a tx hash string from a newPendingTransactions notification", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x2", result: "0xdeadbeef" },
    });
    expect(parseSubscriptionResult(raw)).toBe("0xdeadbeef");
  });

  it("ignores the eth_subscribe reply that carries the subscription id", () => {
    // 購読開始時の応答（{id, result: "0x1"}）は method を持たないので無視する。
    const raw = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" });
    expect(parseSubscriptionResult(raw)).toBeUndefined();
  });

  it("ignores non-subscription methods", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_somethingElse",
      params: { result: "0xabc" },
    });
    expect(parseSubscriptionResult(raw)).toBeUndefined();
  });

  it("returns undefined for a notification without a result", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x1" },
    });
    expect(parseSubscriptionResult(raw)).toBeUndefined();
  });

  it("returns undefined for malformed JSON instead of throwing", () => {
    expect(parseSubscriptionResult("not json")).toBeUndefined();
  });

  it("preserves a falsy-but-present result such as an empty string", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_subscription",
      params: { subscription: "0x1", result: "" },
    });
    expect(parseSubscriptionResult(raw)).toBe("");
  });
});
