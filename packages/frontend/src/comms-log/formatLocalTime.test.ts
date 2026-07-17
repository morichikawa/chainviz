import { describe, expect, it } from "vitest";
import { formatLocalTime } from "./formatLocalTime.js";

// ホストのタイムゾーンに依存する関数のため、期待値も同じ `Date` API
// （getHours/getMinutes/getSeconds）から組み立てる。実行環境のTZが
// 何であっても、この関数の桁揃え・区切りのロジック自体を検証できる。
function expectedFrom(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

describe("formatLocalTime", () => {
  it("zero-pads single-digit hours/minutes/seconds", () => {
    const date = new Date(2024, 0, 1, 3, 5, 9);
    expect(formatLocalTime(date.getTime())).toBe(expectedFrom(date));
    expect(formatLocalTime(date.getTime())).toBe("03:05:09");
  });

  it("does not pad already-2-digit components", () => {
    const date = new Date(2024, 0, 1, 23, 59, 58);
    expect(formatLocalTime(date.getTime())).toBe(expectedFrom(date));
    expect(formatLocalTime(date.getTime())).toBe("23:59:58");
  });

  it("handles midnight", () => {
    const date = new Date(2024, 0, 1, 0, 0, 0);
    expect(formatLocalTime(date.getTime())).toBe("00:00:00");
  });
});
