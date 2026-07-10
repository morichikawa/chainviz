// Ethereum プロファイルにおけるノード/ワークベンチのライフサイクル操作。
// NodeLifecycle ポートを実装し、DockerOperations を使って実際のコンテナを
// 起動・削除する。
//
// ここには reth / lighthouse beacon / Foundry ワークベンチという Ethereum
// 固有の構成知識（イメージ・エントリポイント・環境変数・ボリューム・IP 帯）を
// 閉じ込める（CLAUDE.md「ChainAdapter 境界」）。共通層（commands/、server/）
// にはこれらの語彙を漏らさない。
//
// 新規ノードは「バリデーターなしのフォロワー reth + beacon ペア」として追加する
// （docs/PLAN.md ステップ 5）。beacon は BEACON_ROLE=peer で起動し、共有
// ボリューム clpeer 上の bootnode ENR（beacon1 が書き出したもの）を読んで
// 既存ネットワークへ参加する。
//
// 追加コンテナには compose 互換のラベル（project/service）を付ける。これにより
// 観測側（docker/observe.ts の computeStableId）が既存ノードと同じ
// "chainviz-ethereum/<service>" 形式の安定 ID を割り当て、ネットワークの
// グルーピングやピアエッジ・ブロック伝播の対応付け（adapters/ethereum/
// targets.ts）が既存ノードと同様に機能する。service 名は reth1/reth2 の慣習に
// 合わせて reth<n> / beacon<n>（n>=3）とし、reth と beacon で同じ n を共有する
// ことで両者が同じ論理ノードとして対応付く。

import path from "node:path";
import type { WorkbenchOperation } from "@chainviz/shared";
import type {
  NodeLifecycle,
  WorkbenchOperationResult,
} from "../../commands/lifecycle.js";
import type {
  ContainerSpec,
  DockerOperations,
  LabeledContainer,
} from "../../docker/operations.js";
import {
  COMPOSE_PROJECT_LABEL,
  COMPOSE_SERVICE_LABEL,
  MANAGED_LABEL,
  ROLE_LABEL,
} from "./labels.js";
import { readProfileMnemonic } from "./mnemonic.js";
import { summarizeOperationError } from "./operation-error-summary.js";
import {
  WALLET_INDEX_LABEL,
  workbenchWalletIndex,
} from "./wallet-derivation.js";
import {
  buildOperationCommand,
  describeOperation,
  parseOperationOutcome,
} from "./workbench-operations.js";

export { parseMnemonic } from "./mnemonic.js";

/** 実行層（reth）の固定 IP 帯。reth1=172.28.1.1, reth2=172.28.1.2。 */
const EXECUTION_IP_PREFIX = "172.28.1.";
/** 合意層（beacon）の固定 IP 帯。beacon1=172.28.2.1, beacon2=172.28.2.2。 */
const CONSENSUS_IP_PREFIX = "172.28.2.";
/** ノード番号の採番範囲。1,2 は compose のノードが使用済みなので 3 から。 */
const NODE_INDEX_START = 3;
const NODE_INDEX_END = 254;

/** reth の Engine API（authrpc）ポート。 */
const ENGINE_PORT = 8551;
/** reth の JSON-RPC / WS / P2P ポート（カード表示・観測用）。 */
const RETH_EXPOSED_PORTS = [8545, 8546, ENGINE_PORT, 30303];
/** beacon の HTTP API / P2P ポート。 */
const BEACON_EXPOSED_PORTS = [5052, 9000];

