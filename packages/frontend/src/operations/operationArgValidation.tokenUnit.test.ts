import { describe, expect, it } from "vitest";
import type { OperationArgField } from "../chain-profiles/ethereum/operationCatalog.js";
import {
  convertOperationArgsToChainValues,
  validateOperationArgs,
} from "./operationArgValidation.js";

/**
 * `unit: "token"` の引数（Issue #219: トークン量の単位換算）に関する
 * `validateOperationArgs`/`convertOperationArgsToChainValues` のテスト。
 * ABI型そのものの検証（#209）は `operationArgValidation.test.ts` が担う。
 */

const AMOUNT_FIELD: OperationArgField = { name: "amount", type: "uint", unit: "token" };
const TO_FIELD: OperationArgField = { name: "to", type: "address" };

describe("validateOperationArgs with a token-unit field", () => {
  it("accepts a decimal token-unit amount when decimals are provided", () => {
    expect(validateOperationArgs([AMOUNT_FIELD], ["1.5"], 18)).toBe(true);
  });

  it("rejects an amount with more fractional digits than the token's decimals", () => {
    expect(validateOperationArgs([AMOUNT_FIELD], ["1.0000000000000000001"], 18)).toBe(
      false,
    );
  });

  it("rejects a token-unit field when tokenDecimals is not provided (unresolvable decimals)", () => {
    expect(validateOperationArgs([AMOUNT_FIELD], ["1.5"])).toBe(false);
  });

  it("rejects a non-numeric value even when tokenDecimals is provided", () => {
    expect(validateOperationArgs([AMOUNT_FIELD], ["test"], 18)).toBe(false);
  });

  it("validates a mix of a token-unit field and a plain ABI-typed field together", () => {
    const fields = [TO_FIELD, AMOUNT_FIELD];
    expect(
      validateOperationArgs(
        fields,
        ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "2.5"],
        18,
      ),
    ).toBe(true);
    expect(
      validateOperationArgs(fields, ["0xbob", "2.5"], 18),
    ).toBe(false);
  });
});

describe("convertOperationArgsToChainValues", () => {
  it("converts a token-unit arg's value to the minimal unit and leaves other args untouched", () => {
    const fields = [TO_FIELD, AMOUNT_FIELD];
    const converted = convertOperationArgsToChainValues(
      fields,
      ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1.5"],
      18,
    );
    expect(converted).toEqual([
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "1500000000000000000",
    ]);
  });

  it("leaves non-token fields (no unit) as raw strings", () => {
    const fields: OperationArgField[] = [{ name: "amount", type: "uint" }];
    expect(convertOperationArgsToChainValues(fields, ["1000"])).toEqual(["1000"]);
  });

  it("falls back to the raw value for a token-unit arg when tokenDecimals is missing", () => {
    // 呼び出し側が validateOperationArgs を経ずに呼んだ防御的なケース。
    expect(convertOperationArgsToChainValues([AMOUNT_FIELD], ["1.5"])).toEqual(["1.5"]);
  });

  it("falls back to the raw value for a malformed token-unit amount instead of throwing", () => {
    expect(convertOperationArgsToChainValues([AMOUNT_FIELD], ["not-a-number"], 18)).toEqual(
      ["not-a-number"],
    );
  });

  it("treats a missing value (values shorter than fields) as an empty string, not a crash", () => {
    expect(convertOperationArgsToChainValues([AMOUNT_FIELD], [], 18)).toEqual([""]);
  });

  it("converts every token-unit field independently when several appear together", () => {
    // 同じ decimals で複数のトークン単位引数が並ぶケース（各要素が個別に換算
    // され、取り違えたり最初の1つだけ換算したりしないこと）。
    const fields: OperationArgField[] = [AMOUNT_FIELD, TO_FIELD, AMOUNT_FIELD];
    expect(
      convertOperationArgsToChainValues(
        fields,
        ["1.5", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0.25"],
        18,
      ),
    ).toEqual([
      "1500000000000000000",
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "250000000000000000",
    ]);
  });

  it("ignores extra values beyond the fields (output length follows fields, not values)", () => {
    // values が fields より長い防御的なケース。余分な値は出力に現れない。
    const converted = convertOperationArgsToChainValues(
      [AMOUNT_FIELD],
      ["1.5", "0xdeadbeef-ignored"],
      18,
    );
    expect(converted).toEqual(["1500000000000000000"]);
  });

  it("uses the field's own type, not positional heuristics, to decide what to convert (address before token)", () => {
    // address 引数が先、token 引数が後、という並びでも、変換対象は unit で
    // 判定される（位置ではない）ことを念のため固定する。
    const fields = [TO_FIELD, AMOUNT_FIELD];
    expect(
      convertOperationArgsToChainValues(
        fields,
        ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "3"],
        6,
      ),
    ).toEqual(["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "3000000"]);
  });
});

describe("validateOperationArgs with several token-unit fields", () => {
  it("rejects the whole set if any one token-unit field is invalid", () => {
    const fields: OperationArgField[] = [AMOUNT_FIELD, AMOUNT_FIELD];
    // 1つ目は妥当、2つ目が decimals 超過。全体としては無効。
    expect(
      validateOperationArgs(fields, ["1.5", "1.0000000000000000001"], 18),
    ).toBe(false);
  });

  it("accepts the set when every token-unit field is individually valid", () => {
    const fields: OperationArgField[] = [AMOUNT_FIELD, AMOUNT_FIELD];
    expect(validateOperationArgs(fields, ["1.5", "0.25"], 18)).toBe(true);
  });
});
