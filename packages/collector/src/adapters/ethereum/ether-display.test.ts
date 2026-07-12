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

describe("formatWeiAsEther / truncation boundary (never rounds)", () => {
  it("truncates when the 7th fractional digit is exactly 5 (no round-half-up)", () => {
    // 0.1234565 ETH。四捨五入なら7桁目の 5 で 0.123457 に繰り上がるが、
    // 切り捨て仕様なので 0.123456 のまま。丸めモードの取り違えを検出する。
    expect(formatWeiAsEther("123456500000000000")).toBe("0.123456");
  });

  it("truncates when the 7th fractional digit is greater than 5 (no round-up)", () => {
    // 0.1234569 ETH。7桁目が 9 でも繰り上げない。
    expect(formatWeiAsEther("123456900000000000")).toBe("0.123456");
  });

  it("keeps the 6th fractional digit intact when it is significant", () => {
    // ちょうど6桁目まで有効な値。6桁目 (=6) を落とさないことを確認する。
    expect(formatWeiAsEther("123456000000000000")).toBe("0.123456");
  });

  it("shows exactly 1e-6 ETH (the smallest representable non-zero fraction)", () => {
    // 1e12 wei = 0.000001 ETH。6桁表示のちょうど下限。末尾ゼロ削りが
    // ここまでの先頭ゼロを消さないことも兼ねて確認する。
    expect(formatWeiAsEther("1000000000000")).toBe("0.000001");
  });
});

describe("formatWeiAsEther / magnitude boundaries", () => {
  it("collapses a single wei (below 1e-6 ETH) to 0.0", () => {
    // 1 wei は表示可能な最小桁 (1e-6 ETH) を下回るため 0.0 に潰れる。
    // これは worklog の「6桁の根拠」で許容と明記された既知の挙動。
    expect(formatWeiAsEther("1")).toBe("0.0");
  });

  it("collapses a sub-1e-6 ETH amount (999999999999 wei) to 0.0", () => {
    // 1e12 wei に 1 足りない値。6桁表示では 0.000000... となり 0.0 に潰れる。
    expect(formatWeiAsEther("999999999999")).toBe("0.0");
  });

  it("formats the maximum uint256 value without precision loss", () => {
    // 2^256 - 1 wei。BigInt 計算なので Number の丸め誤差が入らないことを、
    // 78桁の整数部と 6桁の小数部が正確に出ることで確認する。
    const uint256Max = (2n ** 256n - 1n).toString();
    expect(formatWeiAsEther(uint256Max)).toBe(
      "115792089237316195423570985008687907853269984665640564039457.584007",
    );
  });

  it("truncates the fractional part of a very large negative value", () => {
    expect(formatWeiAsEther("-999999999999999999999999999999999")).toBe(
      "-999999999999999.999999",
    );
  });
});

describe("formatWeiAsEther / trailing-zero trimming", () => {
  it("trims an all-zero fractional part down to a single zero (1.000000 -> 1.0)", () => {
    expect(formatWeiAsEther("1000000000000000000")).toBe("1.0");
  });

  it("trims a partially-zero fractional part (1.100000 -> 1.1)", () => {
    expect(formatWeiAsEther("1100000000000000000")).toBe("1.1");
  });

  it("preserves interior zeros while trimming only trailing zeros (1.010000 -> 1.01)", () => {
    // 内側のゼロ (1.01 の 0) まで削ってはならない。/0+$/ の $ 固定を検証する。
    expect(formatWeiAsEther("1010000000000000000")).toBe("1.01");
  });

  it("keeps a leading zero in the fraction while trimming the trailing zeros (0.000100 -> 0.0001)", () => {
    expect(formatWeiAsEther("100000000000000")).toBe("0.0001");
  });
});

describe("formatWeiAsEther / BigInt parsing edge cases", () => {
  // BigInt() が受け付ける文字列は、実運用の wei（10進整数）以外にも
  // 空文字列・符号付き・16進・前後空白がある。ここではフォールバック
  // （入力をそのまま返す）に落ちる入力と、BigInt が解釈して数値化する
  // 入力を区別し、想定外の入力でも throw しないことを網羅的に確認する。

  it("treats an empty string as zero (BigInt('') is 0n, not a parse error)", () => {
    // 空文字列はフォールバックではなく BigInt により 0n に解釈される。
    expect(formatWeiAsEther("")).toBe("0.0");
  });

  it("treats a whitespace-only string as zero", () => {
    expect(formatWeiAsEther("   ")).toBe("0.0");
  });

  it("parses a hex string (BigInt accepts 0x-prefixed) rather than falling back", () => {
    // 0xff = 255 wei（1e-6 ETH 未満）→ 0.0。実運用の geth は10進 wei しか
    // 出さないが、\S+ 正規表現が理論上拾いうる 16進でも throw しないことを確認。
    expect(formatWeiAsEther("0xff")).toBe("0.0");
  });

  it("parses a leading-plus-sign string as a positive value", () => {
    expect(formatWeiAsEther("+1000000000000000000")).toBe("1.0");
  });

  it("parses a value surrounded by whitespace (BigInt trims it)", () => {
    expect(formatWeiAsEther("  1000000000000000000  ")).toBe("1.0");
  });

  it("falls back for a lone minus sign", () => {
    expect(formatWeiAsEther("-")).toBe("-");
  });

  it("falls back for scientific notation (BigInt rejects '1e18')", () => {
    expect(formatWeiAsEther("1e18")).toBe("1e18");
  });

  it("falls back for a numeric-separator underscore string ('1_000')", () => {
    // JS の数値リテラルでは 1_000 が使えるが BigInt(string) は拒否する。
    expect(formatWeiAsEther("1_000")).toBe("1_000");
  });

  it("falls back for an empty-after-sign / garbage suffix ('100abc')", () => {
    expect(formatWeiAsEther("100abc")).toBe("100abc");
  });
});