export interface EthereumNodeLifecycleConfig {
  /**
   * profiles/ethereum のホスト絶対パス。scripts/*.sh を bind mount する元。
   * collector はホスト上で動くため、compose と同じホストパスを参照できる前提。
   */
  profileDir: string;
  networkName?: string;
  genesisVolume?: string;
  clpeerVolume?: string;
  elpeerVolume?: string;
  composeProject?: string;
  rethImage?: string;
  lighthouseImage?: string;
  foundryImage?: string;
  /**
   * 追加ワークベンチが叩く RPC 接続先 URL。静的ワークベンチ
   * （docker-compose.yml の `workbench` サービス）と同様に、reth へ直結
   * させず必ずロギングプロキシ経由の URL を渡すこと（Issue #129）。直結
   * させると、ロギングプロキシがワークベンチの RPC 呼び出しを観測できず
   * 操作エッジが描画されなくなる。実際の値はロギングプロキシの待受設定
   * （collector 側の resolveProxyPort()）に追従させる必要があるため、この
   * アダプタ内では既定値を持たず呼び出し側（index.ts の
   * resolveWorkbenchRpcUrl()）が解決した値を必須で渡す。
   */
  ethRpcUrl: string;
  /**
   * runWorkbenchOperation の deployContract が成功し、デプロイ先アドレスを
   * 得られた場合に呼び出すコールバック（Issue #161/#163 の統合）。
   * EthereumAdapter.registerContractDeployment 相当を呼ぶことで、デプロイ先
   * アドレスとカタログキーの対応を C 層のコントラクト追跡（ContractTracker）へ
   * 登録し、GUI の定型操作からのデプロイもカタログ照合（name/catalogKey/token
   * 付与）の対象にする。EthereumNodeLifecycle は EthereumAdapter を直接
   * 参照せず（両者は index.ts の main() で並行に組み立てられており、相互に
   * import すると循環依存になる）、コールバック注入のみで結合する。未指定
   * なら呼び出しをスキップし、デプロイは従来どおり「未知のコントラクト」として
   * 検知されるだけになる。
   */
  onContractDeployed?: (address: string, contractKey: string) => void;
}

const DEFAULTS = {
  networkName: "chainviz-ethereum_chain",
  genesisVolume: "chainviz-ethereum_genesis",
  clpeerVolume: "chainviz-ethereum_clpeer",
  elpeerVolume: "chainviz-ethereum_elpeer",
  composeProject: "chainviz-ethereum",
  rethImage: "ghcr.io/paradigmxyz/reth:latest",
  lighthouseImage: "sigp/lighthouse:latest",
  foundryImage: "ghcr.io/foundry-rs/foundry:latest",
} as const;

// onContractDeployed は DEFAULTS に既定値を持たない任意のコールバックなので
// Required<> の対象から除外する（未指定時は undefined のまま保持する）。
type ResolvedConfig = Required<
  Omit<EthereumNodeLifecycleConfig, "onContractDeployed">
>;

interface ManagedContainer {
  stableId: string;
  containerId: string;
}

/**
 * collector が作成したワークベンチ 1 件。ManagedContainer に加えて、その
 * ワークベンチが主に使うウォレットの導出インデックスを保持する。CONCEPT.md の
 * 「1 ワークベンチ = 1 ユーザー = 1 つの主たる鍵」に沿い、ワークベンチごとに
 * 異なるインデックス（= 異なるアドレス）を割り当てて、誰の操作かを区別できる
 * ようにする。
 */
interface ManagedWorkbench extends ManagedContainer {
  walletIndex: number;
}

/**
 * ワークベンチのウォレット導出インデックスの採番開始値。0 は compose 由来の
 * （collector が採番しない）ワークベンチが使うため予約し、collector が作成する
 * ワークベンチは 1 から採番する。profiles/ethereum は 0〜7 の 8 アカウントを
 * プリマインしているので、1〜7 は残高付き、8 以降は残高 0 の有効なアドレスに
 * なる（残高 0 でも WalletEntity としては正しく表示される）。
 */
const WALLET_INDEX_START = 1;

/**
 * 既に使われている導出インデックス集合を避けて、最小の空きインデックスを返す。
 * WALLET_INDEX_START から順に探す。
 */
export function allocateWalletIndex(taken: ReadonlySet<number>): number {
  for (let i = WALLET_INDEX_START; ; i++) {
    if (!taken.has(i)) return i;
  }
}

/**
 * execution/consensus のどちらか、または両方を optional にしているのは、
 * 通常の addNode では常にペアで作られる一方、recoverManagedContainers に
 * よる起動時の回収では「片方だけ生き残っている」状態（例: removeNode が
 * 片方の削除に成功した直後に collector が落ちた場合）も現実に起こりうる
 * ため。片方だけでも登録しておけば、removeNode の再実行で後始末できる。
 */
interface ManagedNode {
  index: number;
  execution?: ManagedContainer;
  consensus?: ManagedContainer;
}

/** com.chainviz.role ラベルの値のうち、reth/beacon ペアを表すもの。 */
type NodeRole = "execution" | "consensus";

function isNodeRole(value: string | undefined): value is NodeRole {
  return value === "execution" || value === "consensus";
}

/**
 * reth<n> / beacon<n> という service 名から、ペア対応付けに使う番号 n を
 * 取り出す。形式に合わなければ undefined（回収時に読み捨てる対象）。
 */
