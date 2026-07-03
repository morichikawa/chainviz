import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBrowserStorage } from "./storage.js";

// jsdom や Node の experimental localStorage が有効かどうかは実行環境に依存し、
// テスト全体を通しての初期化順にも左右される。ここでは globalThis.localStorage を
// 各ケースで明示的に差し替え、環境に依存せず両方の分岐を決定的に検証する。
function installLocalStorage(value: unknown): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value,
  });
}

describe("getBrowserStorage", () => {
  let saved: PropertyDescriptor | undefined;

  beforeEach(() => {
    saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  });

  afterEach(() => {
    if (saved) {
      Object.defineProperty(globalThis, "localStorage", saved);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  describe("when a working localStorage is available", () => {
    // 実際に読み書きできる localStorage がある場合はそれをそのまま使う設計。
    beforeEach(() => {
      const map = new Map<string, string>();
      installLocalStorage({
        getItem: (key: string) => (map.has(key) ? map.get(key) : null),
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
      });
    });

    it("returns a working storage", () => {
      const storage = getBrowserStorage();
      storage.setItem("k", "v");
      expect(storage.getItem("k")).toBe("v");
      expect(storage.getItem("missing")).toBeNull();
    });

    it("uses the real localStorage so state persists across calls", () => {
      const a = getBrowserStorage();
      a.setItem("x", "1");
      const b = getBrowserStorage();
      // 使える localStorage を返すため、別々に取得しても同じストアを指す。
      expect(b.getItem("x")).toBe("1");
    });
  });

  describe("when localStorage is unavailable", () => {
    // localStorage が無い環境（SSR やプライベートモード等）を再現し、
    // インメモリのフォールバックが返ることを検証する。
    beforeEach(() => {
      installLocalStorage(undefined);
    });

    it("returns a working in-memory storage as a fallback", () => {
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

  describe("when localStorage throws on access", () => {
    // アクセス自体が例外を投げる（ブラウザのプライベートモード等）場合も
    // フォールバックへ切り替わることを検証する。
    beforeEach(() => {
      installLocalStorage({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      });
    });

    it("falls back to in-memory storage", () => {
      const storage = getBrowserStorage();
      storage.setItem("k", "v");
      expect(storage.getItem("k")).toBe("v");
    });
  });
});
