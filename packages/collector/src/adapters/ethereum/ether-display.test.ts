import { describe, expect, it } from "vitest";
import { formatWeiAsEther } from "./ether-display.js";

describe("formatWeiAsEther", () => {
  it("formats a whole-ETH amount with a single trailing zero (not a bare integer)", () => {
    expect(formatWeiAsEther("1000000000000000000")).toBe("1.0");
  });

  it("keeps a full 6-digit fraction without trimming when none of it is zero", () => {
    expect(formatWeiAsEther("1500123000000000000")).toBe("1.500123");
  });

  it("truncates (does not round) fractional digits beyond the 6-digit limit", () => {
    // 小数部は 0.123456999999999999...。7桁目以降の 9999... を四捨五入して
    // 1.123457 に繰り上げず、切り捨てて 1.123456 のままであることを確認する。
    expect(formatWeiAsEther("1123456999999999999")).toBe("1.123456");
  });

  it("trims multiple trailing zeros in the fractional part but keeps at least one digit", () => {
    expect(formatWeiAsEther("2100000000000000000")).toBe("2.1");
  });

  it("formats a zero amount as 0.0", () => {
    expect(formatWeiAsEther("0")).toBe("0.0");
  });

  it("formats a negative amount preserving the sign", () => {
    expect(formatWeiAsEther("-1000000000000000000")).toBe("-1.0");
  });

  it("matches the issue's real-world example for the 'have' value", () => {
    expect(formatWeiAsEther("1000000000000000000000000000")).toBe("1000000000.0");
  });

  it("matches the issue's real-world example for the 'need' value", () => {
    expect(formatWeiAsEther("999999999999999999999999999999999")).toBe(
      "999999999999999.999999",
    );
  });

  it("falls back to the raw input when it cannot be parsed as a BigInt", () => {
    expect(formatWeiAsEther("not-a-number")).toBe("not-a-number");
  });

  it("falls back to the raw input for a decimal (non-integer) string", () => {
    // BigInt() は小数文字列を拒否する（"1.5" のような値は wei として
    // 想定していないが、想定外の入力でも throw しないことを確認する）。
    expect(formatWeiAsEther("1.5")).toBe("1.5");
  });
});
