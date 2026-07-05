import type {
  BlockEntity,
  ChainType,
  PeerEdge,
  TransactionEntity,
  WorldStateSnapshot,
} from "../world-state/index.js";

/**
 * チェーンプロファイルの Collector 側実装（アダプタ）が満たす境界契約。
 * ここに列挙したメソッドは collector のエントリポイント（main の配線）が
 * 実際に呼び出すものだけを宣言する。当初 C/D 層向けに置いていた汎用の
 * DiffEvent 購読口（subscribeChainEvents）は、実装が層ごとの型付き
 * コールバックへ発展し未使用となったため削除した。D 層の購読口は
 * Phase 4 の設計時に必要な形で追加する（先回り実装をしない）。
 */
export interface ChainAdapter {
  chainType: ChainType;
  /** A層: インフラ観測を1巡ポーリングし、エンティティへ正規化して返す。 */
  pollInfra(): Promise<Partial<WorldStateSnapshot>>;
  /** B層: ピア接続の変化を購読し、そのたびに全エッジを onUpdate へ渡す。 */
  subscribePeers(onUpdate: (edges: PeerEdge[]) => void): void;
  /** B層: ブロックの受信タイミングを購読し、受信のたびに onBlock へ渡す。 */
  subscribeBlocks(onBlock: (block: BlockEntity) => void): Promise<void>;
  /**
   * C層: tx ライフサイクル（pending → included）を購読し、状態が変化した
   * tx を onTx へ渡す。
   */
  subscribeTransactions(onTx: (tx: TransactionEntity) => void): Promise<void>;
}
