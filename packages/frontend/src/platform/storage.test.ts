import { describe, expect, it } from "vitest";
import { getBrowserStorage } from "./storage.js";

describe("getBrowserStorage", () => {
  it("returns a working storage even when localStorage is unavailable", () => {
    // jsdom 環境では localStorage が未定義。フォールバックが返るはず。
    const storage = getBrowserStorage();
    storage.setItem("k", "v");
    expect(storage.getItem("k")).toBe("v");
    expect(storage.getItem("missing")).toBeNull();
  });

  it("gives an isolated store per call when falling back to memory", () => {
    const a = getBrowserStorage();
    a.setItem("x", "1");
    const b = getBrowserStorage();
    // フォールバックはインメモリなので別インスタンス間で共有しない。
    expect(b.getItem("x")).toBeNull();
  });
});
