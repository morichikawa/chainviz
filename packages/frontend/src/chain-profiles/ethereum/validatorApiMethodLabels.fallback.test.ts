// Issue #420 テスト強化: describeValidatorApiMethod のフォールバック境界と
// ラベルテーブル自体の整合を固定する。正常系（実機で観測された2種の method に
// 対する分類ラベル）は validatorApiMethodLabels.test.ts が持つので、ここは
// 「未知の method（lighthouse 側に新しいメトリクスが増えた場合）」
// 「前方一致の境界」「テーブルのスキーマ整合」に絞る（1ファイル1責務）。

import { describe, expect, it } from "vitest";
import {
  VALIDATOR_API_METHOD_LABELS,
  describeValidatorApiMethod,
} from "./validatorApiMethodLabels.js";

describe("describeValidatorApiMethod: prefix boundaries", () => {
  it("matches the bare metric family name with no status suffix", () => {
    // collector は `<family>:<status>` を組み立てるが、status ラベルが欠けた
    // 出力に対応した場合でも（あるいは将来 method の組み立て方が変わっても）
    // 前方一致は成立する。
    expect(describeValidatorApiMethod("vc_signed_attestations_total")).toEqual({
      ja: "証明（attestation）の署名",
      en: "Sign attestation",
    });
  });

  it("does not match a truncated family name", () => {
    expect(describeValidatorApiMethod("vc_signed_attestations")).toBeUndefined();
    expect(describeValidatorApiMethod("vc_signed")).toBeUndefined();
    expect(describeValidatorApiMethod("vc_")).toBeUndefined();
  });

  it("is case sensitive (does not match an upper-cased metric name)", () => {
    expect(
      describeValidatorApiMethod("VC_SIGNED_ATTESTATIONS_TOTAL:success"),
    ).toBeUndefined();
  });

  it("does not match when the method has leading whitespace", () => {
    // 前方一致なので先頭の空白があると一致しない。生名フォールバックに倒れる
    // （表示は崩れないが分類ラベルは付かない）という現在の挙動を固定する。
    expect(
      describeValidatorApiMethod(" vc_signed_attestations_total:success"),
    ).toBeUndefined();
  });

  it("matches a longer suffix than a single status label", () => {
    expect(
      describeValidatorApiMethod("vc_signed_beacon_blocks_total:success:extra"),
    ).toEqual({ ja: "ブロック提案の署名", en: "Sign proposed block" });
  });
});

describe("describeValidatorApiMethod: metrics outside the current scope", () => {
  it("returns undefined for the VC duty metrics that were deliberately left out of scope", () => {
    // docs/ARCHITECTURE.md §7.6.12「今回のスコープに含めない候補」。将来
    // collector がこれらを配信し始めても、フロントは生名で表示するだけで
    // 壊れないこと（先回りしてラベルを持たない代わりの安全弁）。
    for (const method of [
      "vc_signed_aggregates_total:success",
      "vc_signed_sync_committee_messages_total:success",
      "vc_signed_sync_committee_contributions_total:success",
      "vc_validators_enabled_count",
      "vc_validators_total_count",
    ]) {
      expect(describeValidatorApiMethod(method)).toBeUndefined();
    }
  });

  it("returns undefined for an entirely unknown identifier", () => {
    expect(describeValidatorApiMethod("something_else_total:success")).toBeUndefined();
    expect(describeValidatorApiMethod(":success")).toBeUndefined();
    expect(describeValidatorApiMethod("×1")).toBeUndefined();
  });
});

describe("VALIDATOR_API_METHOD_LABELS table integrity", () => {
  it("has a non-empty ja and en label for every entry", () => {
    for (const entry of VALIDATOR_API_METHOD_LABELS) {
      expect(entry.prefix.length).toBeGreaterThan(0);
      expect(entry.label.ja.length).toBeGreaterThan(0);
      expect(entry.label.en.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicated prefixes", () => {
    const prefixes = VALIDATOR_API_METHOD_LABELS.map((entry) => entry.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("has no entry whose prefix is a prefix of another entry (unambiguous first match)", () => {
    // 前方一致の判定順が優先順位になる実装なので、接頭辞同士が包含関係に
    // ある状態（並び順に依存して結果が変わる状態）を作らないこと。
    for (const a of VALIDATOR_API_METHOD_LABELS) {
      for (const b of VALIDATOR_API_METHOD_LABELS) {
        if (a === b) continue;
        expect(a.prefix.startsWith(b.prefix)).toBe(false);
      }
    }
  });

  it("resolves every prefix in the table to its own label", () => {
    for (const entry of VALIDATOR_API_METHOD_LABELS) {
      expect(describeValidatorApiMethod(entry.prefix)).toEqual(entry.label);
    }
  });
});
