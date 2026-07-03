import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import { EthereumAdapter } from "./index.js";

const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

interface Fixture {
  summary: DockerContainerSummary;
  top: DockerTopResult;
}

function clientFrom(fixtures: Fixture[]): DockerClient {
  const byId = new Map(fixtures.map((f) => [f.summary.Id, f]));
  return {
    listContainers: async () => fixtures.map((f) => f.summary),
    getContainer: (id: string) => ({
      top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
      stats: async () => zeroStats,
    }),
  };
}

const rethFixture: Fixture = {
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
    Processes: [
      ["1", "/usr/local/bin/reth node"],
      ["2", "some-sidecar"],
    ],
  },
};

const workbenchFixture: Fixture = {
  summary: {
    Id: "id-wb",
    Names: ["/chainviz-ethereum-workbench-1"],
    Image: "ghcr.io/foundry-rs/foundry:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "workbench",
    },
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.3.1" } } },
  },
  top: { Titles: ["CMD"], Processes: [["sh -c sleep infinity"]] },
};

describe("EthereumAdapter.pollInfra", () => {
  it("normalizes a reth container into a NodeEntity with a stable id", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture])),
    );
    const partial = await adapter.pollInfra();

    expect(partial.chainType).toBe("ethereum");
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.kind).toBe("node");
    // 安定識別子はコンテナ ID ではない
    expect(node.id).toBe("chainviz-ethereum/reth1");
    expect(node.id).not.toBe("id-reth1");
    expect(node.containerName).toBe("chainviz-ethereum-reth1-1");
    expect(node.chainType).toBe("ethereum");
    expect(node.clientType).toBe("reth");
    expect(node.ip).toBe("172.28.1.1");
    expect(node.ports).toEqual([8545]);
    // 代表プロセスはクライアント種別に一致するものを選ぶ
    expect(node.process.name).toBe("reth");
    // A 層では同期状態・ブロック高は未取得のプレースホルダ
    expect(node.syncStatus).toBe("syncing");
    expect(node.blockHeight).toBe(0);
    expect(node.headBlockHash).toBe("");
  });

  it("normalizes a foundry container into a WorkbenchEntity", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([workbenchFixture])),
    );
    const partial = await adapter.pollInfra();

    const wb = partial.entities?.[0] as WorkbenchEntity;
    expect(wb.kind).toBe("workbench");
    expect(wb.id).toBe("chainviz-ethereum/workbench");
    expect(wb.label).toBe("workbench");
    expect(wb.walletIds).toEqual([]);
    expect(wb.process.name).toBe("sh");
  });

  it("normalizes a mixed set of containers", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture, workbenchFixture])),
    );
    const partial = await adapter.pollInfra();
    const kinds = partial.entities?.map((e) => e.kind);
    expect(kinds).toEqual(["node", "workbench"]);
  });

  it("returns an empty entity list when nothing is running", async () => {
    const adapter = new EthereumAdapter(new DockerPoller(clientFrom([])));
    const partial = await adapter.pollInfra();
    expect(partial.entities).toEqual([]);
  });

  it("keeps clientType from the image but process 'unknown' when top yields nothing", async () => {
    // top が空プロセスでも、イメージ名から reth と判定できる。代表プロセスは
    // 選べないので unknown にフォールバックする。
    const fixture: Fixture = {
      ...rethFixture,
      top: { Titles: ["CMD"], Processes: [] },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.clientType).toBe("reth");
    expect(node.process.name).toBe("unknown");
  });

  it("falls back to the first process when none matches the client type", async () => {
    // イメージからは reth と判定されるが、top には reth プロセスが無い場合、
    // 代表プロセスは先頭プロセスを採用する。
    const fixture: Fixture = {
      ...rethFixture,
      top: { Titles: ["CMD"], Processes: [["watchdog --pid 1"]] },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.clientType).toBe("reth");
    expect(node.process.name).toBe("watchdog");
  });

  it("uses the container id as entity id when no stable identifier is available", async () => {
    const fixture: Fixture = {
      summary: {
        Id: "raw-container-id",
        Names: [],
        Image: "reth",
        State: "running",
      },
      top: { Titles: ["CMD"], Processes: [["reth node"]] },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.id).toBe("raw-container-id");
    expect(node.containerName).toBe("");
  });

  it("rejects when the underlying poller fails to list containers", async () => {
    const failing: DockerClient = {
      listContainers: async () => {
        throw new Error("daemon down");
      },
      getContainer: () => {
        throw new Error("unused");
      },
    };
    const adapter = new EthereumAdapter(new DockerPoller(failing));
    await expect(adapter.pollInfra()).rejects.toThrow("daemon down");
  });
});
