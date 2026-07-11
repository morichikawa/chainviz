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

/**
 * ノード内部の同期ステージ 1 件の進行状況（D層）。ステージ型同期を行う
 * クライアント（例: reth）が「どの処理段階がどのブロック高まで済んだか」を
 * 公開しているものを正規化する。
 */
export interface SyncStageProgress {
  /**
   * ステージ名。値はクライアント依存の生の識別子（例: reth の "Headers" /
   * "Bodies" / "Execution"）をそのまま入れる。解釈・表示（和訳・説明）は
   * OperationEdge.operation と同じくフロントのチェーンプロファイル表現セット
   * の責務とする。
   */
  stage: string;
  /** そのステージが処理を終えたブロック高。 */
  checkpoint: number;
}

/**
 * ノード内部の観測状態（D層）。ノードプロセスが自己申告する内部メトリクス
 * （同期ステージの進行・mempool の内訳など）をチェーン非依存の語彙へ正規化
 * したもの。各フィールドは「そのノードが該当する内部構造を持ち、かつ観測
 * できた場合」のみ入る（省略 = 情報なし。フロントは表示自体を出さない側に
 * 倒す）。例: Ethereum プロファイルでは EL（reth）ノードのみが syncStages /
 * mempool を持ち、CL（beacon）ノードでは internals 自体が省略される。
 */
export interface NodeInternals {
  /** ステージ型同期の進行状況（クライアントが公開するステージ順）。 */
  syncStages?: SyncStageProgress[];
  /**
   * このノードローカルの mempool の内訳。pending は次のブロックに入れる
   * 状態の tx 数、queued は前提条件（nonce の飛び等）待ちで保留中の tx 数。
   * C層の mempool（チェーン全体の概念）に対し、こちらは「このノードが
   * いま抱えている実数」というノード内部の視点になる。
   */
  mempool?: { pending: number; queued: number };
}

