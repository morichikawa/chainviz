import { describe, expect, it } from "vitest";
import type { ContainerObservation } from "../../docker/types.js";
import {
  beaconStableIdForExecution,
  beaconTargets,
  EXECUTION_RPC_PORT,
  EXECUTION_WS_PORT,
  executionPeerTargets,
  executionRpcUrls,
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
        rpcUrl: `http://172.28.1.1:${EXECUTION_RPC_PORT}`,
        // 対応する beacon が観測値に無いので自身の stableId にフォールバック。
        receivedAtKey: "chainviz-ethereum/reth1",
      },
    ]);
  });

  it("keys receivedAt to the matching beacon's stableId when present", () => {
    // 実 profile と同じ ID 体系: reth1 <-> beacon1、reth2 <-> beacon2。
    const reth2 = obs({
      stableId: "chainviz-ethereum/reth2",
      labels: { "com.docker.compose.service": "reth2" },
      ip: "172.28.1.2",
    });
    const beacon2 = obs({
      stableId: "chainviz-ethereum/beacon2",
      name: "chainviz-ethereum-beacon2-1",
      labels: { "com.docker.compose.service": "beacon2" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.2.2",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    const targets = executionTargets([
      obs(),
      reth2,
      beacon1,
      beacon2,
      validator1,
    ]);
    expect(
      targets.map((t) => ({
        stableId: t.stableId,
        receivedAtKey: t.receivedAtKey,
      })),
    ).toEqual([
      {
        stableId: "chainviz-ethereum/reth1",
        receivedAtKey: "chainviz-ethereum/beacon1",
      },
      {
        stableId: "chainviz-ethereum/reth2",
        receivedAtKey: "chainviz-ethereum/beacon2",
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
        rpcUrl: `http://172.28.1.5:${EXECUTION_RPC_PORT}`,
        receivedAtKey: "chainviz-ethereum/reth1",
      },
    ]);
  });

  it("returns no targets for an empty observation set", () => {
    expect(executionTargets([])).toEqual([]);
  });

  it("does not cross-map a reth to another node's beacon (no false fallback loss)", () => {
    // reth1 <-> beacon1 は対応するが、beacon を持たない reth2 は beacon1 に
    // 引きずられず自身の stableId にフォールバックする（クロス汚染しない）。
    const reth2 = obs({
      stableId: "chainviz-ethereum/reth2",
      labels: { "com.docker.compose.service": "reth2" },
      ip: "172.28.1.2",
    });
    const targets = executionTargets([obs(), reth2, beacon1]);
    expect(
      targets.map((t) => ({
        stableId: t.stableId,
        receivedAtKey: t.receivedAtKey,
      })),
    ).toEqual([
      {
        stableId: "chainviz-ethereum/reth1",
        receivedAtKey: "chainviz-ethereum/beacon1",
      },
      {
        // beacon2 は存在しないので自身の stableId にフォールバック。
        stableId: "chainviz-ethereum/reth2",
        receivedAtKey: "chainviz-ethereum/reth2",
      },
    ]);
  });

  it("all execution nodes fall back to their own stableId when no beacon exists", () => {
    const reth2 = obs({
      stableId: "chainviz-ethereum/reth2",
      labels: { "com.docker.compose.service": "reth2" },
      ip: "172.28.1.2",
    });
    const targets = executionTargets([obs(), reth2]);
    expect(targets.map((t) => t.receivedAtKey)).toEqual([
      "chainviz-ethereum/reth1",
      "chainviz-ethereum/reth2",
    ]);
  });

  it("maps a non-reth execution client to its beacon too (not reth-specific)", () => {
    // 対応付けは execution クライアント種別に依存しない。geth でも beacon に揃う。
    const geth1 = obs({
      stableId: "chainviz-ethereum/geth1",
      labels: { "com.docker.compose.service": "geth1" },
      image: "ethereum/client-go:latest",
      ip: "172.28.1.3",
      processes: [{ command: "geth", name: "geth" }],
    });
    const targets = executionTargets([geth1, beacon1]);
    expect(targets).toEqual([
      {
        stableId: "chainviz-ethereum/geth1",
        wsUrl: `ws://172.28.1.3:${EXECUTION_WS_PORT}`,
        rpcUrl: `http://172.28.1.3:${EXECUTION_RPC_PORT}`,
        receivedAtKey: "chainviz-ethereum/beacon1",
      },
    ]);
  });
});

