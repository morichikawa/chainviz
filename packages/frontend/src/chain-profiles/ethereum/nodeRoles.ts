import type { Localized } from "../../i18n/messages.js";

/**
 * Ethereum チェーンプロファイルのフロント表現セット（A層。ARCHITECTURE.md
 * §2 の `NodeEntity.nodeRole` docstring、Issue #215）。`nodeRole` は
 * チェーン依存の生の文字列（execution/consensus/validator）をそのまま
 * 持つため、その和訳・表示はここが担う（`syncStageLabels.ts` と同じ
 * 「チェーン固有語彙の解釈はフロント表現セットが担う」流儀。CLAUDE.md の
 * ChainAdapter 境界どおり、ワールドステート・glossary にはこのマッピングを
 * 持ち込まない）。
 *
 * `showsSyncState` は「このノードはチェーンのコピーを同期する係か」を表す
 * フラグで、コンポーネント側（InfraNodeCard/InfraPopover）が `"validator"`
 * という chainviz-Ethereum 固有のリテラルを直接持たずに「同期状態ドット・
 * 同期状態/ブロック高行を出すか」を判定できるようにするために存在する
 * （バリデーターはステークで合意に参加する係であり、チェーンのコピーを
 * 同期する係ではない。値ゼロのまま「同期中」を出し続ける旧挙動は「壊れて
 * いる」誤解を招くため、Issue #215 で表示自体をやめる）。
 */
export interface NodeRoleDescriptor {
  label: Localized;
  glossaryKey: string;
  showsSyncState: boolean;
}

export const NODE_ROLE_DESCRIPTORS: Readonly<Record<string, NodeRoleDescriptor>> = {
  execution: {
    label: { ja: "実行クライアント", en: "Execution client" },
    glossaryKey: "el-client",
    showsSyncState: true,
  },
  consensus: {
    label: { ja: "コンセンサスクライアント", en: "Consensus client" },
    glossaryKey: "cl-client",
    showsSyncState: true,
  },
  validator: {
    label: { ja: "バリデーター", en: "Validator" },
    glossaryKey: "validator",
    showsSyncState: false,
  },
};

/**
 * 生の nodeRole から表示記述子を引く。マッピングに無い値（チェーンプロファイル
 * 未対応の値・将来の追加値）や `undefined`（ラベル未付与・旧スナップショット）
 * では `undefined` を返し、呼び出し側は「役割不明」のフォールバック（サブ
 * タイトルは clientType のみ、役割行自体を出さない）に倒す。
 *
 * `NODE_ROLE_DESCRIPTORS` はオブジェクトリテラルで `Object.prototype` を
 * 継承しているため、ブラケットアクセスだけだと `nodeRole` が `"toString"` /
 * `"constructor"` / `"__proto__"` のような継承メンバ名のとき、その継承
 * メンバ（関数など）を誤って真値として返してしまう（Issue #215 テスト強化
 * 時に発見。docs/worklog/issue-211.md 参照）。`Object.hasOwn` で自身の
 * 列挙可能プロパティかどうかを確認してから引くことでこれを防ぐ。
 */
export function describeNodeRole(
  nodeRole: string | undefined,
): NodeRoleDescriptor | undefined {
  if (nodeRole === undefined) return undefined;
  if (!Object.hasOwn(NODE_ROLE_DESCRIPTORS, nodeRole)) return undefined;
  return NODE_ROLE_DESCRIPTORS[nodeRole];
}

/**
 * このノードがチェーンのコピーを同期する係か（同期状態ドット・「同期状態」
 * 「ブロック高」行を出すかどうかの判定に使う）。descriptor が引けない
 * （nodeRole 省略・未知値）場合は同期表示を出す既存挙動を維持するため
 * `true` を返す（`showsSyncState: false` になるのは現状 validator のみ）。
 */
export function nodeShowsSyncState(nodeRole: string | undefined): boolean {
  return describeNodeRole(nodeRole)?.showsSyncState ?? true;
}
