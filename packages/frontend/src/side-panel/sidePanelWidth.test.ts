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

  it("floors to the minimum exactly at the viewport where 0.9*vw crosses the min", () => {
    // 0.9 * vw == SIDE_PANEL_MIN_WIDTH のちょうどの分岐点。
    const crossover = SIDE_PANEL_MIN_WIDTH / 0.9; // ≒ 333.33
    expect(sidePanelMaxWidth(crossover)).toBe(SIDE_PANEL_MIN_WIDTH);
    // わずかに広いビューポートでは比率計算が最小幅を上回る。
    expect(sidePanelMaxWidth(crossover + 100)).toBeCloseTo((crossover + 100) * 0.9);
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

  it("collapses to the single min==max value on a narrow viewport regardless of input", () => {
    // 最狭ビューポートでは min も max も 300 に潰れる。範囲内・範囲外・
    // 境界のいずれの入力でも同じ 300 に落ちる（矛盾レンジで NaN 等を
    // 出さない）ことを確認する。
    expect(clampSidePanelWidth(100, 200)).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(clampSidePanelWidth(300, 200)).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(clampSidePanelWidth(9999, 200)).toBe(SIDE_PANEL_MIN_WIDTH);
  });

  it("clamps a negative width up to the minimum", () => {
    expect(clampSidePanelWidth(-100, 1200)).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(clampSidePanelWidth(-Infinity, 1200)).toBe(SIDE_PANEL_MIN_WIDTH);
  });

  it("keeps a value exactly at the maximum boundary and clamps one above it", () => {
    const max = sidePanelMaxWidth(1000); // 900
    expect(clampSidePanelWidth(max, 1000)).toBe(max);
    expect(clampSidePanelWidth(max + 0.001, 1000)).toBe(max);
    expect(clampSidePanelWidth(max - 0.001, 1000)).toBe(max - 0.001);
  });

  it("preserves fractional widths that fall inside the range", () => {
    expect(clampSidePanelWidth(512.5, 1200)).toBe(512.5);
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

  it("falls back to the default width for the literal strings NaN/Infinity/-Infinity", () => {
    // Number("NaN") -> NaN, Number("Infinity"/"-Infinity") -> ±Infinity。
    // いずれも非有限なので既定幅にフォールバックする。
    for (const raw of ["NaN", "Infinity", "-Infinity"]) {
      const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: raw });
      expect(loadSidePanelWidth(storage, 1200)).toBe(SIDE_PANEL_DEFAULT_WIDTH);
    }
  });

  it("clamps a negative stored value up to the minimum (finite, so not treated as corrupt)", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "-100" });
    expect(loadSidePanelWidth(storage, 1200)).toBe(SIDE_PANEL_MIN_WIDTH);
  });

  it("treats empty/whitespace stored values as 0 and clamps them to the minimum", () => {
    // 注意: Number("") と Number(" ") はどちらも 0（NaN ではない）ため、
    // これらは「壊れた値 → 既定 420」ではなく「範囲外 → 最小 300」に
    // クランプされる。saveSidePanelWidth は空文字を書き込まないため、
    // 空文字は外部改変でしか発生しない。実挙動を固定して記録する。
    for (const raw of ["", " "]) {
      const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: raw });
      expect(loadSidePanelWidth(storage, 1200)).toBe(SIDE_PANEL_MIN_WIDTH);
    }
  });

  it("accepts a hexadecimal stored value the way Number() parses it", () => {
    // Number("0x1F4") === 500。実挙動を固定（意図的な仕様ではないが、
    // 生文字列を Number() に通す方式の帰結として記録する）。
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "0x1F4" });
    expect(loadSidePanelWidth(storage, 1200)).toBe(500);
  });

  it("preserves a fractional stored value inside the range", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: "512.5" });
    expect(loadSidePanelWidth(storage, 1200)).toBe(512.5);
  });

  it("returns exactly the minimum when the stored value equals the minimum", () => {
    const storage = memoryStorage({ [SIDE_PANEL_WIDTH_STORAGE_KEY]: String(SIDE_PANEL_MIN_WIDTH) });
    expect(loadSidePanelWidth(storage, 1200)).toBe(SIDE_PANEL_MIN_WIDTH);
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
