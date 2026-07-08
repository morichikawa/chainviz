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
});
