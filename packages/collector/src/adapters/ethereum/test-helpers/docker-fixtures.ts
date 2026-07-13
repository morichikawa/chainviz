import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../../docker/types.js";

/**
 * Issue #309: peer-block-adapter.test.ts から切り出した共有fixture。
 * Docker コンテナ観測（listContainers/getContainer）をテスト用に固定する
 * ヘルパー群。
 */

export const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

export interface Fixture {
  summary: DockerContainerSummary;
  top: DockerTopResult;
}

export function clientFrom(fixtures: Fixture[]): DockerClient {
  const byId = new Map(fixtures.map((f) => [f.summary.Id, f]));
  return {
    listContainers: async () => fixtures.map((f) => f.summary),
    getContainer: (id: string) => ({
      top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
      stats: async () => zeroStats,
    }),
  };
}

/**
 * `fixtures` を毎回参照で読み直す DockerClient。配列の中身を呼び出し側が
 * 書き換える（push/splice/length=0）ことで、addNode/removeNode 相当のノード
 * 増減を後続の poll で反映できる（head-block-hash.test.ts の
 * mutableClientFrom と同じ発想。`clientFrom` は `getContainer` の解決に
 * 作成時点の `byId` スナップショットを使うため、生成後に追加された
 * コンテナの `top()` を正しく解決できない点が異なる）。
 */
export function mutableClientFrom(fixtures: Fixture[]): DockerClient {
  return {
    listContainers: async () => fixtures.map((f) => f.summary),
    getContainer: (id: string) => ({
      top: async () =>
        fixtures.find((f) => f.summary.Id === id)?.top ?? {
          Titles: ["CMD"],
          Processes: [],
        },
      stats: async () => zeroStats,
    }),
  };
}

export function beaconFixture(
  service: string,
  ip: string,
  processName = "lighthouse bn",
): Fixture {
  return {
    summary: {
      Id: `id-${service}`,
      Names: [`/chainviz-ethereum-${service}-1`],
      Image: "sigp/lighthouse:latest",
      State: "running",
      Labels: {
        "com.docker.compose.project": "chainviz-ethereum",
        "com.docker.compose.service": service,
      },
      NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
    },
    top: { Titles: ["CMD"], Processes: [[processName]] },
  };
}

export function rethFixture(service: string, ip: string): Fixture {
  return {
    summary: {
      Id: `id-${service}`,
      Names: [`/chainviz-ethereum-${service}-1`],
      Image: "ghcr.io/paradigmxyz/reth:latest",
      State: "running",
      Labels: {
        "com.docker.compose.project": "chainviz-ethereum",
        "com.docker.compose.service": service,
      },
      NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
    },
    top: { Titles: ["CMD"], Processes: [["reth node"]] },
  };
}

export function gethFixture(service: string, ip: string): Fixture {
  return {
    summary: {
      Id: `id-${service}`,
      Names: [`/chainviz-ethereum-${service}-1`],
      Image: "ethereum/client-go:latest",
      State: "running",
      Labels: {
        "com.docker.compose.project": "chainviz-ethereum",
        "com.docker.compose.service": service,
      },
      NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
    },
    top: { Titles: ["CMD"], Processes: [["geth"]] },
  };
}