export function parseNodeIndex(service: string): number | undefined {
  const match = service.match(/^(?:reth|beacon)(\d+)$/);
  if (!match) return undefined;
  const index = Number.parseInt(match[1] as string, 10);
  return Number.isFinite(index) ? index : undefined;
}

/**
 * 未使用のノード番号を採番する。reth 帯・beacon 帯の両方で同じ番号 n の IP
 * （172.28.1.n / 172.28.2.n）が空いており、かつ既に採番済みでない最小の n を
 * 返す。空きが無ければ undefined。
 */
export function allocateNodeIndex(
  usedIps: ReadonlySet<string>,
  takenIndexes: ReadonlySet<number>,
): number | undefined {
  for (let i = NODE_INDEX_START; i <= NODE_INDEX_END; i++) {
    if (takenIndexes.has(i)) continue;
    if (usedIps.has(`${EXECUTION_IP_PREFIX}${i}`)) continue;
    if (usedIps.has(`${CONSENSUS_IP_PREFIX}${i}`)) continue;
    return i;
  }
  return undefined;
}

/** URL 文字列からホスト部を取り出す。パースできなければ undefined。 */
export function extractHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** IPv4 リテラル表記（例: "172.28.1.1"）かどうか。ホスト名解決の要否判定に使う。 */
export function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** ラベル値やコンテナ名に使えるよう文字列を安全化する。 */
function slug(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "workbench";
}

export class EthereumNodeLifecycle implements NodeLifecycle {
  private readonly cfg: ResolvedConfig;
  private readonly onContractDeployed?: (
    address: string,
    contractKey: string,
  ) => void;
  private readonly nodes: ManagedNode[] = [];
  private readonly workbenches: ManagedWorkbench[] = [];
  private workbenchSeq = 0;

  constructor(
    private readonly ops: DockerOperations,
    config: EthereumNodeLifecycleConfig,
  ) {
    const { onContractDeployed, ...rest } = config;
    this.cfg = { ...DEFAULTS, ...rest };
    this.onContractDeployed = onContractDeployed;
  }

  /**
   * collector 起動時に呼び出し、この lifecycle が作成したコンテナ（前回の
   * 起動で addNode/addWorkbench が作成し、その後 collector プロセスの再起動で
   * メモリ上のレジストリから失われたもの）を Docker Engine API から走査して
   * レジストリ（this.nodes/this.workbenches）を再構築する。ファイルベースの
   * 永続化ではなく、Docker 側のラベルを単一の真実の情報源として扱う（Issue #65）。
   *
   * フィルタは `com.chainviz.managed=true` に加えて、この lifecycle が付与する
   * `com.docker.compose.project`（cfg.composeProject）も必須にする。managed
   * ラベルだけで絞ると、将来別のチェーンプロファイルの lifecycle が同じ
   * managed ラベルを使ったときに互いのコンテナを取り込んでしまい、チェーン
   * プロファイル独立性の原則（CLAUDE.md）に反するため。
   *
   * 呼び出し前提: レジストリがまだ空であること（collector 起動シーケンスの
   * 一部として一度だけ呼ぶ想定）。CommandHandler をワイヤリングする前
   * （addNode/removeNode 等を受け付ける前）に呼び出すこと。
   */
  async recoverManagedContainers(): Promise<void> {
    const containers = await this.ops.listContainersByLabels({
      [MANAGED_LABEL]: "true",
      [COMPOSE_PROJECT_LABEL]: this.cfg.composeProject,
    });

    const nodesByIndex = new Map<
      number,
      { execution?: ManagedContainer; consensus?: ManagedContainer }
    >();

    for (const container of containers) {
      const managed = this.toManagedContainer(container);
      if (!managed) continue;
      const { service, role, managedContainer } = managed;

      if (role === "workbench") {
        this.workbenches.push({
          ...managedContainer,
          walletIndex: workbenchWalletIndex(container.labels),
        });
        continue;
      }

      const index = parseNodeIndex(service);
      if (index === undefined) {
        console.warn(
          `[ethereum] managed ${role} container "${service}" has no parseable node index; skipped during recovery`,
        );
        continue;
      }
      const entry = nodesByIndex.get(index) ?? {};
      entry[role] = managedContainer;
      nodesByIndex.set(index, entry);
    }

    for (const [index, entry] of nodesByIndex) {
      this.nodes.push({
        index,
        execution: entry.execution,
        consensus: entry.consensus,
      });
    }

    // ワークベンチのコンテナ名サフィックス（-1, -2, ...）の採番を、回収できた
    // ワークベンチの個数から再開する。ラベルから復元できるのは過去に採番した
    // 最大番号ではなく現存する個数だけなので、過去に削除された分だけ番号が
    // 進んでいた場合は理論上サフィックスが衝突しうる。ただし衝突時は
    // createAndStart が失敗し commandResult(ok:false) として返るため実害は
    // 限定的で、復元直後の addWorkbench で同名衝突が起きにくくなる効果を優先する。
    this.workbenchSeq = this.workbenches.length;
  }

