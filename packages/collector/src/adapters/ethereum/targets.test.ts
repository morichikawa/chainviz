import { describe, expect, it } from "vitest";
import type { ContainerObservation } from "../../docker/types.js";
import {
  beaconTargets,
  EXECUTION_WS_PORT,
  executionTargets,
} from "./targets.js";

function obs(overrides: Partial<ContainerObservation> = {}): ContainerObservation {
  return {
    containerId: "cid",
    stableId: "chainviz-ethereum/reth1",
    name: "chainviz-ethereum-reth1-1",
    labels: { "com.docker.compose.service": "reth1" },
    image: "ghcr.io/paradigmxyz/reth:latest",
    state: "running",
    ip: "172.28.1.1",
    ports: [8545],
    processes: [{ command: "reth node", name: "reth" }],
    resources: { cpuPercent: 0, memMB: 0 },
    ...overrides,
  };
}

const beacon1 = obs({
  stableId: "chainviz-ethereum/beacon1",
  name: "chainviz-ethereum-beacon1-1",
  labels: { "com.docker.compose.service": "beacon1" },
  image: "sigp/lighthouse:latest",
  ip: "172.28.2.1",
  processes: [{ command: "lighthouse bn", name: "lighthouse" }],
});

const validator1 = obs({
  stableId: "chainviz-ethereum/validator1",
  name: "chainviz-ethereum-validator1-1",
  labels: { "com.docker.compose.service": "validator1" },
  image: "sigp/lighthouse:latest",
  ip: "172.28.0.3",
  processes: [{ command: "lighthouse vc", name: "lighthouse" }],
});

const workbench = obs({
  stableId: "chainviz-ethereum/workbench",
  labels: { "com.docker.compose.service": "workbench" },
  image: "ghcr.io/foundry-rs/foundry:latest",
  ip: "172.28.0.2",
  processes: [{ command: "sh -c sleep infinity", name: "sh" }],
});

describe("beaconTargets", () => {
  it("selects beacon nodes and builds their Beacon API base URL", () => {
    const targets = beaconTargets([beacon1]);
    expect(targets).toEqual([
      {
        stableId: "chainviz-ethereum/beacon1",
        baseUrl: "http://172.28.2.1:5052",
        networkId: "chainviz-ethereum-consensus",
      },
    ]);
  });

  it("excludes validator containers even though they run lighthouse", () => {
    // validator は lighthouse クライアントだが Beacon API を持たないため、
    // compose サービス名に beacon を含むものだけを対象にする。
    expect(beaconTargets([validator1])).toEqual([]);
  });

  it("excludes execution nodes and workbenches", () => {
    expect(beaconTargets([obs(), workbench])).toEqual([]);
  });

  it("excludes beacon nodes without an IP address", () => {
    expect(beaconTargets([{ ...beacon1, ip: "" }])).toEqual([]);
  });

  it("picks only the beacon nodes from a full observation set", () => {
    const targets = beaconTargets([obs(), beacon1, validator1, workbench]);
    expect(targets.map((t) => t.stableId)).toEqual([
      "chainviz-ethereum/beacon1",
    ]);
  });

  it("excludes a lighthouse container that has no compose service label", () => {
    // サービスラベルが取れないと beacon 判定ができないため対象外にする。
    const noLabel = obs({
      stableId: "chainviz-ethereum/beacon1",
      labels: {},
      image: "sigp/lighthouse:latest",
      ip: "172.28.2.9",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(beaconTargets([noLabel])).toEqual([]);
  });

  it("matches the beacon service name case-insensitively", () => {
    const upper = obs({
      stableId: "chainviz-ethereum/BEACON1",
      labels: { "com.docker.compose.service": "BEACON1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.2.5",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(beaconTargets([upper])).toHaveLength(1);
  });

  it("excludes an execution client even if its service name contains 'beacon'", () => {
    // "beacon" を含む紛らわしい名前でも、consensus クライアントでなければ除外。
    const misleading = obs({
      stableId: "chainviz-ethereum/beacon-proxy",
      labels: { "com.docker.compose.service": "beacon-proxy" },
      image: "ghcr.io/paradigmxyz/reth:latest",
      ip: "172.28.2.6",
      processes: [{ command: "reth node", name: "reth" }],
    });
    expect(beaconTargets([misleading])).toEqual([]);
  });

  it("derives the network id from a stable id without a project prefix", () => {
    const noSlash = obs({
      stableId: "beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.2.7",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(beaconTargets([noSlash])[0].networkId).toBe("beacon1-consensus");
  });

  it("returns no targets for an empty observation set", () => {
    expect(beaconTargets([])).toEqual([]);
  });
});

describe("executionTargets", () => {
  it("selects execution nodes and builds their WebSocket URL", () => {
    const targets = executionTargets([obs()]);
    expect(targets).toEqual([
      {
        stableId: "chainviz-ethereum/reth1",
        wsUrl: `ws://172.28.1.1:${EXECUTION_WS_PORT}`,
      },
    ]);
  });

  it("excludes beacon, validator and workbench containers", () => {
    expect(executionTargets([beacon1, validator1, workbench])).toEqual([]);
  });

  it("excludes execution nodes without an IP address", () => {
    expect(executionTargets([{ ...obs(), ip: "" }])).toEqual([]);
  });

  it("picks only the execution nodes from a full observation set", () => {
    const reth2 = obs({
      stableId: "chainviz-ethereum/reth2",
      labels: { "com.docker.compose.service": "reth2" },
      ip: "172.28.1.2",
    });
    const targets = executionTargets([obs(), reth2, beacon1, workbench]);
    expect(targets.map((t) => t.stableId)).toEqual([
      "chainviz-ethereum/reth1",
      "chainviz-ethereum/reth2",
    ]);
  });

  it("selects an execution node even without a compose service label", () => {
    // execution 判定はクライアント種別で行うため、サービスラベルが無くても選ぶ。
    const noLabel = obs({
      stableId: "chainviz-ethereum/reth1",
      labels: {},
      ip: "172.28.1.5",
    });
    expect(executionTargets([noLabel])).toEqual([
      {
        stableId: "chainviz-ethereum/reth1",
        wsUrl: `ws://172.28.1.5:${EXECUTION_WS_PORT}`,
      },
    ]);
  });

  it("returns no targets for an empty observation set", () => {
    expect(executionTargets([])).toEqual([]);
  });
});
