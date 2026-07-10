import { describe, expect, it } from "vitest";
import { describeNodeRole, nodeShowsSyncState } from "./nodeRoles.js";

describe("describeNodeRole", () => {
  it("resolves execution to an EL client descriptor with sync state shown", () => {
    expect(describeNodeRole("execution")).toEqual({
      label: { ja: "実行クライアント", en: "Execution client" },
      glossaryKey: "el-client",
      showsSyncState: true,
    });
  });

  it("resolves consensus to a CL client descriptor with sync state shown", () => {
    expect(describeNodeRole("consensus")).toEqual({
      label: { ja: "コンセンサスクライアント", en: "Consensus client" },
      glossaryKey: "cl-client",
      showsSyncState: true,
    });
  });

  it("resolves validator to a descriptor with sync state hidden", () => {
    expect(describeNodeRole("validator")).toEqual({
      label: { ja: "バリデーター", en: "Validator" },
      glossaryKey: "validator",
      showsSyncState: false,
    });
  });

  it("returns undefined for an unmapped value (future/unknown chain profile value)", () => {
    expect(describeNodeRole("sequencer")).toBeUndefined();
  });

  it("returns undefined for undefined (unlabeled container, legacy snapshot)", () => {
    expect(describeNodeRole(undefined)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(describeNodeRole("")).toBeUndefined();
  });

  it("is case-sensitive (does not normalize casing)", () => {
    expect(describeNodeRole("Execution")).toBeUndefined();
  });
});

describe("nodeShowsSyncState", () => {
  it("is true for execution", () => {
    expect(nodeShowsSyncState("execution")).toBe(true);
  });

  it("is true for consensus", () => {
    expect(nodeShowsSyncState("consensus")).toBe(true);
  });

  it("is false for validator", () => {
    expect(nodeShowsSyncState("validator")).toBe(false);
  });

  it("defaults to true (current display preserved) for an unmapped value", () => {
    expect(nodeShowsSyncState("sequencer")).toBe(true);
  });

  it("defaults to true for undefined (unlabeled container, legacy snapshot)", () => {
    expect(nodeShowsSyncState(undefined)).toBe(true);
  });
});