  /**
   * ラベル検索で見つかった 1 コンテナを、回収に必要な情報（service 名・
   * role・ManagedContainer）へ変換する。安定 ID を組み立てられない、または
   * role が想定外のコンテナは undefined を返し、呼び出し側で読み捨てる。
   */
  private toManagedContainer(
    container: LabeledContainer,
  ): { service: string; role: NodeRole | "workbench"; managedContainer: ManagedContainer } | undefined {
    const service = container.labels[COMPOSE_SERVICE_LABEL];
    if (!service) {
      console.warn(
        `[ethereum] managed container ${container.id} has no ${COMPOSE_SERVICE_LABEL} label; skipped during recovery`,
      );
      return undefined;
    }
    const role = container.labels[ROLE_LABEL];
    if (role !== "workbench" && !isNodeRole(role)) {
      console.warn(
        `[ethereum] managed container "${service}" has unknown role "${String(role)}"; skipped during recovery`,
      );
      return undefined;
    }
    // 安定 ID は "<project>/<service>" 形式で組み立てる（docker/observe.ts の
    // computeStableId と一致させるため）。project ラベルは addNode/addWorkbench
    // が必ず付与しており、listContainersByLabels のフィルタでも必須にしている
    // ので、正規のコンテナでは欠落しない。ここに来て欠落しているのは想定外の
    // 外来コンテナであり、composeProject で補完すると別プロジェクトのコンテナに
    // "chainviz-ethereum/<service>" という誤った安定 ID を付けてしまうため、
    // 補完はせず warn してスキップする。
    const project = container.labels[COMPOSE_PROJECT_LABEL];
    if (!project) {
      console.warn(
        `[ethereum] managed container "${service}" has no ${COMPOSE_PROJECT_LABEL} label; skipped during recovery`,
      );
      return undefined;
    }
    return {
      service,
      role,
      managedContainer: {
        stableId: `${project}/${service}`,
        containerId: container.id,
      },
    };
  }

  async addNode(chainProfile: string): Promise<void> {
    if (chainProfile !== "ethereum") {
      throw new Error(`unsupported chain profile: ${chainProfile}`);
    }

    const usedIps = new Set(await this.ops.usedNetworkIps(this.cfg.networkName));
    const takenIndexes = new Set(this.nodes.map((n) => n.index));
    const index = allocateNodeIndex(usedIps, takenIndexes);
    if (index === undefined) {
      throw new Error("no free node slot available in the network");
    }

    const executionIp = `${EXECUTION_IP_PREFIX}${index}`;
    const consensusIp = `${CONSENSUS_IP_PREFIX}${index}`;
    const rethService = `reth${index}`;
    const beaconService = `beacon${index}`;

    // reth を先に起動する（beacon の EXECUTION_ENDPOINT が reth を指すため）。
    const reth = await this.ops.createAndStart(
      this.rethSpec(rethService, executionIp),
    );

    let beacon;
    try {
      beacon = await this.ops.createAndStart(
        this.beaconSpec(beaconService, consensusIp, executionIp),
      );
    } catch (err) {
      // reth だけ孤立させないよう後始末してから失敗を伝える。
      // 後始末自体が失敗した場合はログに残す（握りつぶすと、孤立した
      // reth コンテナが A 層ポーリングでキャンバスに現れる一方、this.nodes
      // には未登録のため removeNode で拒否され、UI から消せないゴースト状態に
      // なってしまう）。ただし呼び出し元へは根本原因である元の beacon エラーを
      // 優先して再 throw し、後始末エラーに差し替えない。
      try {
        await this.ops.stopAndRemove(reth.id);
      } catch (cleanupErr) {
        console.error(
          "[ethereum] failed to roll back reth after beacon start failure:",
          cleanupErr,
        );
      }
      throw err;
    }

    this.nodes.push({
      index,
      execution: {
        stableId: `${this.cfg.composeProject}/${rethService}`,
        containerId: reth.id,
      },
      consensus: {
        stableId: `${this.cfg.composeProject}/${beaconService}`,
        containerId: beacon.id,
      },
    });
  }

