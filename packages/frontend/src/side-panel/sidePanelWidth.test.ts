// sidePanelWidth（Issue #362）のテスト。クランプ境界・永続化の
// 読み書きを検証する。ドラッグ/キーボード操作の状態管理は
// useSidePanelResize.test.ts に分ける（CLAUDE.md のテスト分割方針）。
import { describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "../platform/storage.js";
import {
  SIDE_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_WIDTH_STORAGE_KEY,
  clampSidePanelWidth,
  loadSidePanelWidth,
  saveSidePanelWidth,
  sidePanelMaxWidth,
} from "./sidePanelWidth.js";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("sidePanelMaxWidth", () => {
  it("returns 90% of the viewport width for a typical viewport", () => {
    expect(sidePanelMaxWidth(1000)).toBe(900);
  });

  it("never goes below the minimum width even on a very narrow viewport", () => {
    expect(sidePanelMaxWidth(200)).toBe(SIDE_PANEL_MIN_WIDTH);
  });
});

describe("clampSidePanelWidth", () => {
  it("keeps a value inside the [min, max] range unchanged", () => {
    expect(clampSidePanelWidth(500, 1200)).toBe(500);
  });

  it("clamps up to the minimum width", () => {
    expect(clampSidePanelWidth(10, 1200)).toBe(SIDE_PANEL_MIN_WIDTH);
  });

  it("clamps down to the maximum width (90% of viewport)", () => {
    expect(clampSidePanelWidth(5000, 1000)).toBe(900);
  });

  it("treats boundary values as valid (does not over-clamp)", () => {
    expect(clampSidePanelWidth(SIDE_PANEL_MIN_WIDTH, 1200)).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(clampSidePanelWidth(1080, 1200)).toBe(1080);
  });

  it("resolves a narrow viewport (max < naive min) without an inverted range", () => {
    // viewportWidth * 0.9 (180) は最小幅 (300) を下回るため、
    // sidePanelMaxWidth 側で下限保証されていることを確認する。
    expect(clampSidePanelWidth(250, 200)).toBe(SIDE_PANEL_MIN_WIDTH);
  });
});

describe("loadSidePanelWidth", () => {
  it("returns the default width when nothing is stored", () => {
    expect(loadSidePanelWidth(memoryStorage(), 1200)).toBe(SIDE_PANEL_DEFAULT_WIDTH);
  });

  it("returns the stored width when present and in range", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "500" });
    expect(loadSidePanelWidth(storage, 1200)).toBe(500);
  });

  it("falls back to the default width for a non-numeric stored value", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "not-a-number" });
    expect(loadSidePanelWidth(storage, 1200)).toBe(SIDE_PANEL_DEFAULT_WIDTH);
  });

  it("clamps an out-of-range stored value instead of using it verbatim", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "5" });
    expect(loadSidePanelWidth(storage, 1200)).toBe(SIDE_PANEL_MIN_WIDTH);
  });

  it("clamps a stored value that no longer fits a shrunk viewport", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "900" });
    expect(loadSidePanelWidth(storage, 500)).toBe(450);
  });

  it("falls back to the default width for Infinity/NaN-producing values", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "1e999" });
    // "1e999" parses to Infinity, which is not finite -> default, then clamp.
    expect(loadSidePanelWidth(storage, 1200)).toBe(SIDE_PANEL_DEFAULT_WIDTH);
  });
});

describe("saveSidePanelWidth", () => {
  it("round-trips a saved width", () => {
    const storage = memoryStorage();
    saveSidePanelWidth(storage, 555);
    expect(loadSidePanelWidth(storage, 1200)).toBe(555);
  });

  it("swallows write errors (e.g. quota exceeded) and logs a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    expect(() => saveSidePanelWidth(storage, 500)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
