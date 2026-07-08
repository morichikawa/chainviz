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

/**
 * ウォレットが保有するトークン残高 1 件。トークンの表示情報（symbol /
 * decimals）は対応する ContractEntity（contractAddress で引く）の token
 * メタ情報が持ち、ここでは重複させない。
 */
export interface TokenBalance {
  /**
   * トークンを管理するコントラクトのアドレス（ContractEntity.address に対応）。
   * ChainAdapter 実装は ContractEntity.address と**同一の表記**（Ethereum
   * アダプタでは小文字正規化済み）で載せること。フロントはこの2つを文字列
   * 一致で突き合わせる（表記が食い違う分は「対応するコントラクト未観測」と
   * 同じ扱いで表示されない）。
   */
  contractAddress: string;
  /** トークンの最小単位での残高（10 進文字列。balance と同じく精度落ち防止）。 */
  amount: string;
}

export interface WalletEntity {
  kind: "wallet";
  address: string;
  chainType: ChainType;
  balance: string;
  nonce: number;
  isSmartAccount: boolean;
  ownerWorkbenchId: string | null;
  recentTxHashes: string[];
  /**
   * 追跡中のトークンコントラクト（チェーンプロファイルのコントラクトカタログに
   * 載っているもの）の残高一覧。トークンが 1 つもデプロイされていない環境・
   * フィールド未付与の旧スナップショットでは省略（省略 = 情報なし。フロントは
   * トークン残高の表示自体を出さない側に倒す）。
   */
  tokenBalances?: TokenBalance[];
}

export interface BlockEntity {
  kind: "block";
  hash: string;
  number: number;
  parentHash: string;
  timestamp: number;
  receivedAt: Record<string, number>;
}

/**
 * 復号済みの引数 1 件。値は表示用に文字列化して持つ（大きな数値の精度落ちを
 * 防ぎ、チェーンごとの型体系をワールドステートに持ち込まないため）。
 */
export interface DecodedArgument {
  name: string;
  value: string;
}

/**
 * tx によるコントラクト関数呼び出しの内容。関数名・引数はチェーンプロファイルの
 * コントラクトカタログ（インターフェース定義）で復号できた場合のみ入る。
 * 復号できない呼び出しは rawFunctionId（チェーン依存の生の識別子。解釈・表示は
 * OperationEdge.operation と同じくフロントのチェーンプロファイル表現セットの
 * 責務）だけを持つ。
 */
export interface ContractCall {
  /** 呼び出し先コントラクトのアドレス（ContractEntity.address に対応）。 */
  contractAddress: string;
  functionName?: string;
  args?: DecodedArgument[];
  /** 復号できなかった場合に残す、呼び出し先関数のチェーン依存の生の識別子。 */
  rawFunctionId?: string;
}

/**
 * tx の実行中にコントラクトが発したイベント（ログ）1 件。イベント名・引数は
 * カタログで復号できた場合のみ入り、復号できないイベントは rawEventId
 * （チェーン依存の生の識別子）だけを持つ。
 */
export interface ContractEvent {
  /** イベントを発したコントラクトのアドレス。 */
  contractAddress: string;
  eventName?: string;
  args?: DecodedArgument[];
  /** 復号できなかった場合に残す、イベント種別のチェーン依存の生の識別子。 */
  rawEventId?: string;
}

export interface TransactionEntity {
  kind: "transaction";
  hash: string;
  from: string;
  to: string | null;
  status: "pending" | "included" | "failed";
  blockHash?: string;
  /**
   * この tx がコントラクト関数呼び出しである場合の呼び出し内容。追跡中の
   * コントラクト宛てで、かつ入力データを観測できた場合のみ入る（pending を
   * 経ずブロック取り込みだけを観測した tx では省略されることがある）。
   * 省略時もフロントは to が ContractEntity のアドレスに一致するかで
   * 「コントラクト宛ての tx」の判定はできる。
   */
  contractCall?: ContractCall;
  /**
   * この tx がコントラクトを新規作成（デプロイ）した場合の作成先アドレス。
   * ブロック取り込み結果（receipt 相当の観測）から得られた場合のみ入る。
   */
  createdContractAddress?: string;
  /**
   * この tx の実行中にコントラクトが発したイベント一覧。ブロック取り込みが
   * 確定した後（status が included / failed になった後）にのみ入る。
   */
  contractEvents?: ContractEvent[];
}

/**
 * チェーン上にデプロイされたスマートコントラクト。特定の 1 ノードの中で
 * 動くものではなく「チェーンに複製され、全ノードが同じ実行をするプログラム」
 * であり、WalletEntity と同じくチェーン側の状態なので、ノード・ワークベンチの
 * 削除とは無関係に、一度現れたら削除しない。
 */
export interface ContractEntity {
  kind: "contract";
  address: string;
  chainType: ChainType;
  /**
   * 人が読める表示名（例: "ChainvizToken"）。チェーンプロファイルの
   * コントラクトカタログで特定できた場合のみ入る。カタログ外のコントラクト
   * （ユーザーが独自にデプロイしたもの）では省略され、フロントは
   * 「未知のコントラクト」として存在だけを表示する。
   */
  name?: string;
  /**
   * チェーンプロファイルのコントラクトカタログ上のキー。関数呼び出し・
   * イベントの復号に使うインターフェース定義（EVM の ABI 等のチェーン固有
   * データ）はカタログ側（アダプタが読むデータファイル）が持ち、ワールド
   * ステートには載せない（ChainAdapter 境界）。
   */
  catalogKey?: string;
  /** デプロイした主体（ウォレットアドレス）。デプロイを観測できた場合のみ。 */
  deployerAddress?: string;
  /** このコントラクトを作成した tx のハッシュ。デプロイを観測できた場合のみ。 */
  createdByTxHash?: string;
  /**
   * トークンを管理するコントラクトである場合の表示メタ情報。
   * WalletEntity.tokenBalances の amount はこの decimals で解釈する。
   */
  token?: { symbol: string; decimals: number };
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
