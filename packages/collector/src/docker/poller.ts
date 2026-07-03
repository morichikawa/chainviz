// Docker Engine API を叩いてコンテナの観測値を集める。1 回分の収集
// （pollOnce）を提供し、周期実行の制御は呼び出し側（index）に委ねる。

import {
  computeCpuPercent,
  computeMemMB,
  computeStableId,
  extractIp,
  extractName,
  extractPorts,
  parseTopProcesses,
} from "./observe.js";
import type {
  ContainerObservation,
  ContainerProcess,
  DockerClient,
  DockerContainerSummary,
} from "./types.js";

const EMPTY_RESOURCES = { cpuPercent: 0, memMB: 0 };

/**
 * Docker Engine API のポーラー。`/containers/json` で一覧を取り、各コンテナに
 * ついて `/containers/{id}/top` と `/containers/{id}/stats` を集める。
 * top / stats が個別に失敗しても（一覧取得後にコンテナが消えた等）そのコンテナ
 * だけ空値にフォールバックし、収集全体は落とさない。
 */
export class DockerPoller {
  constructor(private readonly client: DockerClient) {}

  /** 1 回分の観測を収集する。 */
  async pollOnce(): Promise<ContainerObservation[]> {
    const summaries = await this.client.listContainers({ all: false });
    return Promise.all(summaries.map((s) => this.observeContainer(s)));
  }

  private async observeContainer(
    summary: DockerContainerSummary,
  ): Promise<ContainerObservation> {
    const handle = this.client.getContainer(summary.Id);

    let processes: ContainerProcess[] = [];
    try {
      processes = parseTopProcesses(await handle.top());
    } catch {
      processes = [];
    }

    let resources = EMPTY_RESOURCES;
    try {
      const stats = await handle.stats({ stream: false });
      resources = {
        cpuPercent: computeCpuPercent(stats),
        memMB: computeMemMB(stats),
      };
    } catch {
      resources = EMPTY_RESOURCES;
    }

    return {
      containerId: summary.Id,
      stableId: computeStableId(summary),
      name: extractName(summary),
      labels: summary.Labels ?? {},
      image: summary.Image,
      state: summary.State,
      ip: extractIp(summary),
      ports: extractPorts(summary),
      processes,
      resources,
    };
  }
}
