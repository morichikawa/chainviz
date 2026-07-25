// Issue #420 テスト強化: formatInternalCallEntry / formatInternalCallList の
// 境界値と、Engine API 由来・VC メトリクス由来の method が混在した場合の表示を
// 固定する。1件ずつの正常系は internalLinkActivity.test.ts が持つので、ここは
// 「2段フォールバックの両方が外れる場合」「複数件の並び」「latencyMs / count の
// 境界値」に絞る（1ファイル1責務）。

import type { InternalCallStats } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import {
  formatInternalCallEntry,
  formatInternalCallList,
} from "./internalLinkActivity.js";

const tJa = (key: MessageKey) => translate(key, "ja");
const tEn = (key: MessageKey) => translate(key, "en");

describe("formatInternalCallEntry: both label tables miss", () => {
  it("shows only the raw name for a validator metric that is not in either table", () => {
    // lighthouse 側に新しいカウンタが増え、collector がそれを配信し始めた
    // 場合（フロントのテーブル更新前）。生名 + 回数だけで表示が壊れないこと。
    expect(
      formatInternalCallEntry(
        { method: "vc_signed_aggregates_total:success", count: 2 },
        "ja",
        tJa,
      ),
    ).toBe("vc_signed_aggregates_total:success ×2");
  });

  it("shows only the raw name for an empty method string", () => {
    expect(formatInternalCallEntry({ method: "", count: 1 }, "ja", tJa)).toBe(" ×1");
  });

  it("keeps the latency suffix even when no classification label matches", () => {
    expect(
      formatInternalCallEntry(
        { method: "vc_signed_aggregates_total:success", count: 2, latencyMs: 7.6 },
        "ja",
        tJa,
      ),
    ).toBe("vc_signed_aggregates_total:success ×2 (平均 8 ms)");
  });
});

describe("formatInternalCallEntry: latency and count boundaries", () => {
  it("renders latencyMs 0 instead of dropping it (0 is an observation, not an absence)", () => {
    expect(
      formatInternalCallEntry(
        { method: "vc_signed_attestations_total:success", count: 1, latencyMs: 0 },
        "ja",
        tJa,
      ),
    ).toBe("vc_signed_attestations_total:success ×1 (証明（attestation）の署名) (平均 0 ms)");
  });

  it("rounds a sub-millisecond latency to 0 ms", () => {
    expect(
      formatInternalCallEntry(
        { method: "vc_signed_attestations_total:success", count: 1, latencyMs: 0.4 },
        "en",
        tEn,
      ),
    ).toBe("vc_signed_attestations_total:success ×1 (Sign attestation) (avg 0 ms)");
  });

  it("rounds half a millisecond up", () => {
    expect(
      formatInternalCallEntry(
        { method: "vc_signed_attestations_total:success", count: 1, latencyMs: 0.5 },
        "en",
        tEn,
      ),
    ).toBe("vc_signed_attestations_total:success ×1 (Sign attestation) (avg 1 ms)");
  });

  it("renders a large latency without exponent notation", () => {
    expect(
      formatInternalCallEntry(
        { method: "vc_signed_beacon_blocks_total:success", count: 1, latencyMs: 1234.5 },
        "en",
        tEn,
      ),
    ).toBe("vc_signed_beacon_blocks_total:success ×1 (Sign proposed block) (avg 1235 ms)");
  });

  it("renders a count of 0 as ×0 (collector should not send it, but display must not break)", () => {
    expect(
      formatInternalCallEntry(
        { method: "vc_signed_attestations_total:success", count: 0 },
        "ja",
        tJa,
      ),
    ).toBe("vc_signed_attestations_total:success ×0 (証明（attestation）の署名)");
  });

  it("classifies a non-success status the same way as success", () => {
    // 実機では success しか観測されていないが、slashable 等が届いた場合も
    // 分類ラベルは付き、status の違いは生名の側で読み取れる。
    expect(
      formatInternalCallEntry(
        { method: "vc_signed_beacon_blocks_total:slashable", count: 1 },
        "ja",
        tJa,
      ),
    ).toBe("vc_signed_beacon_blocks_total:slashable ×1 (ブロック提案の署名)");
  });
});

describe("formatInternalCallList: multiple validator duties in one observation", () => {
  it("joins the block proposal and attestation entries with the separator", () => {
    // 1回のスクレイプ間隔で提案と証明の両方が観測されたケース（実機で観測
    // 済みの組み合わせ。docs/worklog/issue-420.md）。
    const calls: InternalCallStats[] = [
      { method: "vc_signed_beacon_blocks_total:success", count: 1, latencyMs: 13.4 },
      { method: "vc_signed_attestations_total:success", count: 1, latencyMs: 1.16 },
    ];
    expect(formatInternalCallList(calls, "ja", tJa)).toBe(
      "vc_signed_beacon_blocks_total:success ×1 (ブロック提案の署名) (平均 13 ms) · " +
        "vc_signed_attestations_total:success ×1 (証明（attestation）の署名) (平均 1 ms)",
    );
  });

  it("localizes every entry of a multi-duty list to English", () => {
    const calls: InternalCallStats[] = [
      { method: "vc_signed_beacon_blocks_total:success", count: 1 },
      { method: "vc_signed_attestations_total:success", count: 2 },
    ];
    expect(formatInternalCallList(calls, "en", tEn)).toBe(
      "vc_signed_beacon_blocks_total:success ×1 (Sign proposed block) · " +
        "vc_signed_attestations_total:success ×2 (Sign attestation)",
    );
  });

  it("keeps Engine API and validator entries distinct in a mixed list", () => {
    // 同一エッジに両方が乗ることは無い（Engine API は beacon→reth、VC
    // メトリクスは validator→beacon）が、フォーマッタはエッジを意識しない
    // 純粋関数なので、混在入力でも取り違えないことを固定する。
    const calls: InternalCallStats[] = [
      { method: "engine_newPayloadV4", count: 2 },
      { method: "vc_signed_attestations_total:success", count: 1 },
    ];
    expect(formatInternalCallList(calls, "ja", tJa)).toBe(
      "engine_newPayloadV4 ×2 (ブロックの実行依頼) · " +
        "vc_signed_attestations_total:success ×1 (証明（attestation）の署名)",
    );
  });

  it("preserves the given order of entries", () => {
    const calls: InternalCallStats[] = [
      { method: "vc_signed_attestations_total:success", count: 1 },
      { method: "vc_signed_beacon_blocks_total:success", count: 1 },
    ];
    expect(formatInternalCallList(calls, "en", tEn)).toBe(
      "vc_signed_attestations_total:success ×1 (Sign attestation) · " +
        "vc_signed_beacon_blocks_total:success ×1 (Sign proposed block)",
    );
  });

  it("shows a single entry without any separator", () => {
    expect(
      formatInternalCallList(
        [{ method: "vc_signed_attestations_total:success", count: 1 }],
        "en",
        tEn,
      ),
    ).toBe("vc_signed_attestations_total:success ×1 (Sign attestation)");
  });
});
