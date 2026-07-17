/**
 * サイドパネル（キャンバス右ドックの常設オーバーレイ）に表示中の内容を表す
 * 判別共用体（Issue #321。docs/ARCHITECTURE.md §12.2「汎用サイドパネル
 * 機構」）。"contractSource"（コントラクトのソースコード表示）に加え、
 * Issue #313 で "glossary"（用語集パネル）を追加した。今後 Issue #317
 * （ノード間通信ログ）で `{ kind: "commsLog" }` を追加する想定。この型は
 * フロント内部の表示状態でありワールドステートのスキーマではないため
 * `packages/shared` には置かない。
 *
 * 同時に開けるパネルは1枚（排他）。`SidePanelContext.tsx` の `open` は
 * 現在表示中のパネルを置き換える。
 */
export type SidePanelView =
  | {
      kind: "contractSource";
      /** 表示対象コントラクトのアドレス。エンティティ本体はここでは保持せず、
       * 表示側（SidePanelHost）が都度 world state から引く（未知→既知への
       * 昇格にも自然に追従するため）。 */
      address: string;
    }
  | {
      kind: "glossary";
      /**
       * 開いた瞬間に展開・スクロールして見せる用語（Issue #313。
       * `docs/worklog/issue-313.md` §3.3）。ヘッダーの「用語集」ボタンから
       * 開いたときは省略（検索欄にフォーカスする）。用語（`GlossaryTerm`）
       * のクリックやパネル内の関連用語チップから開いたときは指定する。
       */
      termKey?: string;
    };
