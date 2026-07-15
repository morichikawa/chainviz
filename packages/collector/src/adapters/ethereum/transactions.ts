// mempool 投入（pending）→ ブロック取り込み（included）という tx の
// ライフサイクルを、tx ハッシュをキーに追跡する純粋なトラッカー。
// newPendingTransactions と newHeads（ブロック内 tx 一覧）から得た情報を
// チェーン非依存な TransactionEntity へ正規化する。Ethereum 固有の取得手段
// （eth_subscribe / eth_getTransactionByHash 等）はこのファイルには持ち込まず、
// 呼び出し側（アダプタ）が用意した正規化済みの入力だけを扱う。

import type { ContractCall, ContractEvent, TransactionEntity } from "@chainviz/shared";

/** 追跡に必要な tx の最小情報（from/to は正規化済み）。 */
export interface TxDetail {
  hash: string;
  from: string;
  to: string | null;
  /**
   * この tx が追跡中のコントラクト宛ての関数呼び出しであるとアダプタが
   * 判定・復号できた場合の呼び出し内容。呼び出し側（EthereumAdapter）が
   * pending 検知時に eth_getTransactionByHash の input をカタログ ABI で
   * 復号した結果をそのまま渡す。カタログ照合済みなら関数名・引数付きで、
   * 追跡中だが未カタログなら rawFunctionId のみで載る。宛先が未追跡、
   * または input に関数セレクタが無い場合は省略する（Issue #162）。
   */
  contractCall?: ContractCall;
  /**
   * この tx が使った送信元アカウントの通し番号（Issue #319）。呼び出し側
   * （EthereumAdapter）が pending 検知時に eth_getTransactionByHash から
   * 取得した RpcTransaction.nonce をそのまま渡す。tx 詳細を観測できな
   * かった（取り込みのみ観測）場合は省略する。値 0 は「最初の送信」という
   * 意味のある観測値であり、省略と区別する（TransactionEntity.nonce と
   * 同じ判定方針。falsy 判定禁止）。
   */
  nonce?: number;
}

/** ブロック取り込み時に確定した tx の情報（from/to に加え確定ステータスを持つ）。 */
export interface TxInclusionDetail extends TxDetail {
  status: "included" | "failed";
  /**
   * receipt の contractAddress。コントラクト作成 tx でのみ非 null。省略時は
   * null と同じ扱い（作成ではない）。TransactionEntity.createdContractAddress
   * へマッピングされる（Issue #160）。
   */
  contractAddress?: string | null;
  /**
   * receipt.logs をカタログ ABI で復号した結果（Issue #162）。呼び出し側が
   * ブロック取り込みのたびに receipt.logs から作り直して渡す（pending 時の
   * contractCall と異なり、状態遷移をまたいで保持されるものではなく毎回
   * 上書きする）。イベントが無い tx では空配列を渡してよい（recordInclusion
   * 側で contractEvents フィールド自体を省略する）。
   */
  contractEvents?: ContractEvent[];
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
      ...(detail.nonce !== undefined ? { nonce: detail.nonce } : {}),
      ...(detail.contractCall ? { contractCall: detail.contractCall } : {}),
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
   *
   * receipt の contractAddress（コントラクト作成 tx でのみ非 null）は
   * createdContractAddress として entity に載せる。一度確定した作成先アドレスは
   * ブロックが変わらない限り変化しないため、以後の重複通知で省略されても
   * （= undefined/null が来ても）既存の値を保持する（from/to の扱いと同様）。
   *
   * nonce（Issue #319）は pending 検知時にしか観測できない（receipt には
   * 含まれない）ため、既存値をそのまま引き継ぐ（tx.nonce は常に undefined
   * だが、from/to・createdContractAddress と同じ「既存優先」の流儀で書く）。
   * pending を経ず取り込みだけを観測した tx は nonce 省略のままとなる
   * （意図的にブロックあたりの RPC を増やさない。Issue #86 の方針）。
   *
   * contractCall（pending 検知時にカタログ ABI で復号した関数呼び出し。
   * Issue #162）は、ここでは再計算せず既存の値をそのまま引き継ぐ（inclusion
   * 側は receipt から関数呼び出しの input を取得しないため）。contractEvents
   * （receipt.logs をカタログ ABI で復号した結果）はブロック取り込みのたびに
   * 呼び出し側が渡した最新の値で置き換える（空配列が渡された場合は
   * フィールド自体を省略し、「イベントなし」の tx を contractEvents: [] で
   * 埋め尽くさない）。
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
      const createdContractAddress = tx.contractAddress ?? existing?.createdContractAddress;
      // nonce は pending 検知時にしか観測できない（receipt には含まれない）ため
      // 既存値を優先する。tx.nonce は常に undefined だが、from/to と同じ
      // 「既存優先」の流儀に揃えるため existing?.nonce ?? tx.nonce の形で書く。
      const nonce = existing?.nonce ?? tx.nonce;
      const entity: TransactionEntity = {
        kind: "transaction",
        hash: tx.hash,
        // 既知の tx は元の from/to を保ち、未知なら今回のブロック情報で埋める。
        from: existing?.from ?? tx.from,
        to: existing ? existing.to : tx.to,
        status: tx.status,
        blockHash,
        ...(nonce !== undefined ? { nonce } : {}),
        ...(createdContractAddress ? { createdContractAddress } : {}),
        ...(existing?.contractCall ? { contractCall: existing.contractCall } : {}),
        ...(tx.contractEvents && tx.contractEvents.length > 0
          ? { contractEvents: tx.contractEvents }
          : {}),
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

  /**
   * 既に配信済みの tx の contractEvents を再復号結果で差し替える（Issue
   * #244）。デプロイ tx のイベントログは、発行元コントラクトのカタログ登録
   * （`registerContractDeployment`）が `handleBlockInclusion` より後着した
   * 場合、ブロック取り込み時点では未照合のまま raw フォールバックで確定
   * 配信されてしまう。呼び出し側（EthereumAdapter）は、その後カタログ登録が
   * 「未知 → 既知」への昇格を起こした時点で生ログを再復号し、この
   * メソッドで tx の contractEvents を更新して entityUpdated 相当を
   * 再配信する（自己修復）。
   *
   * - hash が未追跡（evict 済み等）なら null（エラーではない正常系。呼び出し
   *   側は何もしない）
   * - contractEvents が空配列なら null（意味のない更新を配信しない。
   *   recordInclusion の「空配列はフィールド省略」という扱いと整合させる。
   *   このメソッドは元々イベントを持っていた tx の contractEvents を差し
   *   替えるだけなので、既存の contractEvents を空へ後退させることはしない）
   * - それ以外は contractEvents を差し替えたエンティティを最新扱いへ入れ
   *   直して（`put`）返す。他のフィールド（status/blockHash/contractCall 等）
   *   は変更しない
   */
  updateContractEvents(
    hash: string,
    contractEvents: ContractEvent[],
  ): TransactionEntity | null {
    if (contractEvents.length === 0) return null;
    const existing = this.txs.get(hash);
    if (!existing) return null;
    const updated: TransactionEntity = { ...existing, contractEvents };
    this.put(updated);
    return updated;
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
