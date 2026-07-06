export type ChainType = "ethereum";

export interface InfraEntity {
  id: string;
  containerName: string;
  ip: string;
  ports: number[];
  resources: { cpuPercent: number; memMB: number };
  process: { name: string; version?: string };
  /**
   * collector のコマンド（addNode / addWorkbench）で作成されたコンテナなら
   * true。環境テンプレート（compose）起動時からある初期構成のコンテナは
   * removeNode / removeWorkbench が拒否するため削除できず、false になる。
   * 省略時は false（削除不可）と同義。フロントは true のときだけ削除 UI を
   * 表示する（削除できないものに削除ボタンを出してエラーにしない。Issue #103）。
   * optional なのは、フィールド未付与の旧スナップショットを「削除不可」として
   * 安全側に倒して互換にするため。
   */
  removable?: boolean;
}

export interface NodeEntity extends InfraEntity {
  kind: "node";
  chainType: ChainType;
  clientType: string;
  syncStatus: "syncing" | "synced";
  blockHeight: number;
  headBlockHash: string;
}

export interface WorkbenchEntity extends InfraEntity {
  kind: "workbench";
  label: string;
  walletIds: string[];
}

export interface PeerEdge {
  kind: "peer";
  fromNodeId: string;
  toNodeId: string;
  networkId: string;
}

/**
 * ワークベンチ → ノードの 1 回の呼び出し（操作）を表すエッジ。
 * PeerEdge のような永続的な接続状態ではなく「観測された瞬間の出来事」なので、
 * WorldStateSnapshot には含めない。DiffEvent の operationObserved でのみ流れ、
 * store の状態にも畳み込まない（描画側が受信時にアニメーションとして消費する）。
 */
export interface OperationEdge {
  kind: "operation";
  /** 呼び出し元ワークベンチのエンティティ id。 */
  fromWorkbenchId: string;
  /** 呼び出し先ノードのエンティティ id。 */
  toNodeId: string;
  /**
   * 呼び出しの種類。値はワークベンチ⇔ノード間プロトコル依存の生の文字列
   * （JSON-RPC のメソッド名など）をそのまま入れる。チェーン固有の値の解釈・
   * 表示（分類・和訳など）は、この型では行わずフロントのチェーンプロファイル
   * 表現セット側の責務とする。
   */
  operation: string;
  /** ロギングプロキシが呼び出しを観測した時刻（epoch ms）。 */
  observedAt: number;
}

/** キャンバス上でエッジ（紐）として描画されるものの総称。kind で判別する。 */
export type WorldStateEdge = PeerEdge | OperationEdge;

export interface WalletEntity {
  kind: "wallet";
  address: string;
  chainType: ChainType;
  balance: string;
  nonce: number;
  isSmartAccount: boolean;
  ownerWorkbenchId: string | null;
  recentTxHashes: string[];
}

export interface BlockEntity {
  kind: "block";
  hash: string;
  number: number;
  parentHash: string;
  timestamp: number;
  receivedAt: Record<string, number>;
}

export interface TransactionEntity {
  kind: "transaction";
  hash: string;
  from: string;
  to: string | null;
  status: "pending" | "included" | "failed";
  blockHash?: string;
}

export interface ContractEntity {
  kind: "contract";
  address: string;
  abiRef?: string;
}

export interface UserOperationEntity {
  kind: "userOperation";
  hash: string;
  sender: string;
  status: "altMempool" | "bundled" | "included";
}

export type WorldStateEntity =
  | NodeEntity
  | WorkbenchEntity
  | WalletEntity
  | BlockEntity
  | TransactionEntity
  | ContractEntity
  | UserOperationEntity;

export interface WorldStateSnapshot {
  chainType: ChainType;
  timestamp: number;
  entities: WorldStateEntity[];
  /**
   * 永続的なピア接続のみ。揮発性の OperationEdge は接続時点の再現対象では
   * ないため、意図的にスナップショットへ含めない。
   */
  edges: PeerEdge[];
}
