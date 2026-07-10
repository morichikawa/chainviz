import { describe, expect, it } from "vitest";
import { parseUnits } from "./tokenAmount.js";

describe("parseUnits", () => {
  describe("decimals = 18 (ChainvizToken, same precision as ETH)", () => {
    it("converts a whole-number token amount to the minimal unit", () => {
      expect(parseUnits("1000", 18)).toBe("1000000000000000000000");
    });

    it("converts a fractional token amount to the minimal unit", () => {
      expect(parseUnits("1.5", 18)).toBe("1500000000000000000");
    });

    it("converts an amount with exactly 18 fractional digits (minimal-unit precision)", () => {
      expect(parseUnits("0.000000000000000001", 18)).toBe("1");
    });

    it("returns undefined for more than 18 fractional digits (sub-minimal-unit precision)", () => {
      expect(parseUnits("0.0000000000000000001", 18)).toBeUndefined();
    });

    it("converts zero", () => {
      expect(parseUnits("0", 18)).toBe("0");
    });
  });

  describe("decimals = 0 (no fractional precision at all)", () => {
    it("converts a whole number as-is", () => {
      expect(parseUnits("5", 0)).toBe("5");
    });

    it("returns undefined for any fractional input, even a trailing .0", () => {
      expect(parseUnits("5.0", 0)).toBeUndefined();
      expect(parseUnits("5.5", 0)).toBeUndefined();
    });
  });

  describe("decimals = 6 (an arbitrary non-18 precision)", () => {
    it("right-pads a shorter fractional part with zeros", () => {
      expect(parseUnits("1.5", 6)).toBe("1500000");
    });

    it("accepts the exact fractional digit boundary", () => {
      expect(parseUnits("0.000001", 6)).toBe("1");
    });

    it("rejects one digit beyond the boundary", () => {
      expect(parseUnits("0.0000001", 6)).toBeUndefined();
    });
  });

  describe("invalid decimals (defensive: malformed catalog/entity data)", () => {
    it("returns undefined for a negative decimals value", () => {
      expect(parseUnits("1", -1)).toBeUndefined();
    });

    it("returns undefined for a non-integer decimals value", () => {
      expect(parseUnits("1", 1.5)).toBeUndefined();
    });
  });

  describe("malformed amount input (independent of decimals)", () => {
    it("returns undefined for an empty string", () => {
      expect(parseUnits("", 18)).toBeUndefined();
    });

    it("returns undefined for whitespace-only input", () => {
      expect(parseUnits("   ", 18)).toBeUndefined();
    });

    it("returns undefined for non-numeric input", () => {
      expect(parseUnits("abc", 18)).toBeUndefined();
    });

    it("returns undefined for a negative amount", () => {
      expect(parseUnits("-1", 18)).toBeUndefined();
    });

    it("returns undefined for exponential notation", () => {
      expect(parseUnits("1e18", 18)).toBeUndefined();
    });

    it("returns undefined for a comma decimal separator", () => {
      expect(parseUnits("1,5", 18)).toBeUndefined();
    });

    it("returns undefined for a hex string", () => {
      expect(parseUnits("0x1", 18)).toBeUndefined();
    });

    it("trims surrounding whitespace", () => {
      expect(parseUnits("  1.5  ", 6)).toBe("1500000");
    });
  });

  describe("large values (no precision loss beyond Number safe integer range)", () => {
    it("handles a large whole amount without precision loss", () => {
      expect(parseUnits("123456789012.5", 18)).toBe(
        "123456789012500000000000000000",
      );
    });
  });

  describe("decimals greater than 18 (high-precision token)", () => {
    it("scales a whole number by the full high-precision factor", () => {
      expect(parseUnits("1", 24)).toBe("1000000000000000000000000");
    });

    it("accepts a fractional value up to the exact high-decimals boundary", () => {
      // 24桁ちょうどの最小単位（1）を表現できる。
      expect(parseUnits("0.000000000000000000000001", 24)).toBe("1");
    });

    it("rejects one digit beyond the high-decimals boundary", () => {
      expect(parseUnits("0.0000000000000000000000001", 24)).toBeUndefined();
    });
  });

  describe("boundary shapes of otherwise-valid decimal input", () => {
    it("accepts a bare zero fractional part sized to decimals (1.000000 at 6 decimals)", () => {
      expect(parseUnits("1.000000", 6)).toBe("1000000");
    });

    it("treats a fractional zero as zero at the boundary (0.000000 == 0 at 6 decimals)", () => {
      expect(parseUnits("0.000000", 6)).toBe("0");
    });

    it("rejects a trailing decimal point with no fractional digits", () => {
      expect(parseUnits("1.", 6)).toBeUndefined();
    });

    it("rejects a leading decimal point with no whole part", () => {
      expect(parseUnits(".5", 6)).toBeUndefined();
    });

    it("rejects an explicit plus sign", () => {
      expect(parseUnits("+1", 18)).toBeUndefined();
    });
  });
});