describe("beaconStableIdForExecution", () => {
  it("maps a reth container to the beacon in the same logical node", () => {
    expect(beaconStableIdForExecution(obs(), [obs(), beacon1, validator1])).toBe(
      "chainviz-ethereum/beacon1",
    );
  });

  it("does not confuse different node groups", () => {
    const reth2 = obs({
      stableId: "chainviz-ethereum/reth2",
      labels: { "com.docker.compose.service": "reth2" },
      ip: "172.28.1.2",
    });
    // reth2 に対応する beacon2 は無いので、beacon1 に誤って対応付けない。
    expect(beaconStableIdForExecution(reth2, [reth2, beacon1])).toBeUndefined();
  });

  it("ignores validator containers even though they share the node key", () => {
    // validator1 も key "1" だが beacon ではないので対応先にしない。
    expect(
      beaconStableIdForExecution(obs(), [obs(), validator1]),
    ).toBeUndefined();
  });

  it("returns undefined when the execution service label is missing", () => {
    const noLabel = obs({ labels: {} });
    expect(
      beaconStableIdForExecution(noLabel, [noLabel, beacon1]),
    ).toBeUndefined();
  });

  it("matches single-node setups without a numeric suffix", () => {
    const reth = obs({
      stableId: "chainviz-ethereum/reth",
      labels: { "com.docker.compose.service": "reth" },
    });
    const beacon = obs({
      stableId: "chainviz-ethereum/beacon",
      labels: { "com.docker.compose.service": "beacon" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.2.9",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(beaconStableIdForExecution(reth, [reth, beacon])).toBe(
      "chainviz-ethereum/beacon",
    );
  });

  it("does not match a numeric-suffixed beacon to a suffix-less execution node", () => {
    // "reth"(key "") と "beacon1"(key "1") はキーが一致しないので対応させない。
    // 単一ノード表記の reth が番号付き beacon を誤って掴まないことを保証する。
    const reth = obs({
      stableId: "chainviz-ethereum/reth",
      labels: { "com.docker.compose.service": "reth" },
    });
    expect(beaconStableIdForExecution(reth, [reth, beacon1])).toBeUndefined();
  });

  it("strips the role prefix case-insensitively", () => {
    // サービス名が大文字でも同じノード群キーに正規化される（reth1/BEACON1 とも "1"）。
    const upperBeacon = obs({
      stableId: "chainviz-ethereum/BEACON1",
      labels: { "com.docker.compose.service": "BEACON1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.2.8",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    const upperReth = obs({
      labels: { "com.docker.compose.service": "RETH1" },
    });
    expect(beaconStableIdForExecution(upperReth, [upperReth, upperBeacon])).toBe(
      "chainviz-ethereum/BEACON1",
    );
  });

  it("matches on non-numeric node keys after the role prefix", () => {
    // サフィックスが数字でなくても、プレフィックスを剥がした残りが一致すれば対応する。
    const rethAlpha = obs({
      stableId: "chainviz-ethereum/reth-a",
      labels: { "com.docker.compose.service": "reth-a" },
    });
    const beaconAlpha = obs({
      stableId: "chainviz-ethereum/beacon-a",
      labels: { "com.docker.compose.service": "beacon-a" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.2.4",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(beaconStableIdForExecution(rethAlpha, [rethAlpha, beaconAlpha])).toBe(
      "chainviz-ethereum/beacon-a",
    );
  });

  it("returns undefined for an empty observation set", () => {
    expect(beaconStableIdForExecution(obs(), [])).toBeUndefined();
  });

  it("skips beacon candidates whose compose service label is missing", () => {
    // サービスラベルの無い beacon は isBeaconService 判定ができず対象外。
    // ラベル付きの正しい beacon があればそちらへ対応する。
    const beaconNoLabel = obs({
      stableId: "chainviz-ethereum/beacon1",
      labels: {},
      image: "sigp/lighthouse:latest",
      ip: "172.28.2.9",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(
      beaconStableIdForExecution(obs(), [obs(), beaconNoLabel]),
    ).toBeUndefined();
    expect(
      beaconStableIdForExecution(obs(), [obs(), beaconNoLabel, beacon1]),
    ).toBe("chainviz-ethereum/beacon1");
  });

  it("returns the first beacon encountered when several share the node key", () => {
    // 同じサービス名 beacon1 が別プロジェクトに複数存在する（キーがともに "1"）
    // 場合、現状は観測順で最初に見つかった beacon を返す。対応付けは
    // ノード群キーだけで行い、プロジェクト（stableId の接頭辞）は見ていない。
    const beaconOther = obs({
      stableId: "other-project/beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.9.1",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(
      beaconStableIdForExecution(obs(), [beaconOther, beacon1]),
    ).toBe("other-project/beacon1");
  });
});

describe("executionPeerTargets", () => {
  it("selects execution nodes and builds their peer-polling RPC URL", () => {
    expect(executionPeerTargets([obs()])).toEqual([
      {
        stableId: "chainviz-ethereum/reth1",
        rpcUrl: `http://172.28.1.1:${EXECUTION_RPC_PORT}`,
        networkId: "chainviz-ethereum-execution",
      },
    ]);
  });

  it("derives a networkId distinct from the consensus one", () => {
    // 同じプロジェクトでも EL(devp2p) と CL(libp2p) は別ネットワークとして
    // グルーピングする（Issue #106）。
    const elNetworkId = executionPeerTargets([obs()])[0].networkId;
    const clNetworkId = beaconTargets([beacon1])[0].networkId;
    expect(elNetworkId).toBe("chainviz-ethereum-execution");
    expect(clNetworkId).toBe("chainviz-ethereum-consensus");
    expect(elNetworkId).not.toBe(clNetworkId);
  });

  it("excludes beacon, validator and workbench containers", () => {
    expect(executionPeerTargets([beacon1, validator1, workbench])).toEqual([]);
  });

  it("excludes execution nodes without an IP address", () => {
    expect(executionPeerTargets([{ ...obs(), ip: "" }])).toEqual([]);
  });

  it("lists every execution node in a full observation set", () => {
    const reth2 = obs({
      stableId: "chainviz-ethereum/reth2",
      labels: { "com.docker.compose.service": "reth2" },
      ip: "172.28.1.2",
    });
    const targets = executionPeerTargets([obs(), reth2, beacon1, workbench]);
    expect(targets.map((t) => t.stableId)).toEqual([
      "chainviz-ethereum/reth1",
      "chainviz-ethereum/reth2",
    ]);
  });

  it("derives the network id from a stable id without a project prefix", () => {
    const noSlash = obs({ stableId: "reth1" });
    expect(executionPeerTargets([noSlash])[0].networkId).toBe(
      "reth1-execution",
    );
  });

  it("returns no targets for an empty observation set", () => {
    expect(executionPeerTargets([])).toEqual([]);
  });
});

describe("executionRpcUrls", () => {
  it("builds an HTTP JSON-RPC URL for each execution node", () => {
    expect(executionRpcUrls([obs()])).toEqual(["http://172.28.1.1:8545"]);
  });

  it("ignores beacon and workbench containers", () => {
    expect(executionRpcUrls([beacon1, workbench])).toEqual([]);
  });

  it("lists every reachable execution node", () => {
    const reth2 = obs({
      stableId: "chainviz-ethereum/reth2",
      labels: { "com.docker.compose.service": "reth2" },
      ip: "172.28.1.2",
    });
    expect(executionRpcUrls([obs(), reth2])).toEqual([
      "http://172.28.1.1:8545",
      "http://172.28.1.2:8545",
    ]);
  });

  it("skips execution containers without an IP", () => {
    expect(executionRpcUrls([obs({ ip: "" })])).toEqual([]);
  });
});
