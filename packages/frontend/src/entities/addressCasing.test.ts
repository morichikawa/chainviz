import { describe, expect, it } from "vitest";
import { buildLowerCaseIndex, resolvePresentId } from "./addressCasing.js";

describe("resolvePresentId", () => {
  it("returns the present-side representation for an exact match", () => {
    expect(resolvePresentId("0xabc", new Set(["0xabc"]))).toBe("0xabc");
  });

  it("matches case-insensitively and returns the present-side casing", () => {
    expect(resolvePresentId("0xabc", new Set(["0xABC"]))).toBe("0xABC");
  });

  it("returns undefined when no candidate matches even case-insensitively", () => {
    expect(resolvePresentId("0xabc", new Set(["0xdef"]))).toBeUndefined();
  });

  it("returns undefined for an empty present set", () => {
    expect(resolvePresentId("0xabc", new Set())).toBeUndefined();
  });

  it("accepts a plain iterable (not just a Set)", () => {
    expect(resolvePresentId("0xabc", ["0xABC", "0xdef"])).toBe("0xABC");
  });
});

describe("buildLowerCaseIndex", () => {
  it("maps each lower-cased id to its original representation", () => {
    const index = buildLowerCaseIndex(["0xABC", "0xDef"]);
    expect(index.get("0xabc")).toBe("0xABC");
    expect(index.get("0xdef")).toBe("0xDef");
  });

  it("returns an empty map for an empty iterable", () => {
    expect(buildLowerCaseIndex([]).size).toBe(0);
  });

  it("keeps the last representation when duplicates differ only by case", () => {
    const index = buildLowerCaseIndex(["0xABC", "0xAbC", "0xabc"]);
    expect(index.get("0xabc")).toBe("0xabc");
    expect(index.size).toBe(1);
  });
});
