import { describe, expect, it } from "vitest";
import { formatUnits } from "./tokenAmount.js";

describe("formatUnits", () => {
  it("formats a whole-number amount with 18 decimals (ETH-equivalent precision)", () => {
    expect(formatUnits((5n * 10n ** 18n).toString(), 18)).toBe("5.0000");
  });

  it("formats a fractional amount with 18 decimals", () => {
    expect(formatUnits((1_500_000_000_000_000_000n).toString(), 18)).toBe(
      "1.5000",
    );
  });

  it("formats with a smaller decimals value (e.g. a token with 6 decimals, like USDC)", () => {
    // 1234.5 with 6 decimals => 1234500000
    expect(formatUnits("1234500000", 6)).toBe("1234.5000");
  });

  it("caps the shown fraction digits at the token's own decimals precision", () => {
    // decimals=2 shouldn't be zero-padded out to 4 fraction digits.
    expect(formatUnits("12345", 2)).toBe("123.45");
  });

  it("omits the decimal point entirely when decimals is 0", () => {
    expect(formatUnits("42", 0)).toBe("42");
  });

  it("respects a custom fractionDigits argument smaller than decimals", () => {
    expect(formatUnits((1_234_567_000_000_000_000n).toString(), 18, 2)).toBe(
      "1.23",
    );
  });

  it("omits the decimal point entirely when fractionDigits is 0", () => {
    // Regression: fracShown becomes empty, and the dot must be omitted with it
    // (a bare "1." must never be produced).
    expect(formatUnits((1_500_000_000_000_000_000n).toString(), 18, 0)).toBe(
      "1",
    );
  });

  it("clamps a negative fractionDigits to 0 (integer display)", () => {
    // Regression: a negative slice end would otherwise cut from the string's
    // end and leak a partial fraction (e.g. 16 of 18 digits).
    expect(formatUnits((1_500_000_000_000_000_000n).toString(), 18, -2)).toBe(
      "1",
    );
  });

  it("handles negative amounts", () => {
    expect(formatUnits((-(10n ** 18n)).toString(), 18)).toBe("-1.0000");
  });

  it("returns the input unchanged when it cannot be parsed as an integer", () => {
    expect(formatUnits("not-a-number", 18)).toBe("not-a-number");
  });

  it("returns the input unchanged when decimals is negative (invalid metadata)", () => {
    expect(formatUnits("1000", -1)).toBe("1000");
  });

  it("returns the input unchanged when decimals is not an integer (invalid metadata)", () => {
    expect(formatUnits("1000", 1.5)).toBe("1000");
  });

  it("formats zero", () => {
    expect(formatUnits("0", 18)).toBe("0.0000");
  });

  it("formats a uint256-max-sized amount without precision loss (BigInt path)", () => {
    // 2^256 - 1 wei with 18 decimals. Number-based math would lose precision
    // here; BigInt must reproduce every integer digit exactly.
    const max = (2n ** 256n - 1n).toString();
    expect(formatUnits(max, 18)).toBe(
      "115792089237316195423570985008687907853269984665640564039457.5840",
    );
  });

  it("zero-pads the fraction when the amount has fewer digits than decimals", () => {
    // 123 with 4 decimals is 0.0123 — the raw digits must be left-padded to the
    // full decimals width before the leading fraction digits are taken.
    expect(formatUnits("123", 4)).toBe("0.0123");
  });

  it("shows 0.0000 when the amount is below the displayed fraction precision", () => {
    // 5 wei with 18 decimals is 0.000000000000000005 — smaller than 4 shown
    // fraction digits, so it renders as 0.0000 (not the input unchanged).
    expect(formatUnits("5", 18)).toBe("0.0000");
  });

  it("handles decimals greater than 18 (high-precision token)", () => {
    expect(formatUnits((10n ** 24n).toString(), 24)).toBe("1.0000");
    // A fractional value at 24 decimals: 1.5 * 10^24.
    expect(formatUnits((15n * 10n ** 23n).toString(), 24)).toBe("1.5000");
  });

  it("truncates rather than rounds the shown fraction digits", () => {
    // 1.999990000... must render as 1.9999, never rounded up to 2.0000.
    expect(formatUnits("1999990000000000000", 18)).toBe("1.9999");
  });

  it("treats an empty string as zero (BigInt('') === 0n), documenting current behavior", () => {
    // Note: BigInt("") is 0n, so an empty amount is NOT returned unchanged; it
    // formats as zero. Guards against a silent change to this parsing behavior.
    expect(formatUnits("", 18)).toBe("0.0000");
  });

  it("returns the input unchanged for a decimal (non-integer) amount string", () => {
    // "1.5" is not a valid BigInt literal, so the fallback returns it verbatim.
    expect(formatUnits("1.5", 18)).toBe("1.5");
  });
});
