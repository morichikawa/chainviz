import { describe, expect, it } from "vitest";
import { describeSyncStage } from "./syncStageLabels.js";

describe("describeSyncStage", () => {
  it("resolves known reth stage names to a localized display name", () => {
    expect(describeSyncStage("Headers")).toEqual({
      ja: "ヘッダ取得",
      en: "Fetch headers",
    });
    expect(describeSyncStage("Execution")).toEqual({
      ja: "実行",
      en: "Execute",
    });
    expect(describeSyncStage("Finish")).toEqual({ ja: "仕上げ", en: "Finish" });
  });

  it("returns undefined for an unmapped stage name (raw name fallback)", () => {
    expect(describeSyncStage("MerkleUnwind")).toBeUndefined();
    expect(describeSyncStage("PruneSenderRecovery")).toBeUndefined();
  });

  it("is an exact match, not a prefix match (unlike engine API method labels)", () => {
    // "Headers" は前方一致すると "HeadersExtra" のような未知の名前まで拾って
    // しまうが、完全一致なのでそれは起きない。
    expect(describeSyncStage("HeadersExtra")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(describeSyncStage("")).toBeUndefined();
  });

  it("does not leak inherited Object.prototype members for prototype-pollution-like values", () => {
    // 回帰テスト(Issue #258。nodeRoles.ts の describeNodeRole (Issue #215)と
    // 同種の穴): SYNC_STAGE_LABELS はオブジェクトリテラルで Object.prototype
    // を継承しているため、ブラケットアクセスだけだと "toString" 等の継承
    // メンバ名を誤って真値として返してしまっていた。Object.hasOwn ガードで
    // 未知値の undefined フォールバックが崩れないことを固定する。
    expect(describeSyncStage("toString")).toBeUndefined();
    expect(describeSyncStage("constructor")).toBeUndefined();
    expect(describeSyncStage("__proto__")).toBeUndefined();
    expect(describeSyncStage("valueOf")).toBeUndefined();
    expect(describeSyncStage("hasOwnProperty")).toBeUndefined();
    expect(describeSyncStage("isPrototypeOf")).toBeUndefined();
  });
});