  async removeNode(nodeId: string): Promise<void> {
    const idx = this.nodes.findIndex(
      (n) =>
        n.execution?.stableId === nodeId || n.consensus?.stableId === nodeId,
    );
    if (idx === -1) {
      throw new Error(
        `node ${nodeId} was not added via addNode and cannot be removed`,
      );
    }
    const node = this.nodes[idx];
    // consensus → execution の順に削除し、両方成功してから登録を外す。
    // 途中で失敗した場合も登録が残るため、removeNode の再実行でリトライ
    // できる（stopAndRemove は停止・削除済みのコンテナに対して失敗しない
    // ため、削除済み分を重ねて呼んでも安全）。片方しか記録されていない
    // 場合（起動時の回収で片割れしか見つからなかった場合）は、その片方
    // だけを削除する。
    if (node.consensus) await this.ops.stopAndRemove(node.consensus.containerId);
    if (node.execution) await this.ops.stopAndRemove(node.execution.containerId);
    const current = this.nodes.indexOf(node);
    if (current !== -1) this.nodes.splice(current, 1);
  }

  async addWorkbench(label: string): Promise<void> {
    const service = this.uniqueWorkbenchService(label);
    const walletIndex = allocateWalletIndex(
      new Set(this.workbenches.map((w) => w.walletIndex)),
    );
    const created = await this.ops.createAndStart(
      this.workbenchSpec(service, walletIndex),
    );
    this.workbenches.push({
      stableId: `${this.cfg.composeProject}/${service}`,
      containerId: created.id,
      walletIndex,
    });
  }

  async removeWorkbench(workbenchId: string): Promise<void> {
    const idx = this.workbenches.findIndex((w) => w.stableId === workbenchId);
    if (idx === -1) {
      throw new Error(
        `workbench ${workbenchId} was not added via addWorkbench and cannot be removed`,
      );
    }
    const workbench = this.workbenches[idx];
    // 削除が成功してから登録を外す（失敗時は登録が残り、再実行できる）。
    await this.ops.stopAndRemove(workbench.containerId);
    const current = this.workbenches.indexOf(workbench);
    if (current !== -1) this.workbenches.splice(current, 1);
  }

