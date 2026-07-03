import { describe, expect, it } from "vitest";
import { DockerPoller } from "./poller.js";
import type {
  DockerClient,
  DockerContainerHandle,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "./types.js";

interface FakeContainer {
  summary: DockerContainerSummary;
  top?: DockerTopResult;
  stats?: DockerStatsResult;
  topError?: boolean;
  statsError?: boolean;
}

function fakeClient(containers: FakeContainer[]): DockerClient {
  const byId = new Map(containers.map((c) => [c.summary.Id, c]));
  return {
    listContainers: async () => containers.map((c) => c.summary),
    getContainer: (id: string): DockerContainerHandle => {
      const c = byId.get(id);
      return {
        top: async () => {
          if (!c || c.topError) throw new Error("top failed");
          return c.top ?? { Titles: ["CMD"], Processes: [] };
        },
        stats: async () => {
          if (!c || c.statsError) throw new Error("stats failed");
          return (
            c.stats ?? {
              cpu_stats: {
                cpu_usage: { total_usage: 0 },
                system_cpu_usage: 0,
              },
              precpu_stats: { cpu_usage: { total_usage: 0 } },
              memory_stats: {},
            }
          );
        },
      };
    },
  };
}

const rethStats: DockerStatsResult = {
  cpu_stats: {
    cpu_usage: { total_usage: 200 },
    system_cpu_usage: 2000,
    online_cpus: 2,
  },
  precpu_stats: {
    cpu_usage: { total_usage: 100 },
    system_cpu_usage: 1000,
  },
  memory_stats: { usage: 100 * 1024 * 1024, stats: { cache: 0 } },
};

describe("DockerPoller.pollOnce", () => {
  it("collects and normalizes a running container", async () => {
    const client = fakeClient([
      {
        summary: {
          Id: "id-reth1",
          Names: ["/chainviz-ethereum-reth1-1"],
          Image: "ghcr.io/paradigmxyz/reth:latest",
          State: "running",
          Labels: {
            "com.docker.compose.project": "chainviz-ethereum",
            "com.docker.compose.service": "reth1",
          },
          Ports: [{ PrivatePort: 8545, PublicPort: 8545, Type: "tcp" }],
          NetworkSettings: { Networks: { chain: { IPAddress: "172.28.1.1" } } },
        },
        top: {
          Titles: ["PID", "CMD"],
          Processes: [["1", "/usr/local/bin/reth node"]],
        },
        stats: rethStats,
      },
    ]);

    const [obs] = await new DockerPoller(client).pollOnce();

    expect(obs.stableId).toBe("chainviz-ethereum/reth1");
    expect(obs.containerId).toBe("id-reth1");
    expect(obs.name).toBe("chainviz-ethereum-reth1-1");
    expect(obs.ip).toBe("172.28.1.1");
    expect(obs.ports).toEqual([8545]);
    expect(obs.processes).toEqual([
      { command: "/usr/local/bin/reth node", name: "reth" },
    ]);
    // cpuDelta=100, systemDelta=1000, 2 cpus -> 20%
    expect(obs.resources).toEqual({ cpuPercent: 20, memMB: 100 });
  });

  it("falls back to empty process list when top fails", async () => {
    const client = fakeClient([
      {
        summary: {
          Id: "id-x",
          Names: ["/x"],
          Image: "reth",
          State: "running",
        },
        topError: true,
        stats: rethStats,
      },
    ]);

    const [obs] = await new DockerPoller(client).pollOnce();
    expect(obs.processes).toEqual([]);
    expect(obs.resources.memMB).toBe(100);
  });

  it("falls back to zero resources when stats fails", async () => {
    const client = fakeClient([
      {
        summary: {
          Id: "id-y",
          Names: ["/y"],
          Image: "reth",
          State: "running",
        },
        top: { Titles: ["CMD"], Processes: [["reth node"]] },
        statsError: true,
      },
    ]);

    const [obs] = await new DockerPoller(client).pollOnce();
    expect(obs.resources).toEqual({ cpuPercent: 0, memMB: 0 });
    expect(obs.processes).toEqual([{ command: "reth node", name: "reth" }]);
  });

  it("falls back on both process list and resources when top and stats fail", async () => {
    const client = fakeClient([
      {
        summary: {
          Id: "id-z",
          Names: ["/z"],
          Image: "reth",
          State: "running",
        },
        topError: true,
        statsError: true,
      },
    ]);

    const [obs] = await new DockerPoller(client).pollOnce();
    expect(obs.processes).toEqual([]);
    expect(obs.resources).toEqual({ cpuPercent: 0, memMB: 0 });
    // 観測自体は落とさず、コンテナは結果に残る
    expect(obs.containerId).toBe("id-z");
  });

  it("propagates an error when the container listing itself fails", async () => {
    const client: DockerClient = {
      listContainers: async () => {
        throw new Error("docker daemon unreachable");
      },
      getContainer: () => {
        throw new Error("should not be called");
      },
    };
    await expect(new DockerPoller(client).pollOnce()).rejects.toThrow(
      "docker daemon unreachable",
    );
  });

  it("returns one observation per container even when stable ids collide", async () => {
    // 同じ compose service ラベルを持つ 2 コンテナ（安定 ID が重複）。
    // ポーラーは重複排除せず両方返し、集約は上位（diff/store）に委ねる。
    const dupLabels = {
      "com.docker.compose.project": "p",
      "com.docker.compose.service": "reth1",
    };
    const client = fakeClient([
      {
        summary: {
          Id: "id-a",
          Names: ["/a"],
          Image: "reth",
          State: "running",
          Labels: dupLabels,
        },
      },
      {
        summary: {
          Id: "id-b",
          Names: ["/b"],
          Image: "reth",
          State: "running",
          Labels: dupLabels,
        },
      },
    ]);
    const obs = await new DockerPoller(client).pollOnce();
    expect(obs).toHaveLength(2);
    expect(obs.every((o) => o.stableId === "p/reth1")).toBe(true);
    expect(obs.map((o) => o.containerId)).toEqual(["id-a", "id-b"]);
  });

  it("returns an empty array when there are no containers", async () => {
    const obs = await new DockerPoller(fakeClient([])).pollOnce();
    expect(obs).toEqual([]);
  });

  it("collects every container in the list", async () => {
    const make = (id: string): FakeContainer => ({
      summary: {
        Id: id,
        Names: [`/${id}`],
        Image: "reth",
        State: "running",
      },
    });
    const client = fakeClient([make("a"), make("b"), make("c")]);
    const obs = await new DockerPoller(client).pollOnce();
    expect(obs.map((o) => o.containerId)).toEqual(["a", "b", "c"]);
  });
});
