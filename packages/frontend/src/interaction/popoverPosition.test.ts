import { describe, expect, it } from "vitest";
import { computePopoverPosition } from "./popoverPosition.js";

describe("computePopoverPosition (Issue #245)", () => {
  it("places the popover gapPx below the anchor's bottom edge, left-aligned to the anchor", () => {
    const position = computePopoverPosition(
      { top: 10, left: 20, right: 120, bottom: 40 },
      8,
    );
    expect(position).toEqual({ top: 48, left: 20 });
  });

  it("uses a different gap value verbatim (each popover class has its own gapPx)", () => {
    const position = computePopoverPosition(
      { top: 0, left: 5, right: 100, bottom: 30 },
      6,
    );
    expect(position).toEqual({ top: 36, left: 5 });
  });

  it("ignores the anchor's right edge (left alignment does not depend on anchor width)", () => {
    const narrow = computePopoverPosition(
      { top: 0, left: 5, right: 15, bottom: 20 },
      8,
    );
    const wide = computePopoverPosition(
      { top: 0, left: 5, right: 500, bottom: 20 },
      8,
    );
    expect(narrow).toEqual(wide);
  });

  it("follows the anchor when it moves (e.g. canvas pan/zoom or drag)", () => {
    const before = computePopoverPosition(
      { top: 100, left: 100, right: 200, bottom: 130 },
      8,
    );
    const after = computePopoverPosition(
      { top: 250, left: 340, right: 440, bottom: 280 },
      8,
    );
    expect(before).toEqual({ top: 138, left: 100 });
    expect(after).toEqual({ top: 288, left: 340 });
  });

  it("supports negative coordinates (anchor scrolled above/left of the viewport)", () => {
    const position = computePopoverPosition(
      { top: -50, left: -30, right: 20, bottom: -10 },
      8,
    );
    expect(position).toEqual({ top: -2, left: -30 });
  });

  it("places the popover flush against the anchor when gapPx is 0", () => {
    const position = computePopoverPosition(
      { top: 10, left: 20, right: 120, bottom: 40 },
      0,
    );
    expect(position).toEqual({ top: 40, left: 20 });
  });

  it("applies a negative gapPx verbatim (overlaps the anchor by |gapPx|)", () => {
    // gapPx は既存 CSS の calc(100% + Npx) をそのまま移したもの。負値でも
    // クランプせずそのまま加算する（呼び出し側の指定を尊重する純粋関数）。
    const position = computePopoverPosition(
      { top: 10, left: 20, right: 120, bottom: 40 },
      -5,
    );
    expect(position).toEqual({ top: 35, left: 20 });
  });

  it("preserves sub-pixel (fractional) coordinates without rounding", () => {
    // getBoundingClientRect はズーム時などに小数を返す。丸めずそのまま通す。
    const position = computePopoverPosition(
      { top: 10.4, left: 20.6, right: 120.6, bottom: 40.25 },
      8.5,
    );
    expect(position).toEqual({ top: 48.75, left: 20.6 });
  });

  it(
    "does NOT clamp to the viewport when the anchor sits near the right/bottom " +
      "edge (characterization: overflow is left to the browser, matching the " +
      "original position:absolute CSS which also did not clamp)",
    () => {
      // アンカーが画面右下端に近くても座標を折り返さない。従来の
      // position:absolute; top: calc(100%); left: 0; もはみ出しを許容していた
      // ため、挙動を変えないことを固定する（クランプが必要になったら別 Issue）。
      const nearRightBottom = computePopoverPosition(
        { top: 700, left: 1900, right: 2000, bottom: 740 },
        8,
      );
      expect(nearRightBottom).toEqual({ top: 748, left: 1900 });
    },
  );

  it("does not mutate the input anchor rect", () => {
    const anchorRect = { top: 10, left: 20, right: 120, bottom: 40 };
    const snapshot = { ...anchorRect };
    computePopoverPosition(anchorRect, 8);
    expect(anchorRect).toEqual(snapshot);
  });

  it("returns a fresh object each call (no shared/cached reference)", () => {
    const rect = { top: 10, left: 20, right: 120, bottom: 40 } as const;
    const a = computePopoverPosition(rect, 8);
    const b = computePopoverPosition(rect, 8);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
