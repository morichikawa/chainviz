import type { MessageKey } from "../../i18n/messages.js";

/**
 * D層: 内部リンクエッジ（`NodeEntity.drivesNodeId`）の端点 `nodeRole` の組
 * （駆動する側→される側）から、表現（見出し・説明文・活動セクション表示
 * 可否）を解決するチェーンプロファイル表現セット（ARCHITECTURE.md
 * §7.6.11、Issue #285）。`nodeRoles.ts` の `describeNodeRole` が単体の
 * `nodeRole` を解釈するのと同じ「チェーン固有語彙の解釈はフロント表現
 * セットが担う」流儀で、こちらは駆動する側→される側という「組」を解釈する。
 *
 * Ethereum プロファイルでは2種類の組が現れる:
 * - consensus → execution（beacon → reth。Engine API。既存）
 * - validator → consensus（validator → beacon。Beacon API。Issue #285で追加）
 *
 * どちらにも該当しない組（役割不明の旧スナップショット・将来の未知の値）は
 * フォールバック（アンカー無しの汎用見出し・活動セクション非表示）に倒す
 * （`describeNodeRole` と同じ「マッピングに無い値は出さない側に倒す」流儀）。
 */

/** `InternalLinkEdgePopover` の説明文の組み立て方。 */
export type InternalLinkDescription =
  | {
      /**
       * 説明文の途中に `GlossaryTerm` を1つ埋め込む3分割文（既存の
       * consensus→execution 用。`legend.hint.prefix/term/suffix` と同じ手法）。
       */
      kind: "segmented";
      prefixKey: MessageKey;
      termKey: MessageKey;
      termGlossaryKey: string;
      suffixKey: MessageKey;
    }
  | {
      /** アンカーを埋め込まない単一の完成文（見出し自体にアンカーがある場合用）。 */
      kind: "flat";
      textKey: MessageKey;
    };

/** InfraPopover の「駆動する/される」行に出すラベル・GlossaryTerm キー。 */
export interface InternalLinkFieldDescriptor {
  labelKey: MessageKey;
  glossaryKey: string;
}

export interface InternalLinkKindDescriptor {
  /** エッジポップオーバー見出しの i18n キー。 */
  headingKey: MessageKey;
  /** 見出しの `GlossaryTerm` キー。省略時はアンカー無しの見出しになる。 */
  headingGlossaryKey?: string;
  /** エッジポップオーバーの説明文。 */
  description: InternalLinkDescription;
  /**
   * 「直近の呼び出し」セクションを表示するか。observed 経路が無い組
   * （validator→consensus）・役割不明の組では false（ARCHITECTURE.md
   * §7.6.11「観測していないだけで『最近の呼び出しはありません』を常時
   * 出すと誤情報になるため、セクションごと隠す」）。
   */
  showsActivity: boolean;
  /** 駆動する側の InfraPopover に出す行（このモジュールの外では未使用。§7.6.11参照）。 */
  drivingField: InternalLinkFieldDescriptor;
  /** 駆動される側の InfraPopover に出す行。同上。 */
  drivenField: InternalLinkFieldDescriptor;
}

const CONSENSUS_TO_EXECUTION: InternalLinkKindDescriptor = {
  headingKey: "edge.internalLink",
  headingGlossaryKey: "engine-api",
  description: {
    kind: "segmented",
    prefixKey: "internalEdge.pair.prefix",
    termKey: "internalEdge.pair.term",
    termGlossaryKey: "el-cl-separation",
    suffixKey: "internalEdge.pair.suffix",
  },
  showsActivity: true,
  drivingField: { labelKey: "field.drivesNode", glossaryKey: "engine-api" },
  drivenField: { labelKey: "field.drivenBy", glossaryKey: "engine-api" },
};

const VALIDATOR_TO_CONSENSUS: InternalLinkKindDescriptor = {
  headingKey: "edge.internalLinkValidator",
  headingGlossaryKey: "beacon-api",
  description: { kind: "flat", textKey: "internalEdge.validatorPair" },
  showsActivity: false,
  drivingField: { labelKey: "field.connectsToBeacon", glossaryKey: "beacon-api" },
  drivenField: { labelKey: "field.validatorClient", glossaryKey: "validator" },
};

const FALLBACK: InternalLinkKindDescriptor = {
  headingKey: "edge.internalLinkGeneric",
  description: { kind: "flat", textKey: "internalEdge.genericPair" },
  showsActivity: false,
  drivingField: CONSENSUS_TO_EXECUTION.drivingField,
  drivenField: CONSENSUS_TO_EXECUTION.drivenField,
};

/**
 * 駆動する側→される側の `nodeRole` の組から、エッジポップオーバー用の表現
 * 記述子を引く。マッピングに無い組（`undefined` を含む）はフォールバックを
 * 返す（`describeNodeRole` の `Object.hasOwn` ガードと同じ「出さない側に
 * 倒す」流儀。ARCHITECTURE.md §7.6.11 の表の3行目）。
 */
export function describeInternalLinkKind(
  drivingNodeRole: string | undefined,
  drivenNodeRole: string | undefined,
): InternalLinkKindDescriptor {
  if (drivingNodeRole === "consensus" && drivenNodeRole === "execution") {
    return CONSENSUS_TO_EXECUTION;
  }
  if (drivingNodeRole === "validator" && drivenNodeRole === "consensus") {
    return VALIDATOR_TO_CONSENSUS;
  }
  return FALLBACK;
}

/**
 * InfraPopover の「駆動する◯◯ノード」行（順方向。自分が駆動する側）の
 * ラベル・アンカーを、自分自身の `nodeRole` から選ぶ。
 *
 * `describeInternalLinkKind` と違い、ここでは相手ノードの role が無くても
 * （＝役割ペア全体を厳密に確定できなくても）行自体は必ず出す。相手の role
 * まで揃わないと消える設計にすると、role 未設定の旧スナップショットで
 * 既存の「駆動する実行ノード」行が突然消えるという退行になるため
 * （§7.6.11 実装メモ参照）。`"validator"` のときだけ新表現に切り替え、
 * それ以外（`"consensus"`・不明値・`undefined` を含む）は既存の
 * Engine API 表現を既定にする。
 */
export function describeDrivesField(
  ownNodeRole: string | undefined,
): InternalLinkFieldDescriptor {
  return ownNodeRole === "validator"
    ? VALIDATOR_TO_CONSENSUS.drivingField
    : CONSENSUS_TO_EXECUTION.drivingField;
}

/**
 * InfraPopover の「駆動元（◯◯ノード）」行（逆方向。自分が駆動される側）の
 * ラベル・アンカーを、駆動元（自分を指している側）の `nodeRole` から選ぶ。
 * `describeDrivesField` と同じ「validator のときだけ新表現、それ以外は
 * 既定の Engine API 表現」の非対称フォールバック方針。
 */
export function describeDrivenByField(
  drivingNodeRole: string | undefined,
): InternalLinkFieldDescriptor {
  return drivingNodeRole === "validator"
    ? VALIDATOR_TO_CONSENSUS.drivenField
    : CONSENSUS_TO_EXECUTION.drivenField;
}