  /**
   * ワークベンチコンテナ内で定型操作（送金・コントラクトデプロイ・コントラクト
   * 呼び出し）を cast / forge の実行として行う（Issue #163）。ワークベンチが
   * 使う RPC 接続先（this.cfg.ethRpcUrl）は常にロギングプロキシ経由のため、
   * ここで実行する cast/forge の RPC 呼び出しも既存の観測経路（操作エッジ・
   * tx ライフサイクル）へ特別な配線なしにそのまま乗る
   * （docs/ARCHITECTURE.md §3）。
   */
  async runWorkbenchOperation(
    workbenchId: string,
    operation: WorkbenchOperation,
  ): Promise<WorkbenchOperationResult> {
    const mnemonic = this.readMnemonic();
    if (!mnemonic) {
      throw new Error(
        "mnemonic not found in profile values.env; cannot sign workbench operations",
      );
    }
    const container = await this.findWorkbenchContainer(workbenchId);
    const cmd = buildOperationCommand(operation, {
      mnemonic,
      walletIndex: container.walletIndex,
      ethRpcUrl: this.cfg.ethRpcUrl,
    });
    const result = await this.ops.exec(container.containerId, cmd);
    if (result.exitCode !== 0) {
      const detail =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `exit code ${result.exitCode}`;
      // 握りつぶさず、具体的な失敗内容（cast/forge の stderr 等）を必ず
      // console.error のログへ残す（CLAUDE.md「エラーを握りつぶすコードを
      // 見逃さない」）。ただし呼び出し元（CommandHandler → commandResult →
      // フロントのトースト）に伝える文言は、forge/cast の生の技術的
      // エラー（複数行・カラム位置指摘付きの英語パーサーエラー等）を
      // そのまま流さず、既知パターンを要約した簡潔な文言に変換する
      // （Issue #209。frontend 側の入力バリデーションをすり抜けるケースへの
      // 保険）。パターンに一致しない未知のエラーも、生メッセージを完全に
      // 隠さず最初の行を返す（summarizeOperationError 参照）。詳細な生の
      // 内容はこの console.error からいつでも追える。
      console.error(
        `[ethereum] workbench operation failed (${describeOperation(operation)}) on ${workbenchId}: ${detail}`,
      );
      throw new Error(
        `${describeOperation(operation)} failed on workbench ${workbenchId}: ${summarizeOperationError(detail)}`,
      );
    }
    const outcome = parseOperationOutcome(operation, result.stdout);
    // deployContract が成功し、デプロイ先アドレスを抽出できた場合は、
    // カタログ照合（name/catalogKey/token 付与）のためデプロイ先アドレスと
    // カタログキーの対応を登録する（Issue #161/#163 の統合）。forge create の
    // 出力形式が変わる等でアドレスを抽出できなかった場合は、既存の
    // parseOperationOutcome の方針（付随情報が取れなかっただけ扱い）に
    // 合わせて登録もスキップする（操作自体は成功しているため throw はしない）。
    if (operation.type === "deployContract" && outcome.deployedAddress) {
      // onContractDeployed（カタログ登録 → onContract → store.applyContract →
      // server.broadcastDiff という呼び出し連鎖）は付随処理であり、デプロイ
      // 自体はこの時点で既にオンチェーンで成功している。連鎖のどこかで例外が
      // 投げられても、それを理由にオンチェーンで成功したデプロイを
      // commandResult 上で失敗扱いにしない（parseOperationOutcome が付随情報の
      // 抽出失敗を成功扱いにしている既存方針と揃える）。ただし握りつぶさず、
      // 具体的なエラー内容は必ずログに残す。
      try {
        this.onContractDeployed?.(outcome.deployedAddress, operation.contractKey);
      } catch (err) {
        console.error(
          `[ethereum] onContractDeployed callback failed for ${outcome.deployedAddress} (contractKey=${operation.contractKey}) on ${workbenchId}:`,
          err,
        );
      }
    }
    return outcome;
  }

  /**
   * workbenchId（安定 ID "<project>/<service>"）から、cast/forge を実行する
   * コンテナ ID とウォレット導出インデックスを解決する。collector が
   * addWorkbench で作成した managed ワークベンチだけでなく、
   * docker-compose.yml の静的ワークベンチ（`workbench` サービス。managed
   * ラベルを持たない）も対象にする必要があるため、this.workbenches
   * （managed のみを追跡するメモリ上のレジストリ）には頼らず、compose project
   * ラベルだけでコンテナを走査して stableId の一致で絞り込む（Docker の
   * ラベルを単一の真実の情報源とする Issue #65 の方針と同じ）。ウォレット
   * 導出インデックスもコンテナのラベル（無ければ既定 0）から決めるため、
   * 静的ワークベンチは自動的に既定インデックス（プリマインの先頭アカウント）
   * を使うことになる。
   */
  private async findWorkbenchContainer(
    workbenchId: string,
  ): Promise<{ containerId: string; walletIndex: number }> {
    const containers = await this.ops.listContainersByLabels({
      [COMPOSE_PROJECT_LABEL]: this.cfg.composeProject,
    });
    for (const container of containers) {
      const service = container.labels[COMPOSE_SERVICE_LABEL];
      if (!service) continue;
      if (`${this.cfg.composeProject}/${service}` !== workbenchId) continue;
      return {
        containerId: container.id,
        walletIndex: workbenchWalletIndex(container.labels),
      };
    }
    throw new Error(`workbench ${workbenchId} not found`);
  }

  // --- コンテナ構成の組み立て（Ethereum 固有）---

  private rethSpec(service: string, ip: string): ContainerSpec {
    return {
      name: `${this.cfg.composeProject}-${service}`,
      image: this.cfg.rethImage,
      entrypoint: ["/bin/sh", "/scripts/reth-node.sh"],
      // 追加ノードは常に peer 役。既存の reth1 が boot 役として自分の enode を
      // 共有ボリューム elpeer に書き出し続けるため、peer はそれを読んで
      // 既存 EL ネットワークに接続し、履歴ブロックをバックフィルする。
      env: {
        RETH_ROLE: "peer",
        RETH_P2P_IP: ip,
      },
      labels: this.nodeLabels(service, "execution"),
      binds: [
        `${this.cfg.genesisVolume}:/genesis:ro`,
        `${this.cfg.elpeerVolume}:/elpeer:ro`,
        `${this.scriptPath("reth-node.sh")}:/scripts/reth-node.sh:ro`,
      ],
      networkName: this.cfg.networkName,
      ipv4Address: ip,
      exposedPorts: RETH_EXPOSED_PORTS,
    };
  }

