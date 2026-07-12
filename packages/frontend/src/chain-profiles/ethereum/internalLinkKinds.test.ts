import { describe, expect, it } from "vitest";
import {
  describeDrivenByField,
  describeDrivesField,
  describeInternalLinkKind,
} from "./internalLinkKinds.js";

describe("describeInternalLinkKind (consensus -> execution, Engine API)", () => {
  it("resolves the existing Engine API heading/glossary/description with activity shown", () => {
    const kind = describeInternalLinkKind("consensus", "execution");
    expect(kind.headingKey).toBe("edge.internalLink");
    expect(kind.headingGlossaryKey).toBe("engine-api");
    expect(kind.description).toEqual({
      kind: "segmented",
      prefixKey: "internalEdge.pair.prefix",
      termKey: "internalEdge.pair.term",
      termGlossaryKey: "el-cl-separation",
      suffixKey: "internalEdge.pair.suffix",
    });
    expect(kind.showsActivity).toBe(true);
  });
});

describe("describeInternalLinkKind (validator -> consensus, Beacon API, Issue #285)", () => {
  it("resolves the Beacon API heading/glossary/description with activity hidden", () => {
    const kind = describeInternalLinkKind("validator", "consensus");
    expect(kind.headingKey).toBe("edge.internalLinkValidator");
    expect(kind.headingGlossaryKey).toBe("beacon-api");
    expect(kind.description).toEqual({ kind: "flat", textKey: "internalEdge.validatorPair" });
    expect(kind.showsActivity).toBe(false);
  });
});

describe("describeInternalLinkKind (fallback for unmapped/unknown role pairs)", () => {
  it("falls back to a generic heading without a glossary anchor and activity hidden when both roles are undefined", () => {
    const kind = describeInternalLinkKind(undefined, undefined);
    expect(kind.headingKey).toBe("edge.internalLinkGeneric");
    expect(kind.headingGlossaryKey).toBeUndefined();
    expect(kind.description).toEqual({ kind: "flat", textKey: "internalEdge.genericPair" });
    expect(kind.showsActivity).toBe(false);
  });

  it("falls back for the reverse of the known pairs (execution -> consensus is not a real pair)", () => {
    const kind = describeInternalLinkKind("execution", "consensus");
    expect(kind.headingKey).toBe("edge.internalLinkGeneric");
  });

  it("falls back for a validator driving an execution node directly (not a real topology)", () => {
    const kind = describeInternalLinkKind("validator", "execution");
    expect(kind.headingKey).toBe("edge.internalLinkGeneric");
  });

  it("falls back when only one endpoint's role is known", () => {
    expect(describeInternalLinkKind("consensus", undefined).headingKey).toBe(
      "edge.internalLinkGeneric",
    );
    expect(describeInternalLinkKind(undefined, "execution").headingKey).toBe(
      "edge.internalLinkGeneric",
    );
  });

  it("falls back for a completely unknown chain-profile role value", () => {
    expect(describeInternalLinkKind("sequencer", "prover").headingKey).toBe(
      "edge.internalLinkGeneric",
    );
  });
});

describe("describeDrivesField (own role -> forward field label, InfraPopover)", () => {
  it("uses the connectsToBeacon/beacon-api field for a validator", () => {
    expect(describeDrivesField("validator")).toEqual({
      labelKey: "field.connectsToBeacon",
      glossaryKey: "beacon-api",
    });
  });

  it("defaults to the existing drivesNode/engine-api field for consensus", () => {
    expect(describeDrivesField("consensus")).toEqual({
      labelKey: "field.drivesNode",
      glossaryKey: "engine-api",
    });
  });

  it("defaults to the existing drivesNode/engine-api field when the own role is undefined (legacy snapshot; does not hide the field)", () => {
    expect(describeDrivesField(undefined)).toEqual({
      labelKey: "field.drivesNode",
      glossaryKey: "engine-api",
    });
  });

  it("defaults to the existing drivesNode/engine-api field for an unmapped role value", () => {
    expect(describeDrivesField("sequencer")).toEqual({
      labelKey: "field.drivesNode",
      glossaryKey: "engine-api",
    });
  });
});

describe("describeDrivenByField (driving counterpart's role -> backward field label, InfraPopover)", () => {
  it("uses the validatorClient/validator field when driven by a validator", () => {
    expect(describeDrivenByField("validator")).toEqual({
      labelKey: "field.validatorClient",
      glossaryKey: "validator",
    });
  });

  it("defaults to the existing drivenBy/engine-api field when driven by a consensus node", () => {
    expect(describeDrivenByField("consensus")).toEqual({
      labelKey: "field.drivenBy",
      glossaryKey: "engine-api",
    });
  });

  it("defaults to the existing drivenBy/engine-api field when the driving role is undefined (legacy snapshot; does not hide the field)", () => {
    expect(describeDrivenByField(undefined)).toEqual({
      labelKey: "field.drivenBy",
      glossaryKey: "engine-api",
    });
  });

  it("defaults to the existing drivenBy/engine-api field for an unmapped driving role value", () => {
    expect(describeDrivenByField("sequencer")).toEqual({
      labelKey: "field.drivenBy",
      glossaryKey: "engine-api",
    });
  });

  it("treats an empty-string driving role as unmapped and keeps the engine-api field", () => {
    expect(describeDrivenByField("")).toEqual({
      labelKey: "field.drivenBy",
      glossaryKey: "engine-api",
    });
  });
});

describe("intentional asymmetry between edge-kind and field descriptors (Issue #285)", () => {
  // worklog の設計判断: エッジポップオーバー用の describeInternalLinkKind は
  // 「役割ペアが完全に確定しなければ汎用フォールバックへ倒す」一方、
  // InfraPopover の行用の describeDrivesField / describeDrivenByField は
  // 「validator のときだけ新表現、相手の role が不明でも行は隠さない」。
  // この非対称は意図的なもので、両者を同じ「厳密ペア一致」ロジックに
  // 統一してしまう退行を検出するためのテスト。

  it("hides the edge kind (fallback) but keeps the validator field when the counterpart role is unknown", () => {
    // 同じ「validator 側の役割だけ判明、相手（beacon）の role は未設定」という
    // 状況を両ヘルパーに与える。
    const edgeKind = describeInternalLinkKind("validator", undefined);
    expect(edgeKind.headingKey).toBe("edge.internalLinkGeneric");
    expect(edgeKind.headingGlossaryKey).toBeUndefined();
    expect(edgeKind.showsActivity).toBe(false);

    // 一方で InfraPopover の駆動する側/される側の行は validator 固有の
    // ラベルのまま（フォールバックに倒さない）。
    expect(describeDrivesField("validator")).toEqual({
      labelKey: "field.connectsToBeacon",
      glossaryKey: "beacon-api",
    });
    expect(describeDrivenByField("validator")).toEqual({
      labelKey: "field.validatorClient",
      glossaryKey: "validator",
    });
  });

  it("hides the edge kind (fallback) but keeps the engine-api field when only the consensus role is known", () => {
    // consensus→execution も相手の role が欠けるとエッジ見出しは汎用化するが、
    // フィールドは既存の Engine API 表現を保つ（退行防止の対称確認）。
    expect(describeInternalLinkKind("consensus", undefined).headingKey).toBe(
      "edge.internalLinkGeneric",
    );
    expect(describeDrivesField("consensus")).toEqual({
      labelKey: "field.drivesNode",
      glossaryKey: "engine-api",
    });
    expect(describeDrivenByField("consensus")).toEqual({
      labelKey: "field.drivenBy",
      glossaryKey: "engine-api",
    });
  });
});
