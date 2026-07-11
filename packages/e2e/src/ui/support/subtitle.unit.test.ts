import { describe, expect, it } from "vitest";
import { subtitleEndsWithClientType } from "./subtitle.js";

describe("subtitleEndsWithClientType", () => {
  it("matches the new '{role label} · {clientType}' format (Issue #215)", () => {
    expect(subtitleEndsWithClientType("reth").test("実行クライアント · reth")).toBe(
      true,
    );
    expect(
      subtitleEndsWithClientType("lighthouse").test("Consensus client · lighthouse"),
    ).toBe(true);
  });

  it("matches the legacy fallback format ('{clientType}' alone)", () => {
    expect(subtitleEndsWithClientType("reth").test("reth")).toBe(true);
  });

  it("does not match a different clientType", () => {
    expect(subtitleEndsWithClientType("reth").test("実行クライアント · lighthouse")).toBe(
      false,
    );
  });

  it("does not match when clientType is only a substring, not the trailing token", () => {
    // "reth" が末尾ではなく途中に混ざるだけのケースを誤検出しない
    // （例: 将来 clientType に "rethink" のような値が来ても事故らないことの確認）。
    expect(subtitleEndsWithClientType("reth").test("実行クライアント · rethink")).toBe(
      false,
    );
  });

  it("escapes regex special characters in clientType", () => {
    expect(subtitleEndsWithClientType("go-ethereum").test("実行クライアント · go-ethereum")).toBe(
      true,
    );
    expect(subtitleEndsWithClientType("a.b").test("a.b")).toBe(true);
    expect(subtitleEndsWithClientType("a.b").test("aXb")).toBe(false);
  });
});