  private beaconSpec(
    service: string,
    ip: string,
    executionIp: string,
  ): ContainerSpec {
    return {
      name: `${this.cfg.composeProject}-${service}`,
      image: this.cfg.lighthouseImage,
      entrypoint: ["/bin/sh", "/scripts/lighthouse-bn.sh"],
      env: {
        BEACON_ROLE: "peer",
        ENR_ADDRESS: ip,
        EXECUTION_ENDPOINT: `http://${executionIp}:${ENGINE_PORT}`,
      },
      labels: this.nodeLabels(service, "consensus"),
      binds: [
        `${this.cfg.genesisVolume}:/genesis:ro`,
        `${this.cfg.clpeerVolume}:/clpeer:ro`,
        `${this.scriptPath("lighthouse-bn.sh")}:/scripts/lighthouse-bn.sh:ro`,
      ],
      networkName: this.cfg.networkName,
      ipv4Address: ip,
      exposedPorts: BEACON_EXPOSED_PORTS,
    };
  }

  private workbenchSpec(service: string, walletIndex: number): ContainerSpec {
    const env: Record<string, string> = { ETH_RPC_URL: this.cfg.ethRpcUrl };
    const mnemonic = this.readMnemonic();
    if (mnemonic) env.EL_AND_CL_MNEMONIC = mnemonic;
    return {
      name: `${this.cfg.composeProject}-${slug(service)}-${++this.workbenchSeq}`,
      image: this.cfg.foundryImage,
      entrypoint: ["/bin/sh", "-c", "sleep infinity"],
      env,
      labels: this.workbenchLabels(service, walletIndex),
      networkName: this.cfg.networkName,
      extraHosts: this.workbenchExtraHosts(),
    };
  }

  /**
   * ethRpcUrl のホスト部がホスト名（IPv4 リテラルではない）なら、Docker の
   * host-gateway 予約値へマップする extra_hosts エントリを返す。既定の
   * ethRpcUrl は `host.docker.internal`（collector が動くホストマシンへの
   * Docker 標準の到達名）を指すため、通常はこの分岐に該当する
   * （profiles/ethereum/docker-compose.yml の静的ワークベンチと同じ仕組み）。
   * IPv4 直指定（テストでの上書き等）ではホスト解決が不要なので undefined。
   */
  private workbenchExtraHosts(): string[] | undefined {
    const host = extractHost(this.cfg.ethRpcUrl);
    if (!host || isIpv4Literal(host)) return undefined;
    return [`${host}:host-gateway`];
  }

  private nodeLabels(
    service: string,
    role: "execution" | "consensus",
  ): Record<string, string> {
    return {
      [COMPOSE_PROJECT_LABEL]: this.cfg.composeProject,
      [COMPOSE_SERVICE_LABEL]: service,
      [MANAGED_LABEL]: "true",
      [ROLE_LABEL]: role,
    };
  }

  private workbenchLabels(
    service: string,
    walletIndex: number,
  ): Record<string, string> {
    return {
      [COMPOSE_PROJECT_LABEL]: this.cfg.composeProject,
      [COMPOSE_SERVICE_LABEL]: service,
      [MANAGED_LABEL]: "true",
      [ROLE_LABEL]: "workbench",
      [WALLET_INDEX_LABEL]: String(walletIndex),
    };
  }

  /**
   * ワークベンチの service 名（= 表示ラベルの元）を決める。ユーザー指定の
   * ラベルを尊重しつつ、既に管理下にある同名ワークベンチと衝突する場合は
   * -2, -3... を付けて一意にする。
   */
  private uniqueWorkbenchService(label: string): string {
    const base = label.trim().length > 0 ? label.trim() : "workbench";
    const existing = new Set(
      this.workbenches.map((w) => w.stableId.split("/").slice(1).join("/")),
    );
    if (!existing.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!existing.has(candidate)) return candidate;
    }
  }

  private scriptPath(name: string): string {
    return path.join(this.cfg.profileDir, "scripts", name);
  }

  private readMnemonic(): string | undefined {
    return readProfileMnemonic(this.cfg.profileDir);
  }
}
