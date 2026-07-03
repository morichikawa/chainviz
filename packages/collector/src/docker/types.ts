// Docker Engine API のうち、A 層（インフラ）の可視化に必要な部分だけを
// 型として定義する。dockerode への直接依存をここで薄く抽象化し、
// ポーリング・正規化ロジックを実際の Docker なしでテストできるようにする。
// これらは Docker 共通の語彙であり、特定チェーン固有の概念は含まない。

/** `/containers/json`（listContainers）のポート情報。 */
export interface DockerPortBinding {
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
}

/** `/containers/json` のネットワーク設定（1 ネットワーク分）。 */
export interface DockerNetwork {
  IPAddress?: string;
}

/** `/containers/json` の 1 コンテナ分のサマリ。 */
export interface DockerContainerSummary {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Labels?: Record<string, string>;
  Ports?: DockerPortBinding[];
  NetworkSettings?: { Networks?: Record<string, DockerNetwork> };
}

/** `/containers/{id}/top` の結果。 */
export interface DockerTopResult {
  Titles: string[];
  Processes: string[][];
}

/** `/containers/{id}/stats` の CPU 使用量。 */
export interface DockerCpuStats {
  cpu_usage: { total_usage: number };
  system_cpu_usage?: number;
  online_cpus?: number;
}

/** `/containers/{id}/stats` のメモリ使用量。 */
export interface DockerMemoryStats {
  usage?: number;
  stats?: { cache?: number };
}

/** `/containers/{id}/stats`（stream=false）の結果。 */
export interface DockerStatsResult {
  cpu_stats: DockerCpuStats;
  precpu_stats: DockerCpuStats;
  memory_stats: DockerMemoryStats;
}

/** 1 コンテナへの操作ハンドル（dockerode の Container 相当の最小面）。 */
export interface DockerContainerHandle {
  top(): Promise<DockerTopResult>;
  stats(opts: { stream: false }): Promise<DockerStatsResult>;
}

/** Docker Engine API クライアントの最小面（dockerode の Docker 相当）。 */
export interface DockerClient {
  listContainers(opts?: {
    all?: boolean;
  }): Promise<DockerContainerSummary[]>;
  getContainer(id: string): DockerContainerHandle;
}

/** コンテナ内で観測された 1 プロセス。 */
export interface ContainerProcess {
  /** top の CMD 列そのまま。 */
  command: string;
  /** command から取り出した実行ファイル名（例: "reth"）。 */
  name: string;
}

/**
 * 1 コンテナの観測結果。Docker API の生レスポンスをチェーン非依存な形へ
 * まとめたもの。ここから先（NodeEntity 等への分類）は ChainAdapter が担う。
 */
export interface ContainerObservation {
  /** Docker コンテナ ID。再起動で変わるため内部処理用にのみ使う。 */
  containerId: string;
  /** 再起動で変わらない安定識別子（compose の project/service 等）。 */
  stableId: string;
  /** コンテナ名（先頭の "/" を除去済み）。 */
  name: string;
  labels: Record<string, string>;
  image: string;
  state: string;
  ip: string;
  ports: number[];
  processes: ContainerProcess[];
  resources: { cpuPercent: number; memMB: number };
}
