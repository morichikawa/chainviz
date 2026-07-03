import { describe, expect, it, vi } from "vitest";
import {
  LAYOUT_STORAGE_KEY,
  type LayoutStorage,
  loadLayout,
  saveLayout,
  saveNodePosition,
} from "./layoutStore.js";

function memoryStorage(initial: Record<string, string> = {}): LayoutStorage & {
  dump(): Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    dump: () => Object.fromEntries(map),
  };
}

describe("loadLayout", () => {
  it("returns an empty map when nothing is stored", () => {
    expect(loadLayout(memoryStorage())).toEqual({});
  });

  it("parses a stored layout keyed by stable id", () => {
    const storage = memoryStorage({
      [LAYOUT_STORAGE_KEY]: JSON.stringify({
        "reth-node-1": { x: 10, y: 20 },
      }),
    });
    expect(loadLayout(storage)).toEqual({ "reth-node-1": { x: 10, y: 20 } });
  });

  it("returns an empty map for malformed JSON", () => {
    const storage = memoryStorage({ [LAYOUT_STORAGE_KEY]: "{not json" });
    expect(loadLayout(storage)).toEqual({});
  });

  it("ignores non-object / array payloads", () => {
    expect(loadLayout(memoryStorage({ [LAYOUT_STORAGE_KEY]: "42" }))).toEqual({});
    expect(loadLayout(memoryStorage({ [LAYOUT_STORAGE_KEY]: "[1,2]" }))).toEqual(
      {},
    );
  });

  it("drops entries with non-finite or missing coordinates", () => {
    const storage = memoryStorage({
      [LAYOUT_STORAGE_KEY]: JSON.stringify({
        good: { x: 1, y: 2 },
        noY: { x: 1 },
        stringX: { x: "1", y: 2 },
        nan: { x: Number.NaN, y: 2 },
      }),
    });
    expect(loadLayout(storage)).toEqual({ good: { x: 1, y: 2 } });
  });

  it("keeps zero and negative coordinates (boundary values)", () => {
    const storage = memoryStorage({
      [LAYOUT_STORAGE_KEY]: JSON.stringify({
        origin: { x: 0, y: 0 },
        negative: { x: -100, y: -0.5 },
      }),
    });
    expect(loadLayout(storage)).toEqual({
      origin: { x: 0, y: 0 },
      negative: { x: -100, y: -0.5 },
    });
  });

  it("drops entries with Infinity coordinates", () => {
    const storage = memoryStorage({
      // JSON.stringify(Infinity) は null になるため生 JSON で埋め込む。
      [LAYOUT_STORAGE_KEY]: '{"inf":{"x":1e999,"y":0},"ok":{"x":1,"y":1}}',
    });
    expect(loadLayout(storage)).toEqual({ ok: { x: 1, y: 1 } });
  });

  it("drops entries whose value is null or an array", () => {
    const storage = memoryStorage({
      [LAYOUT_STORAGE_KEY]: JSON.stringify({
        nullish: null,
        arrayish: [1, 2],
        ok: { x: 1, y: 1 },
      }),
    });
    expect(loadLayout(storage)).toEqual({ ok: { x: 1, y: 1 } });
  });

  it("strips extra properties from a stored position", () => {
    const storage = memoryStorage({
      [LAYOUT_STORAGE_KEY]: JSON.stringify({
        a: { x: 1, y: 2, z: 3, dragging: true },
      }),
    });
    expect(loadLayout(storage)).toEqual({ a: { x: 1, y: 2 } });
  });
});

describe("saveLayout / saveNodePosition", () => {
  it("round-trips a saved layout", () => {
    const storage = memoryStorage();
    saveLayout(storage, { a: { x: 3, y: 4 } });
    expect(loadLayout(storage)).toEqual({ a: { x: 3, y: 4 } });
  });

  it("merges a single position without discarding others", () => {
    const storage = memoryStorage({
      [LAYOUT_STORAGE_KEY]: JSON.stringify({ a: { x: 0, y: 0 } }),
    });
    const result = saveNodePosition(storage, "b", { x: 5, y: 6 });
    expect(result).toEqual({ a: { x: 0, y: 0 }, b: { x: 5, y: 6 } });
    expect(loadLayout(storage)).toEqual({ a: { x: 0, y: 0 }, b: { x: 5, y: 6 } });
  });

  it("overwrites an existing position for the same stable id", () => {
    const storage = memoryStorage();
    saveNodePosition(storage, "a", { x: 1, y: 1 });
    saveNodePosition(storage, "a", { x: 9, y: 9 });
    expect(loadLayout(storage)).toEqual({ a: { x: 9, y: 9 } });
  });

  it("recovers from corrupted existing storage by writing a fresh map", () => {
    const storage = memoryStorage({ [LAYOUT_STORAGE_KEY]: "{corrupt" });
    const result = saveNodePosition(storage, "a", { x: 1, y: 2 });
    expect(result).toEqual({ a: { x: 1, y: 2 } });
    expect(loadLayout(storage)).toEqual({ a: { x: 1, y: 2 } });
  });

  it("stores only x and y when given a position with extra fields", () => {
    const storage = memoryStorage();
    saveNodePosition(storage, "a", {
      x: 1,
      y: 2,
      extra: "ignored",
    } as unknown as Parameters<typeof saveNodePosition>[2]);
    expect(loadLayout(storage)).toEqual({ a: { x: 1, y: 2 } });
  });

  it("swallows write errors from saveLayout (e.g. quota exceeded)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage: LayoutStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    expect(() => saveLayout(storage, { a: { x: 1, y: 2 } })).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("swallows write errors from saveNodePosition and still returns the map", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage: LayoutStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    let result: ReturnType<typeof saveNodePosition> | undefined;
    expect(() => {
      result = saveNodePosition(storage, "a", { x: 1, y: 2 });
    }).not.toThrow();
    expect(result).toEqual({ a: { x: 1, y: 2 } });
    warn.mockRestore();
  });
});