export interface NodeEntity extends InfraEntity {
  kind: "node";
  chainType: ChainType;
  clientType: string;
  /**
   * チェーン先端への追従状態。"synced" = 先端に追いついている、
   * "syncing" = 追いつく途中（または観測がまだ得られていない既定値）。
   * 判定方法はチェーン・役割ごとに ChainAdapter が決める（例: Ethereum
   * プロファイルの EL は他ノードとの同期チェックポイント比較、CL は
   * ノード自身の自己申告。Issue #187 / #274）。
   */
  syncStatus: "syncing" | "synced";
  /**
   * チェーン先端への追従の進み具合を表す高さ（単調増加のカウンタ）。
   * 単位・意味づけはノードの役割に応じてチェーンプロファイルが決める
   * （例: Ethereum プロファイルの EL はブロック高、CL はヘッドスロット。
   * Issue #274）。したがって役割の異なるノード間でこの値を直接比較・
   * 集計してはならない（フロントの表示ラベルもチェーンプロファイル表現
   * セットが役割に応じて選ぶ）。観測がまだ無い間は 0（プレースホルダ）。
   */
  blockHeight: number;
  headBlockHash: string;
  /**
   * P2P ネットワーク上の役割。"bootnode" は新規参加ノードが最初に接続する
   * 入口役のノード、"peer" はそれ以外の通常ピア。bootnode はチェーン非依存の
   * P2P 一般語彙として使う（Bitcoin の seed node、libp2p の bootstrap peer も
   * この値に正規化する想定）。collector（ChainAdapter）が Docker ラベル
   * `com.chainviz.p2p-role` から導出する（Issue #65 の「ラベルを単一の真実の
   * 情報源とする」方針）。
   *
   * "none" は「P2P ネットワークに参加しないノード」を表す（Issue #214）。
   * チェーンのクライアントプロセスではあるが P2P の観測対象にならない
   * コンポーネント（例: Ethereum プロファイルの validator client。beacon へ
   * HTTP API で接続するだけで libp2p に参加しない）に ChainAdapter が設定する。
   * このノードを端点とする PeerEdge は決して観測されないため、フロントは
   * P2P 接続を前提にした表示（「接続確立中」エッジ等）の対象から除外する。
   *
   * optional なのはフィールド未付与の旧スナップショットとの互換のため。
   * 省略時は「不明」を意味し（"none" = 「参加しないと判明している」とは
   * 区別する）、フロントは `p2pRole === "bootnode"` の判定だけを行い、
   * 該当ノードが見つからなければブートノード前提の表示（バッジ・接続予定先の
   * 予告）を出さない側に倒す（Issue #123 / #124）。
   */
  p2pRole?: "bootnode" | "peer" | "none";
  /**
   * ノードの役割（そのノードがチェーンの動作の中で何をする係か。Issue #215）。
   * 値はチェーンプロファイル依存の生の文字列（例: Ethereum プロファイルでは
   * "execution" / "consensus" / "validator"）をそのまま入れ、解釈・表示
   * （和訳・用語解説への対応づけ）は OperationEdge.operation /
   * SyncStageProgress.stage と同じくフロントのチェーンプロファイル表現セット
   * の責務とする（execution/consensus はチェーン固有の概念なので、union 型で
   * このスキーマに焼き込まない）。
   *
   * collector（ChainAdapter）が Docker ラベル `com.chainviz.role` から導出する
   * （Issue #65 の「ラベルを単一の真実の情報源とする」方針。compose 起動の
   * 静的コンテナはノード環境テンプレートが、addNode の動的コンテナは
   * collector の lifecycle が、同じラベルを付与する）。
   *
   * p2pRole（P2P ネットワーク上の役割）とは別軸で、統合しない。例: Ethereum の
   * validator client は nodeRole = "validator" かつ p2pRole = "none"。
   *
   * optional なのはラベル未付与のコンテナ・旧スナップショットとの互換のため。
   * 省略 = 不明を意味し、フロントは役割表示を出さない側に倒す（p2pRole と
   * 同じ流儀）。フロント表現セットに無い未知の値も「不明」と同様に扱う。
   */
  nodeRole?: string;
  /**
   * D層: このノードが内部 API で駆動する相手ノード（同じ論理ノードを構成する
   * 相方クライアント）のエンティティ id。「駆動する側 → される側」という
   * 一般関係だけを載せ、Engine API のようなチェーン固有の語彙はスキーマに
   * 持ち込まない。Ethereum プロファイルでは 2 種類の関係に入る:
   * beacon（CL）ノードが対になる Execution（EL）ノードを Engine API で
   * 駆動する関係（Issue #186）と、validator client が対になる beacon ノードへ
   * Beacon API で接続してブロック提案・証明の職務を果たす関係（Issue #285。
   * validator → beacon → reth という「チェーンを動かす因果の連なり」を
   * 同じ仕組みで表現する）。どの役割の組にどんな意味づけ・文言を与えるかは、
   * 端点の nodeRole を見てフロントのチェーンプロファイル表現セットが決める
   * （nodeRole と同じ「チェーン固有語彙の解釈はフロント表現セットの責務」の
   * 流儀）。collector（ChainAdapter）がインフラ観測から毎回解決する
   * （WorkbenchEntity.rpcTargetNodeId と同じ考え方）。
   * 駆動関係を持たないノード・解決できない場合・旧スナップショットでは省略
   * （省略 = 無し/不明。フロントは内部リンクの表示を出さない側に倒す）。
   * フロントはこの値から常設の「内部リンク」エッジを導出して描画する。
   */
  drivesNodeId?: string;
  /**
   * D層: ノード内部の観測状態。内部メトリクスを公開しないノード・観測前・
   * 旧スナップショットでは省略（省略 = 情報なし）。
   */
  internals?: NodeInternals;
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
 * 内部 API 呼び出し 1 種類ぶんの観測値（D層）。呼び出し 1 回ごとの離散
 * イベントではなく、観測間隔（メトリクスのスクレイプ周期）内の増分として
 * 観測される点が OperationEdge（1 回の呼び出し = 1 イベント）と異なる。
 */
export interface InternalCallStats {
  /**
   * 呼び出しの種類。値はチェーン/クライアント依存の生の識別子（例:
   * "engine_newPayload"）をそのまま入れる。解釈・表示（分類・和訳）は
   * OperationEdge.operation と同じくフロントのチェーンプロファイル表現セット
   * の責務とする。
   */
  method: string;
  /** 観測間隔内に増えた呼び出し回数（1 以上。増分ゼロの種類は載せない）。 */
  count: number;
  /**
   * 呼び出し所要時間の代表値（ミリ秒）。クライアントが所要時間メトリクスを
   * 公開しており観測できた場合のみ入る（省略 = 観測不能）。
   */
  latencyMs?: number;
}

/**
 * 駆動リンク（NodeEntity.drivesNodeId が表す内部 API の関係）上で観測された
 * 呼び出し活動（揮発性）。OperationEdge と同じく「観測された瞬間の出来事」
 * なので、WorldStateSnapshot には含めない。DiffEvent の nodeLinkActivity で
 * のみ流れ、store の状態にも畳み込まない（描画側が受信時にパルス等の
 * アニメーションとして消費する）。
 */
export interface NodeLinkActivity {
  /** 駆動する側（NodeEntity.drivesNodeId を持つ側）のノード id。 */
  fromNodeId: string;
  /** 駆動される側のノード id。 */
  toNodeId: string;
  /** この観測間隔で増分のあった呼び出しの一覧（増分ゼロの種類は含めない）。 */
  calls: InternalCallStats[];
  /** 観測した時刻（epoch ms）。 */
  observedAt: number;
}

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
