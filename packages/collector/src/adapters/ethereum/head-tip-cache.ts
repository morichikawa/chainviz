// B層観測（既存の eth_subscribe(newHeads)、Issue #141 と同じ購読）から、
// 各ノードが現在どの tip（最新ブロックハッシュ）を見ているかを保持する
// キャッシュ。フォーク（一時的な分岐）の色分け表現（Issue #296）の入力
// になる `NodeEntity.headBlockHash` の情報源。
//
// 「フォークかどうか」の判定はこのキャッシュも `toEntity` も行わない。
// ワールドステートには各ノードの観測事実（tip ハッシュ）だけを載せ、
// tip 集合から祖先関係を辿ってフォークを導出する処理はフロント側の純粋
// 関数に委ねる（docs/ARCHITECTURE.md §9.1/§9.2、docs/worklog/issue-296.md
// 「設計メモ」参照。判定結果を二重に配信しない）。
//
// 書き込みは subscribeBlocks の newHeads コールバック（B層）から、読み出しは
// pollInfra（A層。toEntity）から行う。store への書き込みは既存の applyInfra
// 経路 1 本のまま変えない（syncStatusCache〈Issue #187〉・
// beaconSyncStatusCache〈Issue #274〉と同じ「書き込みは購読、store の
// 書き手は applyInfra 1 本」構造）。

/**
 * newHeads 受信ごとに、各ノードが見ている tip のブロックハッシュを保持する。
 */
export class HeadTipCache {
  private readonly tips = new Map<string, string>();

  /**
   * 1 回の newHeads 受信を、`nodeIds` に挙げた全キー（Execution 自身 +
   * 対応する beacon のエイリアス。Issue #141 と同じ `receivedAtKeys`）へ
   * 同じ tip ハッシュで記録する。beacon キーの tip は「同じ論理ノードの
   * Execution が見ている tip」のエイリアスであり、CL 自身が別途観測した
   * 値ではない（`BlockPropagationTracker.record` の receivedAt と同じ流儀）。
   */
  recordHead(nodeIds: readonly string[], hash: string): void {
    for (const nodeId of nodeIds) {
      this.tips.set(nodeId, hash);
    }
  }

  /**
   * 指定ノードが現在見ている tip のブロックハッシュを返す。まだ一度も
   * newHeads を受信していなければ undefined（呼び出し側は
   * `NodeEntity.headBlockHash` の既定値である空文字列を使う）。
   */
  resolve(stableId: string): string | undefined {
    return this.tips.get(stableId);
  }

  /**
   * 現在の観測対象（`currentIds`）に含まれないノードのエントリを破棄する。
   * ノードが観測から消えた（removeNode 等）際に前回の tip が亡霊のように
   * 残り続けないようにする（`trackedNodeInternalsIds`・
   * `PeerObservationCache.prune` と同じ「毎 tick 現在の対象集合と突き合わせて
   * 破棄する」方式）。呼び出し側は pollInfra の毎回の観測から現在の対象
   * 集合を渡す。
   */
  prune(currentIds: ReadonlySet<string>): void {
    for (const id of this.tips.keys()) {
      if (!currentIds.has(id)) this.tips.delete(id);
    }
  }
}
