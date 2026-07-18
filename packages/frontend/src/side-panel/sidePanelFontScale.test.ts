// sidePanelFontScale（Issue #377）のテスト。ステップ送り・スナップ・
// 永続化の読み書きを検証する。フックの状態遷移は
// useSidePanelFontScale.test.ts に分ける（CLAUDE.md のテスト分割方針）。
import { describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "../platform/storage.js";
import {
  SIDE_PANEL_DEFAULT_FONT_SCALE,
  SIDE_PANEL_FONT_SCALE_STEPS,
  SIDE_PANEL_FONT_SCALE_STORAGE_KEY,
  loadSidePanelFontScale,
  saveSidePanelFontScale,
  stepSidePanelFontScale,
} from "./sidePanelFontScale.js";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("stepSidePanelFontScale", () => {
  it("moves to the next larger step", () => {
    expect(stepSidePanelFontScale(1, 1)).toBe(1.15);
  });

  it("moves to the next smaller step", () => {
    expect(stepSidePanelFontScale(1, -1)).toBe(0.85);
  });

  it("stays at the same value when already at the maximum step", () => {
    expect(stepSidePanelFontScale(1.5, 1)).toBe(1.5);
  });

  it("stays at the same value when already at the minimum step", () => {
    expect(stepSidePanelFontScale(0.85, -1)).toBe(0.85);
  });

  it("snaps a value that is not exactly a step to its nearest step before moving", () => {
    // 1.2 は 1.15 に最も近いので、そこから+1段で 1.3 になる。
    expect(stepSidePanelFontScale(1.2, 1)).toBe(1.3);
  });

  it("snaps a non-step value to its nearest step before moving down", () => {
    // 1.2 は 1.15 に最も近いので、そこから-1段で 1.0 になる。
    expect(stepSidePanelFontScale(1.2, -1)).toBe(1);
  });

  it("clamps an out-of-range current value before stepping (above the max)", () => {
    // 5 は最も近い刻みが 1.5(最大)。そこから +1 は端で停止し 1.5、
    // -1 で 1.3 に下がる。
    expect(stepSidePanelFontScale(5, 1)).toBe(1.5);
    expect(stepSidePanelFontScale(5, -1)).toBe(1.3);
  });

  it("clamps an out-of-range current value before stepping (below the min)", () => {
    // -5 は最も近い刻みが 0.85(最小)。-1 は端で停止し 0.85、
    // +1 で 1.0 に上がる。
    expect(stepSidePanelFontScale(-5, -1)).toBe(0.85);
    expect(stepSidePanelFontScale(-5, 1)).toBe(1);
  });

  it("walks through every step in order when repeatedly increasing", () => {
    let current: number = SIDE_PANEL_FONT_SCALE_STEPS[0];
    const visited: number[] = [current];
    for (let i = 0; i < SIDE_PANEL_FONT_SCALE_STEPS.length - 1; i += 1) {
      current = stepSidePanelFontScale(current, 1);
      visited.push(current);
    }
    expect(visited).toEqual([...SIDE_PANEL_FONT_SCALE_STEPS]);
  });

  it("walks through every step in reverse when repeatedly decreasing", () => {
    let current: number = SIDE_PANEL_FONT_SCALE_STEPS[SIDE_PANEL_FONT_SCALE_STEPS.length - 1];
    const visited: number[] = [current];
    for (let i = 0; i < SIDE_PANEL_FONT_SCALE_STEPS.length - 1; i += 1) {
      current = stepSidePanelFontScale(current, -1);
      visited.push(current);
    }
    expect(visited).toEqual([...SIDE_PANEL_FONT_SCALE_STEPS].reverse());
  });
});

describe("loadSidePanelFontScale", () => {
  it("returns the default scale when nothing is stored", () => {
    expect(loadSidePanelFontScale(memoryStorage())).toBe(SIDE_PANEL_DEFAULT_FONT_SCALE);
  });

  it("returns the stored scale when it exactly matches a step", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.3" });
    expect(loadSidePanelFontScale(storage)).toBe(1.3);
  });

  it("snaps a stored value that falls between steps to the nearest step", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.45" });
    expect(loadSidePanelFontScale(storage)).toBe(1.5);
  });

  it("snaps to the earlier (smaller) step on an exact tie between two steps", () => {
    // 1.4 は 1.3 からも 1.5 からも同じ距離(0.1)。実装は先に見つかった
    // （配列の若い= より小さい）刻みを採用する。この挙動を固定して記録する。
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "1.4" });
    expect(loadSidePanelFontScale(storage)).toBe(1.3);
  });

  it("snaps values near each internal boundary to the floating-point-nearest step", () => {
    // 刻みの中点付近の値は、十進では両隣と等距離に見えても IEEE754 では
    // 厳密な同距離(タイ)にならない。どちらへ丸まるかは浮動小数点の丸め
    // 次第で「必ず小さい側」ではない(例: 0.925 は 1.0 側へ丸まる)。
    // 実装の実挙動を各境界で固定する(nearestFontScaleStepIndex の帰結)。
    const nearestStep: [string, number][] = [
      ["0.925", 1], // 0.85 と 1.0 の中点付近 → 1.0 が僅かに近い
      ["1.075", 1], // 1.0 と 1.15 の中点付近 → 1.0 が僅かに近い
      ["1.225", 1.3], // 1.15 と 1.3 の中点付近 → 1.3 が僅かに近い
      ["1.4", 1.3], // 1.3 と 1.5 の中点付近 → 1.3 が僅かに近い
    ];
    for (const [raw, expected] of nearestStep) {
      const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: raw });
      expect(loadSidePanelFontScale(storage)).toBe(expected);
    }
  });

  it("loads each edge step exactly without snapping", () => {
    for (const exact of ["0.85", "1.5"]) {
      const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: exact });
      expect(loadSidePanelFontScale(storage)).toBe(Number(exact));
    }
  });

  it("treats an empty or whitespace stored value as finite zero and snaps to the smallest step", () => {
    // Number("") === 0 / Number("   ") === 0 は「非数」ではなく有限の 0。
    // 実装は有限値を最近傍へスナップするため、既定 1.0 ではなく最小刻み
    // 0.85 になる。手動改変時のみ起こりうる帰結だが実害は無いため固定する。
    for (const raw of ["", "   "]) {
      const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: raw });
      expect(loadSidePanelFontScale(storage)).toBe(0.85);
    }
  });

  it("falls back to the default scale for a non-numeric stored value", () => {
    const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "not-a-number" });
    expect(loadSidePanelFontScale(storage)).toBe(SIDE_PANEL_DEFAULT_FONT_SCALE);
  });

  it("falls back to the default scale for non-finite values (Infinity/NaN)", () => {
    for (const raw of ["NaN", "Infinity", "-Infinity", "1e999"]) {
      const storage = memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: raw });
      expect(loadSidePanelFontScale(storage)).toBe(SIDE_PANEL_DEFAULT_FONT_SCALE);
    }
  });

  it("clamps a finite out-of-range value (e.g. negative or huge) to the nearest edge step", () => {
    expect(
      loadSidePanelFontScale(memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "-5" })),
    ).toBe(0.85);
    expect(
      loadSidePanelFontScale(memoryStorage({ [SIDE_PANEL_FONT_SCALE_STORAGE_KEY]: "999" })),
    ).toBe(1.5);
  });
});

describe("saveSidePanelFontScale", () => {
  it("round-trips a saved scale", () => {
    const storage = memoryStorage();
    saveSidePanelFontScale(storage, 1.3);
    expect(loadSidePanelFontScale(storage)).toBe(1.3);
  });

  it("swallows write errors (e.g. quota exceeded) and logs a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    expect(() => saveSidePanelFontScale(storage, 1.15)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
