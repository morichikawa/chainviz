import type {
  BlockEntity,
  ChainType,
  ContractEntity,
  NodeInternals,
  NodeLinkActivity,
  PeerEdge,
  TransactionEntity,
  WorldStateSnapshot,
} from "../world-state/index.js";

/**
 * D層（ノード内部）購読のコールバック群。1 回の内部観測（メトリクスの
 * スクレイプ）から「ノード内部状態の更新」と「駆動リンク上の呼び出し活動」の
 * 両方が得られるため、1 つの購読口に束ねて渡す。
 */
export interface NodeInternalsHandlers {
  /**
   * ノード内部状態の更新。nodeId は対象ノードのエンティティ id
   * （NodeEntity.id）。ワールドステートへの反映（対象ノードへのパッチ・
   * 差分計算）は store 側が担う。
   */
  onInternals: (nodeId: string, internals: NodeInternals) => void;
  /**
   * 駆動リンク上の内部 API 呼び出しの観測（揮発性）。store には畳み込まず、
   * nodeLinkActivity イベントとしてそのまま配信される。
   */
  onLinkActivity: (activity: NodeLinkActivity) => void;
}

/**
 * チェーンプロファイルの Collector 側実装（アダプタ）が満たす境界契約。
 * ここに列挙したメソッドは collector のエントリポイント（main の配線）が
 * 実際に呼び出すものだけを宣言する。当初 C/D 層向けに置いていた汎用の
 * DiffEvent 購読口（subscribeChainEvents）は、実装が層ごとの型付き
 * コールバックへ発展し未使用となったため削除した。
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
  /**
   * C層: コントラクトのデプロイ検知・内容更新（カタログ照合による名前の判明
   * 等）を購読し、現れた/変化した ContractEntity をそのたび onContract へ渡す。
   * ワールドステートへの反映（差分計算）は store 側が担う。コントラクトという
   * 概念を持たないチェーン（例: Bitcoin）のアダプタは実装しなくてよい
   * （省略可。省略時、collector はコントラクト追跡を配線しない）。
   */
  subscribeContracts?(
    onContract: (contract: ContractEntity) => void,
  ): Promise<void>;
  /**
   * D層: ノード内部の観測（内部状態の更新と駆動リンク上の呼び出し活動）を
   * 購読する。ノード内部という階層を持たない・観測手段を持たないチェーンの
   * アダプタは実装しなくてよい（省略可。省略時、collector は D層の観測を
   * 配線しない。CONCEPT.md「非 EVM チェーンでは D層は無いものとして扱う」）。
   */
  subscribeNodeInternals?(handlers: NodeInternalsHandlers): Promise<void>;
  /**
   * チェーンリセット（観測対象のチェーン自体が破棄され、別のチェーンとして
   * 再作成されたこと。例: `docker compose down -v` → `up` による genesis の
   * 再生成）の検知を購読する（Issue #357）。通常のノード再起動・一時的な
   * 観測不能はリセットではない。何をもって「別のチェーンになった」と判定
   * するかはチェーンごとにアダプタが決め（Ethereum は block 0 のハッシュ
   * 変化）、この境界にはチェーン固有語彙を出さない。onReset を受けた
   * collector 側は、store のチェーン由来エンティティ（wallet / contract /
   * block / transaction）のパージ等を行う（反映は store 側の責務）。
   * チェーンリセットという状況が起こり得ない・検知手段を持たないチェーンの
   * アダプタは実装しなくてよい（省略可。省略時、collector はリセット検知を
   * 配線しない）。
   */
  subscribeChainResets?(onReset: () => void): void;
}
