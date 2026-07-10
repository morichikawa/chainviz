import { describe, expect, it } from "vitest";
import type { OperationArgField } from "../chain-profiles/ethereum/operationCatalog.js";
import {
  isValidOperationArgValue,
  validateOperationArgs,
} from "./operationArgValidation.js";

describe("isValidOperationArgValue (Issue #209)", () => {
  describe("uint", () => {
    it("accepts non-negative integers", () => {
      expect(isValidOperationArgValue("uint", "0")).toBe(true);
      expect(isValidOperationArgValue("uint", "42")).toBe(true);
      expect(isValidOperationArgValue("uint", "1000000000000000000000000")).toBe(
        true,
      );
    });

    it("accepts leading zeros", () => {
      expect(isValidOperationArgValue("uint", "007")).toBe(true);
    });

    it("rejects the reported bug reproduction values (non-numeric text)", () => {
      expect(isValidOperationArgValue("uint", "test")).toBe(false);
      expect(isValidOperationArgValue("uint", "sss")).toBe(false);
    });

    it("rejects empty/blank input", () => {
      expect(isValidOperationArgValue("uint", "")).toBe(false);
      expect(isValidOperationArgValue("uint", "   ")).toBe(false);
    });

    it("rejects negative numbers, decimals, and exponent notation", () => {
      expect(isValidOperationArgValue("uint", "-1")).toBe(false);
      expect(isValidOperationArgValue("uint", "1.5")).toBe(false);
      expect(isValidOperationArgValue("uint", "1e18")).toBe(false);
    });

    it("rejects a value with surrounding non-digit characters", () => {
      expect(isValidOperationArgValue("uint", "42abc")).toBe(false);
      expect(isValidOperationArgValue("uint", "0x1")).toBe(false);
    });

    it("trims surrounding whitespace before checking", () => {
      expect(isValidOperationArgValue("uint", "  42  ")).toBe(true);
    });

    it("rejects an explicit plus sign", () => {
      expect(isValidOperationArgValue("uint", "+42")).toBe(false);
    });

    it("rejects whitespace embedded between digits (only surrounding whitespace is trimmed)", () => {
      expect(isValidOperationArgValue("uint", "1 000")).toBe(false);
      expect(isValidOperationArgValue("uint", "1\t000")).toBe(false);
    });

    it("rejects full-width digits (only ASCII 0-9 count)", () => {
      // 全角数字は forge のパーサーも受け付けないため送信前に弾く。
      expect(isValidOperationArgValue("uint", "４２")).toBe(false);
    });

    it("accepts an extremely long digit string (no upper bound is enforced here)", () => {
      // 上限は設けない設計（BigInt 範囲判定は collector 側のエンコードに委ねる）。
      expect(isValidOperationArgValue("uint", "9".repeat(100))).toBe(true);
    });
  });

  describe("address", () => {
    it("accepts a 0x + 40 hex digit address", () => {
      expect(
        isValidOperationArgValue(
          "address",
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
      ).toBe(true);
    });

    it("accepts mixed-case hex digits (no EIP-55 checksum enforcement)", () => {
      expect(
        isValidOperationArgValue(
          "address",
          "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
        ),
      ).toBe(true);
    });

    it("rejects addresses with the wrong digit count", () => {
      expect(isValidOperationArgValue("address", "0x1234")).toBe(false);
      expect(
        isValidOperationArgValue(
          "address",
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
      ).toBe(false);
    });

    it("rejects a value missing the 0x prefix", () => {
      expect(
        isValidOperationArgValue(
          "address",
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
      ).toBe(false);
    });

    it("rejects non-hex characters", () => {
      expect(
        isValidOperationArgValue(
          "address",
          "0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        ),
      ).toBe(false);
    });

    it("rejects empty/blank input", () => {
      expect(isValidOperationArgValue("address", "")).toBe(false);
      expect(isValidOperationArgValue("address", "   ")).toBe(false);
    });

    it("rejects an uppercase 0X prefix (only lowercase 0x is accepted)", () => {
      expect(
        isValidOperationArgValue(
          "address",
          "0Xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
      ).toBe(false);
    });

    it("rejects whitespace embedded inside an otherwise valid address", () => {
      expect(
        isValidOperationArgValue(
          "address",
          "0xaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaa",
        ),
      ).toBe(false);
    });

    it("trims surrounding whitespace before checking", () => {
      expect(
        isValidOperationArgValue(
          "address",
          "  0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  ",
        ),
      ).toBe(true);
    });
  });

  describe("string / bool (out of scope for Issue #209, always valid)", () => {
    it("accepts any value, including empty, for string", () => {
      expect(isValidOperationArgValue("string", "")).toBe(true);
      expect(isValidOperationArgValue("string", "anything")).toBe(true);
    });

    it("accepts any value, including empty, for bool", () => {
      expect(isValidOperationArgValue("bool", "")).toBe(true);
      expect(isValidOperationArgValue("bool", "true")).toBe(true);
    });
  });
});

describe("validateOperationArgs", () => {
  it("returns true when every field's value matches its ABI type", () => {
    const fields: OperationArgField[] = [
      { name: "to", type: "address" },
      { name: "amount", type: "uint" },
    ];
    expect(
      validateOperationArgs(fields, [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "100",
      ]),
    ).toBe(true);
  });

  it("returns false when any single field is invalid", () => {
    const fields: OperationArgField[] = [
      { name: "to", type: "address" },
      { name: "amount", type: "uint" },
    ];
    expect(
      validateOperationArgs(fields, [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "not-a-number",
      ]),
    ).toBe(false);
  });

  it("returns true for an empty field list regardless of values", () => {
    expect(validateOperationArgs([], [])).toBe(true);
  });

  it("treats a missing value (values shorter than fields) as an empty string", () => {
    const fields: OperationArgField[] = [{ name: "amount", type: "uint" }];
    expect(validateOperationArgs(fields, [])).toBe(false);
  });

  it("detects an invalid value in a later field (not just the first)", () => {
    const fields: OperationArgField[] = [
      { name: "amount", type: "uint" },
      { name: "to", type: "address" },
    ];
    expect(validateOperationArgs(fields, ["100", "0xbob"])).toBe(false);
  });

  it("ignores extra values beyond the field count (values longer than fields)", () => {
    const fields: OperationArgField[] = [{ name: "amount", type: "uint" }];
    expect(validateOperationArgs(fields, ["100", "leftover", "junk"])).toBe(true);
  });

  it("treats out-of-scope string/bool fields as always valid even when other fields are invalid gates the result", () => {
    const fields: OperationArgField[] = [
      { name: "label", type: "string" },
      { name: "amount", type: "uint" },
    ];
    expect(validateOperationArgs(fields, ["anything", "100"])).toBe(true);
    expect(validateOperationArgs(fields, ["anything", "nope"])).toBe(false);
  });
});
