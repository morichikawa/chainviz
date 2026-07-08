import { describe, expect, it } from "vitest";
import { parseEtherToWei } from "./etherAmount.js";

describe("parseEtherToWei", () => {
  it("converts a whole-number ETH amount to wei", () => {
    expect(parseEtherToWei("1")).toBe("1000000000000000000");
  });

  it("converts a fractional ETH amount to wei", () => {
    expect(parseEtherToWei("0.5")).toBe("500000000000000000");
  });

  it("converts an amount with fewer than 18 fractional digits (right-pads with zeros)", () => {
    expect(parseEtherToWei("0.001")).toBe("1000000000000000");
  });

  it("converts an amount with exactly 18 fractional digits (wei precision)", () => {
    expect(parseEtherToWei("0.000000000000000001")).toBe("1");
  });

  it("converts zero", () => {
    expect(parseEtherToWei("0")).toBe("0");
  });

  it("handles large whole amounts without precision loss (beyond Number safe integer range)", () => {
    expect(parseEtherToWei("123456789012.5")).toBe(
      "123456789012500000000000000000",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(parseEtherToWei("  1.5  ")).toBe("1500000000000000000");
  });

  it("returns undefined for an empty string", () => {
    expect(parseEtherToWei("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only input", () => {
    expect(parseEtherToWei("   ")).toBeUndefined();
  });

  it("returns undefined for non-numeric input", () => {
    expect(parseEtherToWei("abc")).toBeUndefined();
  });

  it("returns undefined for a negative amount", () => {
    expect(parseEtherToWei("-1")).toBeUndefined();
  });

  it("returns undefined for exponential notation", () => {
    expect(parseEtherToWei("1e18")).toBeUndefined();
  });

  it("returns undefined for more than 18 fractional digits (sub-wei precision)", () => {
    expect(parseEtherToWei("0.0000000000000000001")).toBeUndefined();
  });

  it("returns undefined for multiple decimal points", () => {
    expect(parseEtherToWei("1.2.3")).toBeUndefined();
  });

  it("returns undefined for a trailing decimal point with no digits", () => {
    expect(parseEtherToWei("1.")).toBeUndefined();
  });

  it("returns undefined for a leading decimal point with no whole part", () => {
    expect(parseEtherToWei(".5")).toBeUndefined();
  });

  it("accepts leading zeros in the whole part (007 == 7 ETH)", () => {
    expect(parseEtherToWei("007")).toBe("7000000000000000000");
  });

  it("accepts redundant leading zeros before a fractional part (00.5 == 0.5)", () => {
    expect(parseEtherToWei("00.5")).toBe("500000000000000000");
  });

  it("treats a fractional zero as zero (0.0 == 0)", () => {
    expect(parseEtherToWei("0.0")).toBe("0");
  });

  it("ignores trailing zeros in the fractional part (1.50 == 1.5)", () => {
    expect(parseEtherToWei("1.50")).toBe("1500000000000000000");
  });

  it("converts the max fractional precision combined with a whole part without loss", () => {
    // 18桁ちょうどの小数部 + 整数部が同時に来ても桁落ちしない（境界の合わせ技）。
    expect(parseEtherToWei("2.000000000000000001")).toBe("2000000000000000001");
  });

  it("returns undefined for an explicit plus sign", () => {
    expect(parseEtherToWei("+1")).toBeUndefined();
  });

  it("returns undefined for internal whitespace between digits", () => {
    expect(parseEtherToWei("1 5")).toBeUndefined();
  });

  it("returns undefined for a comma decimal separator", () => {
    expect(parseEtherToWei("1,5")).toBeUndefined();
  });

  it("returns undefined for a thousands-separated number", () => {
    expect(parseEtherToWei("1,000")).toBeUndefined();
  });

  it("returns undefined for a hex string even though it starts with a digit", () => {
    expect(parseEtherToWei("0x1")).toBeUndefined();
  });
});
