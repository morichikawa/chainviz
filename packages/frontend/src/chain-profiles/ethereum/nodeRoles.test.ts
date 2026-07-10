import { describe, expect, it } from "vitest";
import {
  NODE_ROLE_DESCRIPTORS,
  describeNodeRole,
  nodeShowsSyncState,
} from "./nodeRoles.js";

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

  it("does not trim surrounding whitespace (raw label match only)", () => {
    // collector 側のラベル正規化に依存せず、フロントは生値を厳密一致で引く。
    // 空白付きの値は「未知」に倒れる（役割表示なしのフォールバック）。
    expect(describeNodeRole(" execution")).toBeUndefined();
    expect(describeNodeRole("execution ")).toBeUndefined();
    expect(describeNodeRole("exec ution")).toBeUndefined();
  });
});

describe("NODE_ROLE_DESCRIPTORS shape invariants", () => {
  // 表現セットの各エントリが「両言語のラベル・glossaryKey・showsSyncState」を
  // 漏れなく持つことを固定する（将来ロールを増やしたとき片方の言語やアンカーを
  // 付け忘れると、カード/ポップオーバーが空ラベルや無効アンカーを描いてしまう）。
  it("has a fully-populated descriptor for every mapped role", () => {
    for (const [role, descriptor] of Object.entries(NODE_ROLE_DESCRIPTORS)) {
      expect(descriptor.label.ja, `${role} ja`).toBeTruthy();
      expect(descriptor.label.en, `${role} en`).toBeTruthy();
      expect(descriptor.glossaryKey, `${role} glossaryKey`).toBeTruthy();
      expect(typeof descriptor.showsSyncState, `${role} showsSyncState`).toBe(
        "boolean",
      );
    }
  });

  it("keeps showsSyncState false only for validator among the mapped roles", () => {
    // 「同期する係か」の真実の情報源はこの表。現状 validator だけが false で、
    // 他ロールを追加したときこの前提が崩れたら気付けるようにしておく。
    const noSyncRoles = Object.entries(NODE_ROLE_DESCRIPTORS)
      .filter(([, d]) => d.showsSyncState === false)
      .map(([role]) => role);
    expect(noSyncRoles).toEqual(["validator"]);
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

  it("defaults to true for an empty string (falls back to sync display)", () => {
    expect(nodeShowsSyncState("")).toBe(true);
  });
});
