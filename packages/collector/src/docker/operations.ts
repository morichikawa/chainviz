// Docker Engine API のうち、コンテナのライフサイクル操作（作成・起動・停止・
// 削除）とネットワークの IP 使用状況の照会に必要な部分を抽象化する。
// 観測用の DockerClient（types.ts）とは別の関心事なので、操作面はこの
// インターフェースに分離する。dockerode への実際の依存は
// dockerode-operations.ts に閉じ込め、ここには含めない。
//
// ここで扱う語彙（イメージ・ボリューム・ネットワーク・IP）はいずれも Docker
// 共通のものであり、特定チェーン固有の概念（reth / beacon など）は含まない。
// チェーン固有のコンテナ構成の組み立ては ChainAdapter 側（adapters/ethereum/
// node-lifecycle.ts）が担う。

/** 起動するコンテナの構成。Docker 共通の語彙だけで表す。 */
export interface ContainerSpec {
  /** Docker コンテナ名（一意である必要がある）。 */
  name: string;
  /** イメージ参照（例: "ghcr.io/paradigmxyz/reth:latest"）。 */
  image: string;
  /** エントリポイント（未指定ならイメージ既定）。 */
  entrypoint?: string[];
  /** コマンド引数（未指定ならイメージ既定）。 */
  cmd?: string[];
  /** 環境変数（KEY=VALUE へ展開する）。 */
  env?: Record<string, string>;
  /** ラベル。 */
  labels?: Record<string, string>;
  /**
   * "source:target[:ro]" 形式のマウント指定。source は名前付きボリューム名でも
   * ホスト絶対パスでもよい（Docker の Binds と同じ書式）。
   */
  binds?: string[];
  /** 接続する Docker ネットワーク名。 */
  networkName: string;
  /** ネットワーク内での固定 IPv4 アドレス（未指定なら Docker が自動採番）。 */
  ipv4Address?: string;
  /** 公開（EXPOSE）する TCP ポート番号。 */
  exposedPorts?: number[];
}

/** 作成したコンテナの参照。 */
export interface CreatedContainer {
  id: string;
}

/** コンテナのライフサイクル操作の最小面（dockerode 実装で満たす）。 */
export interface DockerOperations {
  /** コンテナを作成して起動する。 */
  createAndStart(spec: ContainerSpec): Promise<CreatedContainer>;
  /** コンテナを停止して削除する。既に停止・削除済みでも失敗しない。 */
  stopAndRemove(containerId: string): Promise<void>;
  /**
   * 指定ネットワークで現在使用中の IPv4 アドレス一覧を返す（gateway を含む）。
   * 新規ノードの固定 IP を未使用帯から採番するために使う。
   */
  usedNetworkIps(networkName: string): Promise<string[]>;
}
