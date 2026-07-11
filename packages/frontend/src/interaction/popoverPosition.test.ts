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
});
