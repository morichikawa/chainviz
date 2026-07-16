/**
 * サイドパネル（キャンバス右ドックの常設オーバーレイ）に表示中の内容を表す
 * 判別共用体（Issue #321。docs/worklog/issue-321.md §12.2「汎用サイドパネル
 * 機構」）。今回は "contractSource"（コントラクトのソースコード表示）1種類
 * のみ持つが、今後 Issue #313（用語集パネル）で
 * `{ kind: "glossary"; termKey?: string }` を、Issue #317（ノード間通信
 * ログ）で `{ kind: "commsLog" }` を、それぞれ追加する想定。この型は
 * フロント内部の表示状態でありワールドステートのスキーマではないため
 * `packages/shared` には置かない。
 *
 * 同時に開けるパネルは1枚（排他）。`SidePanelContext.tsx` の `open` は
 * 現在表示中のパネルを置き換える。
 */
export type SidePanelView = {
  kind: "contractSource";
  /** 表示対象コントラクトのアドレス。エンティティ本体はここでは保持せず、
   * 表示側（SidePanelHost）が都度 world state から引く（未知→既知への
   * 昇格にも自然に追従するため）。 */
  address: string;
};
