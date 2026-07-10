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
});
