/**
 * サイドパネル（キャンバス右ドックの常設オーバーレイ）に表示中の内容を表す
 * 判別共用体（Issue #321。docs/ARCHITECTURE.md §12.2「汎用サイドパネル
 * 機構」）。"contractSource"（コントラクトのソースコード表示）に加え、
 * Issue #313 で "glossary"（用語集パネル）、Issue #317 で "commsLog"
 * （ノード間通信ログ）を追加した。この型はフロント内部の表示状態であり
 * ワールドステートのスキーマではないため `packages/shared` には置かない。
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
    }
  | {
      kind: "commsLog";
    }
  | {
      /**
       * 「ハッシュのしくみ」デモ（Issue #401。`docs/worklog/issue-401.md`
       * UX設計）。実チェーンから完全に独立した学習用の疑似データ（砂場）を
       * 扱うため、対象を指すデータは持たない（`commsLog` と同じ扱い）。
       * 中身（`HashChainDemoView`）は開くたびに初期状態から始まる。
       */
      kind: "hashChainDemo";
    }
  | {
      /**
       * 「署名と検証のしくみ」デモ（Issue #402。`docs/worklog/issue-402.md`
       * UX設計・実装設計メモ）。`hashChainDemo` と同じく実チェーンから
       * 完全に独立した学習用の疑似データ（砂場）を扱うため、対象を指す
       * データは持たない。中身（`SignatureDemoView`）は開くたびに
       * 初期状態から始まる。
       */
      kind: "signatureDemo";
    };
