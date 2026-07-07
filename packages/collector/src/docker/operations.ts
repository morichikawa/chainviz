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
  /**
   * コンテナの /etc/hosts に追記するエントリ（`docker run --add-host` 相当）。
   * "hostname:ip" 形式（`host.docker.internal:host-gateway` のような Docker
   * 標準の host-gateway 予約値を含む）。コンテナからホストマシン上のプロセス
   * （例: collector が動かすロギングプロキシ）へ到達させたい場合に使う。
   * Docker 共通の概念であり、チェーン固有の語彙は含まない。
   */
  extraHosts?: string[];
}

/** 作成したコンテナの参照。 */
export interface CreatedContainer {
  id: string;
}

/**
 * コンテナ内でのコマンド実行結果（`docker exec` 相当）。
 * プロセスが正常終了しても（stderr にログを吐くだけ等）exitCode が 0 なら
 * 成功、非 0 なら失敗として扱う（呼び出し側の契約）。
 */
export interface ExecResult {
  /** 実行したプロセスの終了コード。0 が成功。 */
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** ラベル検索で見つかったコンテナの最小情報。 */
export interface LabeledContainer {
  id: string;
  labels: Record<string, string>;
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
  /**
   * 指定したラベル（すべて一致）を持つコンテナ一覧を返す（停止中も含む）。
   * collector 起動時に、過去に addNode/addWorkbench で作成した managed
   * コンテナをラベルから回収し、レジストリを再構築するために使う
   * （ChainAdapter 側が停止中コンテナの扱いも判断できるよう、稼働状態に
   * 関わらず含める）。ラベルの意味（どのキーが何を表すか）はここでは扱わず、
   * 呼び出し側（ChainAdapter）が解釈する。
   */
  listContainersByLabels(
    labels: Record<string, string>,
  ): Promise<LabeledContainer[]>;
  /**
   * 起動中のコンテナ内でコマンドを実行し、完了まで待って結果を返す
   * （`docker exec` 相当）。runWorkbenchOperation がワークベンチコンテナ内で
   * cast / forge を実行するために使う（Issue #163）。
   *
   * `cmd` は配列で渡すこと。呼び出し側（adapters/ethereum 配下）はシェル文字列
   * 連結でコマンドを組み立てず、必ずトークンごとの配列のまま渡す契約とする
   * （シェルを経由しないため、値にシェル特殊文字が含まれてもコマンド
   * インジェクションが起きない）。
   */
  exec(containerId: string, cmd: string[]): Promise<ExecResult>;
}
