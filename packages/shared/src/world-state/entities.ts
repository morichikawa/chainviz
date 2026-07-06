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
  /**
   * P2P ネットワーク上の役割。"bootnode" は新規参加ノードが最初に接続する
   * 入口役のノード、"peer" はそれ以外の通常ピア。bootnode はチェーン非依存の
   * P2P 一般語彙として使う（Bitcoin の seed node、libp2p の bootstrap peer も
   * この値に正規化する想定）。collector（ChainAdapter）が Docker ラベル
   * `com.chainviz.p2p-role` から導出する（Issue #65 の「ラベルを単一の真実の
   * 情報源とする」方針）。
   * optional なのはフィールド未付与の旧スナップショットとの互換のため。
   * 省略時は「不明」を意味し、フロントは `p2pRole === "bootnode"` の判定
   * だけを行い、該当ノードが見つからなければブートノード前提の表示
   * （バッジ・接続予定先の予告）を出さない側に倒す（Issue #123 / #124）。
   */
  p2pRole?: "bootnode" | "peer";
}

export interface WorkbenchEntity extends InfraEntity {
  kind: "workbench";
  label: string;
  walletIds: string[];
  /**
   * このワークベンチの RPC 呼び出しが最終的に届くノードのエンティティ id
   * （ロギングプロキシ経由の場合はプロキシの転送先を解決した結果）。
   * フロントはワークベンチ→ノードの常設「操作先」エッジやカード詳細の
   * 表示に使う（Issue #123）。
   * optional なのは旧スナップショットとの互換のためで、解決できない場合も
   * 省略する（省略 = 不明。フロントは操作先の表示を出さないフォールバックに
   * 倒す）。null は使わず「無い」の表現を省略に一本化する（WalletEntity の
   * ownerWorkbenchId の null は「所有者が削除された」という意味のある状態
   * だが、こちらの不在は単に解決不能なだけで区別する状態が無いため）。
   */
  rpcTargetNodeId?: string;
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
