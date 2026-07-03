// Ethereum プロファイルの ChainAdapter 実装。A 層（インフラ）では Docker の
// 観測値を NodeEntity / WorkbenchEntity に正規化する。B 層（ピア）・C 層
// （チェーンイベント）は後続 Phase で実装するため、ここでは未実装のままにする。

import type {
  ChainAdapter,
  DiffEvent,
  InfraEntity,
  NodeEntity,
  PeerEdge,
  WorkbenchEntity,
  WorldStateSnapshot,
} from "@chainviz/shared";
import type { DockerPoller } from "../../docker/poller.js";
import type {
  ContainerObservation,
  ContainerProcess,
} from "../../docker/types.js";
import { classifyContainer } from "./classify.js";

/**
 * InfraEntity.process は単一プロセスなので、コンテナ内の複数プロセスから
 * 「代表プロセス」を1つ選ぶ。優先名（クライアント種別など）に一致するものを
 * 優先し、無ければ先頭プロセス、それも無ければ "unknown" とする。
 */
function pickPrimaryProcess(
  processes: ContainerProcess[],
  preferred: string,
): { name: string; version?: string } {
  if (preferred) {
    const match = processes.find((p) => p.name === preferred);
    if (match) return { name: match.name };
  }
  const first = processes[0];
  if (first && first.name.length > 0) return { name: first.name };
  return { name: "unknown" };
}

export class EthereumAdapter implements ChainAdapter {
  readonly chainType = "ethereum" as const;

  constructor(private readonly poller: DockerPoller) {}

  /** A 層: Docker をポーリングし、コンテナを NodeEntity / WorkbenchEntity へ正規化する。 */
  async pollInfra(): Promise<Partial<WorldStateSnapshot>> {
    const observations = await this.poller.pollOnce();
    return {
      chainType: this.chainType,
      entities: observations.map((o) => this.toEntity(o)),
    };
  }

  private toEntity(obs: ContainerObservation): NodeEntity | WorkbenchEntity {
    const classification = classifyContainer(obs);
    const infra: InfraEntity = {
      id: obs.stableId,
      containerName: obs.name,
      ip: obs.ip,
      ports: obs.ports,
      resources: obs.resources,
      process: pickPrimaryProcess(obs.processes, classification.clientType),
    };

    if (classification.kind === "workbench") {
      return {
        ...infra,
        kind: "workbench",
        label: classification.label,
        walletIds: [],
      };
    }

    // A 層では同期状態・ブロック高は取得しない（B/C 層で埋める）。
    return {
      ...infra,
      kind: "node",
      chainType: this.chainType,
      clientType: classification.clientType,
      syncStatus: "syncing",
      blockHeight: 0,
      headBlockHash: "",
    };
  }

  // --- 後続 Phase で実装 ---

  /** B 層: ピア接続の購読。Phase 2 で実装する。 */
  subscribePeers(onUpdate: (edges: PeerEdge[]) => void): void {
    // 未実装（A 層の範囲外）。
    void onUpdate;
  }

  /** C 層: チェーンイベントの購読。Phase 3 で実装する。 */
  subscribeChainEvents(onEvent: (event: DiffEvent) => void): void {
    // 未実装（A 層の範囲外）。
    void onEvent;
  }
}
