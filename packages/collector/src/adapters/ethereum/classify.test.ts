import { describe, expect, it } from "vitest";
import type { ContainerObservation } from "../../docker/types.js";
import { classifyContainer } from "./classify.js";

function obs(
  overrides: Partial<ContainerObservation> = {},
): ContainerObservation {
  return {
    containerId: "cid",
    stableId: "chainviz-ethereum/reth1",
    name: "chainviz-ethereum-reth1-1",
    labels: {},
    image: "ghcr.io/paradigmxyz/reth:latest",
    state: "running",
    ip: "172.28.1.1",
    ports: [8545],
    processes: [{ command: "/usr/local/bin/reth node", name: "reth" }],
    resources: { cpuPercent: 1, memMB: 10 },
    ...overrides,
  };
}

describe("classifyContainer", () => {
  it("classifies a reth container as a node with clientType reth", () => {
    const result = classifyContainer(obs());
    expect(result.kind).toBe("node");
    expect(result.clientType).toBe("reth");
  });

  it("detects lighthouse by image", () => {
    const result = classifyContainer(
      obs({
        image: "sigp/lighthouse:latest",
        processes: [{ command: "lighthouse bn", name: "lighthouse" }],
      }),
    );
    expect(result.kind).toBe("node");
    expect(result.clientType).toBe("lighthouse");
  });

  it("classifies a foundry image as a workbench", () => {
    const result = classifyContainer(
      obs({
        image: "ghcr.io/foundry-rs/foundry:latest",
        labels: { "com.docker.compose.service": "workbench" },
        processes: [{ command: "sh -c sleep infinity", name: "sh" }],
      }),
    );
    expect(result.kind).toBe("workbench");
    expect(result.label).toBe("workbench");
  });

  it("detects a workbench by tool process even without a foundry image", () => {
    const result = classifyContainer(
      obs({
        image: "debian:bookworm",
        processes: [{ command: "anvil --host 0.0.0.0", name: "anvil" }],
      }),
    );
    expect(result.kind).toBe("workbench");
  });

  it("falls back to node with clientType from the first process when unknown", () => {
    const result = classifyContainer(
      obs({
        image: "some/custom-node:latest",
        labels: {},
        processes: [{ command: "mychain start", name: "mychain" }],
      }),
    );
    expect(result.kind).toBe("node");
    expect(result.clientType).toBe("mychain");
  });

  it("falls back to node with clientType unknown when there are no processes", () => {
    const result = classifyContainer(
      obs({ image: "scratch", labels: {}, processes: [] }),
    );
    expect(result.kind).toBe("node");
    expect(result.clientType).toBe("unknown");
  });

  it("uses the container name as workbench label when no service label exists", () => {
    const result = classifyContainer(
      obs({
        image: "ghcr.io/foundry-rs/foundry:latest",
        name: "my-workbench",
        labels: {},
        processes: [],
      }),
    );
    expect(result.kind).toBe("workbench");
    expect(result.label).toBe("my-workbench");
  });

  it("matches client identifiers case-insensitively", () => {
    const result = classifyContainer(
      obs({
        image: "MyOrg/RETH:LATEST",
        labels: {},
        processes: [{ command: "RETH node", name: "RETH" }],
      }),
    );
    expect(result.kind).toBe("node");
    expect(result.clientType).toBe("reth");
  });

  it("prefers workbench classification when both node and tool terms appear", () => {
    // reth プロセスを持つが foundry イメージ上で動くツールコンテナ。
    // ワークベンチ判定が先に走るのでワークベンチ扱いになる。
    const result = classifyContainer(
      obs({
        image: "ghcr.io/foundry-rs/foundry:latest",
        labels: { "com.docker.compose.service": "tools" },
        processes: [{ command: "reth db stats", name: "reth" }],
      }),
    );
    expect(result.kind).toBe("workbench");
    expect(result.label).toBe("tools");
  });

  it("detects the client type from the compose service label", () => {
    const result = classifyContainer(
      obs({
        image: "custom/generic-node:latest",
        labels: { "com.docker.compose.service": "geth-mainnet" },
        processes: [{ command: "/entrypoint.sh", name: "entrypoint.sh" }],
      }),
    );
    expect(result.kind).toBe("node");
    expect(result.clientType).toBe("geth");
  });

  it("does not classify as workbench when a term is a substring of a longer word", () => {
    // "broadcast" は "cast" を部分文字列として含むが、単語としては
    // ワークベンチツールではないのでノード扱いになるべき（部分一致の回帰防止）。
    const byProcess = classifyContainer(
      obs({
        image: "myorg/broadcaster-node:latest",
        labels: {},
        processes: [{ command: "broadcast --relay", name: "broadcast" }],
      }),
    );
    expect(byProcess.kind).toBe("node");

    const byService = classifyContainer(
      obs({
        image: "custom/generic-node:latest",
        labels: { "com.docker.compose.service": "broadcast" },
        processes: [{ command: "/entrypoint.sh", name: "entrypoint.sh" }],
      }),
    );
    expect(byService.kind).toBe("node");
  });

  it("does not match a tool term embedded in a longer word (forge/forged)", () => {
    const result = classifyContainer(
      obs({
        image: "myorg/forged-node:latest",
        labels: {},
        processes: [{ command: "forged run", name: "forged" }],
      }),
    );
    expect(result.kind).toBe("node");
  });

  it("still detects tool terms delimited by separators (foundry image path)", () => {
    // 区切り文字（/ : -）を挟んだ単語はワークベンチとして正しく検出される。
    const result = classifyContainer(
      obs({
        image: "ghcr.io/foundry-rs/foundry:latest",
        labels: {},
        processes: [{ command: "cast --version", name: "cast" }],
      }),
    );
    expect(result.kind).toBe("workbench");
  });

  it("classifies as node when the observation has no distinguishing signal", () => {
    const result = classifyContainer(
      obs({ image: "", name: "", labels: {}, processes: [] }),
    );
    expect(result.kind).toBe("node");
    expect(result.clientType).toBe("unknown");
    expect(result.label).toBe("");
  });
});
