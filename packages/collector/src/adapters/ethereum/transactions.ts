// mempool 投入（pending）→ ブロック取り込み（included）という tx の
// ライフサイクルを、tx ハッシュをキーに追跡する純粋なトラッカー。
// newPendingTransactions と newHeads（ブロック内 tx 一覧）から得た情報を
// チェーン非依存な TransactionEntity へ正規化する。Ethereum 固有の取得手段
// （eth_subscribe / eth_getTransactionByHash 等）はこのファイルには持ち込まず、
// 呼び出し側（アダプタ）が用意した正規化済みの入力だけを扱う。

import type { TransactionEntity } from "@chainviz/shared";

/** 追跡に必要な tx の最小情報（from/to は正規化済み）。 */
export interface TxDetail {
  hash: string;
  from: string;
  to: string | null;
}

/** ブロック取り込み時に確定した tx の情報（from/to に加え確定ステータスを持つ）。 */
export interface TxInclusionDetail extends TxDetail {
  status: "included" | "failed";
}

/**
 * tx ハッシュごとに現在の TransactionEntity を保持し、状態遷移
 * （pending → included）を差分として返す。保持数が maxTxs を超えたら古い
 * ものから捨てる（mempool を長時間観察してもメモリが無制限に増えないため）。
 */
export class TransactionLifecycleTracker {
  private readonly txs = new Map<string, TransactionEntity>();

  constructor(private readonly maxTxs = 1000) {}

  /**
   * mempool に入った tx を pending として記録する。まだ知らない tx なら
   * status:"pending" の TransactionEntity を返す。既に追跡済み（pending でも
   * included でも）なら状態を巻き戻さず null を返す（included → pending の
   * 逆行や重複追加を防ぐ）。
   */
  recordPending(detail: TxDetail): TransactionEntity | null {
    if (this.txs.has(detail.hash)) return null;
    const entity: TransactionEntity = {
      kind: "transaction",
      hash: detail.hash,
      from: detail.from,
      to: detail.to,
      status: "pending",
    };
    this.put(entity);
    return entity;
  }

  /**
   * ブロック blockHash に含まれる tx 群を included/failed として記録する。状態が
   * 変化した（新規に確定した、別ブロックから付け替わった、included と failed の間で
   * ステータス自体が変わった）tx の TransactionEntity だけを返す。pending として
   * 未追跡だった tx も、ブロックから得た from/to を使って新規追加する（購読開始前に
   * 投入された tx や pending 通知を取りこぼした tx も可視化に載せるため）。既に同じ
   * blockHash・同じ status で記録済みの tx は変化なしとして返さない（同一ブロックを
   * 複数ノードが重複通知するケースのスキップ）。failed の tx にもブロックには
   * 取り込まれているため blockHash をセットする。
   */
  recordInclusion(
    blockHash: string,
    txs: TxInclusionDetail[],
  ): TransactionEntity[] {
    const changed: TransactionEntity[] = [];
    for (const tx of txs) {
      const existing = this.txs.get(tx.hash);
      if (
        existing &&
        existing.blockHash === blockHash &&
        existing.status === tx.status
      ) {
        continue;
      }
      const entity: TransactionEntity = {
        kind: "transaction",
        hash: tx.hash,
        // 既知の tx は元の from/to を保ち、未知なら今回のブロック情報で埋める。
        from: existing?.from ?? tx.from,
        to: existing ? existing.to : tx.to,
        status: tx.status,
        blockHash,
      };
      this.put(entity);
      changed.push(entity);
    }
    return changed;
  }

  /** 現在追跡している tx の状態（テスト・スナップショット確認用）。 */
  get(hash: string): TransactionEntity | undefined {
    return this.txs.get(hash);
  }

  private put(entity: TransactionEntity): void {
    // Map は挿入順を保つので、更新時は一度消してから入れ直し最新扱いにする。
    this.txs.delete(entity.hash);
    this.txs.set(entity.hash, entity);
    this.evictOldest();
  }

  private evictOldest(): void {
    while (this.txs.size > this.maxTxs) {
      const oldest = this.txs.keys().next().value;
      if (oldest === undefined) break;
      this.txs.delete(oldest);
    }
  }
}
