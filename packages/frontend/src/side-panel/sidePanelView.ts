/**
 * サイドパネル（キャンバス右ドックの常設オーバーレイ）に表示中の内容を表す
 * 判別共用体（Issue #321。docs/ARCHITECTURE.md §12.2「汎用サイドパネル
 * 機構」）。"contractSource"（コントラクトのソースコード表示）に加え、
 * Issue #317 で "commsLog"（ノード間通信ログ）を追加した。今後 Issue #313
 * （用語集パネル）で `{ kind: "glossary"; termKey?: string }` を追加する
 * 想定。この型はフロント内部の表示状態でありワールドステートのスキーマ
 * ではないため `packages/shared` には置かない。
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
      kind: "commsLog";
    };
