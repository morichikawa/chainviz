import { describe, expect, it } from "vitest";
import { parseSlotDurationSeconds } from "./slot-time.js";

describe("parseSlotDurationSeconds", () => {
  it("ダブルクォートで囲まれた値を読む", () => {
    expect(parseSlotDurationSeconds('export SLOT_DURATION_IN_SECONDS="12"')).toBe(
      12,
    );
  });

  it("シングルクォートで囲まれた値を読む", () => {
    expect(parseSlotDurationSeconds("export SLOT_DURATION_IN_SECONDS='2'")).toBe(
      2,
    );
  });

  it("クォート無しの値を読む", () => {
    expect(parseSlotDurationSeconds("export SLOT_DURATION_IN_SECONDS=6")).toBe(6);
  });

  it("実際の values.env のように複数行・他キー混在でも該当行を読む", () => {
    const env = [
      "# --- slot time の短縮 ---",
      'export EL_AND_CL_MNEMONIC="test test test"',
      'export SLOT_DURATION_IN_SECONDS="12"',
      'export SLOT_DURATION_MS="12000"',
      'export SECONDS_PER_ETH1_BLOCK="12"',
      "",
    ].join("\n");
    expect(parseSlotDurationSeconds(env)).toBe(12);
  });

  it("行頭にインデントがあっても読む", () => {
    expect(
      parseSlotDurationSeconds('  export SLOT_DURATION_IN_SECONDS="3"'),
    ).toBe(3);
  });

  it("キーが存在しなければ undefined", () => {
    expect(parseSlotDurationSeconds('export OTHER_KEY="12"')).toBeUndefined();
  });

  it("空文字列なら undefined", () => {
    expect(parseSlotDurationSeconds("")).toBeUndefined();
  });

  it("値が数値でなければ undefined", () => {
    expect(
      parseSlotDurationSeconds('export SLOT_DURATION_IN_SECONDS="abc"'),
    ).toBeUndefined();
  });

  it("値が空なら undefined", () => {
    expect(
      parseSlotDurationSeconds('export SLOT_DURATION_IN_SECONDS=""'),
    ).toBeUndefined();
  });

  it("値が 0 なら undefined（0 以下は不正）", () => {
    expect(
      parseSlotDurationSeconds('export SLOT_DURATION_IN_SECONDS="0"'),
    ).toBeUndefined();
  });

  it("値が負なら undefined", () => {
    expect(
      parseSlotDurationSeconds('export SLOT_DURATION_IN_SECONDS="-2"'),
    ).toBeUndefined();
  });

  it("`SLOT_DURATION_IN_SECONDS` を接頭辞に含む別キー（`_MS`）には反応しない", () => {
    // SLOT_DURATION_MS のような別キーだけがある場合、SLOT_DURATION_IN_SECONDS
    // は見つからないので undefined。`=` の直後まで固定して部分一致を防ぐ。
    expect(
      parseSlotDurationSeconds('export SLOT_DURATION_MS="12000"'),
    ).toBeUndefined();
  });

  it("小数の slot time も受理する", () => {
    expect(
      parseSlotDurationSeconds('export SLOT_DURATION_IN_SECONDS="1.5"'),
    ).toBe(1.5);
  });
});
