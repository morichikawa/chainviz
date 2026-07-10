import type { TransactionEntity } from "@chainviz/shared";
import type { TxStatus } from "./transaction.js";

/**
 * tx が経る4段階（Issue #212「チェーンの繋がり方・署名中かどうか・状態の
 * 中身を可視化してほしい」の単位D）。`TransactionEntity.status` を増やさず
 * （shared 型変更なし)、既存 status からこの4段階の「経てきたはずの状態」を
 * 導出する。署名(signed)・送信(sent)は collector が観測できない
 * リアルタイム状態なので、「chainviz に tx が見えている時点で常に完了済み」
 * という事後の事実としてのみ表す（統括コメントの3段階整理: 署名 → バリ
 * デーション(mempool投入時+ブロック取り込み時の2回) → チェーンへの書き込み）。
 */
export type TxLifecycleStageKey = "signed" | "sent" | "mempool" | "included";

/**
 * 段階の見た目上の状態。
 * - `done`: 完了済み
 * - `active`: 進行中（現在この段階にいる）
 * - `pending`: まだ到達していない（観測上「起きていない」ことが分かっている、
 *   という意味であり「今まさに起きている」という誇張はしない）
 * - `failed`: 失敗として記録された
 */
export type TxLifecycleStageState = "done" | "active" | "pending" | "failed";

export interface TxLifecycleStage {
  key: TxLifecycleStageKey;
  state: TxLifecycleStageState;
}

const STAGE_KEYS: TxLifecycleStageKey[] = ["signed", "sent", "mempool", "included"];

/**
 * tx の現在の status から4段階の状態を導出する。
 *
 * - `pending`: 署名・送信は完了済み扱い、mempool は進行中、ブロック取り込みは未到達
 * - `included`: 全段階完了
 * - `failed`: 署名・送信・mempool通過(バリデーション)までは完了済み、
 *   最後のブロック取り込み段階が失敗として記録される（tx 自体はブロックに
 *   取り込まれているため「取り込みに失敗した」のではなく「実行が失敗として
 *   記録された」という意味。表示側の一言説明で区別する）
 */
export function deriveTxLifecycle(status: TxStatus): TxLifecycleStage[] {
  switch (status) {
    case "pending":
      return STAGE_KEYS.map((key) => ({
        key,
        state: key === "mempool" ? "active" : key === "included" ? "pending" : "done",
      }));
    case "included":
      return STAGE_KEYS.map((key) => ({ key, state: "done" }));
    case "failed":
      return STAGE_KEYS.map((key) => ({
        key,
        state: key === "included" ? "failed" : "done",
      }));
    default: {
      // status は union で尽くされているはずだが、将来の値追加に備えて
      // 全段階「未到達」にフォールバックする（嘘の完了表示をしない）。
      const exhaustiveCheck: never = status;
      void exhaustiveCheck;
      return STAGE_KEYS.map((key) => ({ key, state: "pending" }));
    }
  }
}

/** `deriveTxLifecycle` を tx エンティティから直接呼び出す薄いヘルパー。 */
export function deriveTxLifecycleFromTx(tx: TransactionEntity): TxLifecycleStage[] {
  return deriveTxLifecycle(tx.status);
}
