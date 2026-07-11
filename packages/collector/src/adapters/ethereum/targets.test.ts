import { describe, expect, it } from "vitest";
import type { ContainerObservation } from "../../docker/types.js";
import { ROLE_LABEL } from "./labels.js";
import { EXECUTION_METRICS_PORT } from "./reth-metrics-client.js";
import {
  beaconStableIdForExecution,
  beaconTargets,
  EXECUTION_RPC_PORT,
  EXECUTION_WS_PORT,
  executionMetricsTargets,
  executionPeerTargets,
  executionRpcUrls,
  executionStableIdForBeacon,
  executionTargets,
  isValidatorService,
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
  labels: {
    "com.docker.compose.service": "validator1",
    [ROLE_LABEL]: "validator",
  },
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
        // 対応する beacon が観測値に無いので自身の stableId のみの1要素配列。
        receivedAtKeys: ["chainviz-ethereum/reth1"],
      },
    ]);
  });

  it("keys receivedAt to both the matching beacon's stableId and its own when present", () => {
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
        receivedAtKeys: t.receivedAtKeys,
      })),
    ).toEqual([
      {
        stableId: "chainviz-ethereum/reth1",
        receivedAtKeys: ["chainviz-ethereum/beacon1", "chainviz-ethereum/reth1"],
      },
      {
        stableId: "chainviz-ethereum/reth2",
        receivedAtKeys: ["chainviz-ethereum/beacon2", "chainviz-ethereum/reth2"],
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
        receivedAtKeys: ["chainviz-ethereum/reth1"],
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
        receivedAtKeys: t.receivedAtKeys,
      })),
    ).toEqual([
      {
        stableId: "chainviz-ethereum/reth1",
        receivedAtKeys: ["chainviz-ethereum/beacon1", "chainviz-ethereum/reth1"],
      },
      {
        // beacon2 は存在しないので自身の stableId のみの1要素配列にフォールバック。
        stableId: "chainviz-ethereum/reth2",
        receivedAtKeys: ["chainviz-ethereum/reth2"],
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
    expect(targets.map((t) => t.receivedAtKeys)).toEqual([
      ["chainviz-ethereum/reth1"],
      ["chainviz-ethereum/reth2"],
    ]);
  });

  it("orders receivedAtKeys as [beacon, self] and keeps the two distinct (no self-aliasing)", () => {
    // 契約: beacon 対応時は必ず [beacon の stableId, 自身の stableId] の順で、
    // 自身の stableId が beacon キーと重複しない。beacon キーが CL エイリアス
    // 用・自身キーが EL エッジ用という役割の前提を固定する。
    const [target] = executionTargets([obs(), beacon1]);
    expect(target.receivedAtKeys).toEqual([
      "chainviz-ethereum/beacon1",
      "chainviz-ethereum/reth1",
    ]);
    expect(target.receivedAtKeys[0]).not.toBe(target.receivedAtKeys[1]);
    expect(new Set(target.receivedAtKeys).size).toBe(
      target.receivedAtKeys.length,
    );
  });

  it("uses the same-project beacon for the shared node key even when a different project's beacon is observed first", () => {
    // 別プロジェクトの beacon1 が観測に混ざってノード群キー "1" を共有する
    // 場合でも、receivedAtKeys の beacon キーは execution と同じ docker
    // compose プロジェクトに属する beacon にスコープされる（Issue #153）。
    const beaconOther = obs({
      stableId: "other-project/beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.9.1",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    const [target] = executionTargets([obs(), beaconOther, beacon1]);
    expect(target.receivedAtKeys).toEqual([
      "chainviz-ethereum/beacon1",
      "chainviz-ethereum/reth1",
    ]);
  });

  it("keeps receivedAt beacon keys within each project when multiple projects are observed together", () => {
    // executionTargets 経由でも Issue #153 のスコープが働くことを end-to-end で
    // 固定する。2 プロジェクトが同時観測され、観測順で別プロジェクトの beacon が
    // 先に来ても、各 reth の receivedAtKeys の beacon キーは同一プロジェクトの
    // beacon になる（クロスプロジェクトのエッジが発生しない）。
    const rethA = obs({
      stableId: "proj-a/reth1",
      labels: { "com.docker.compose.service": "reth1" },
      ip: "172.28.11.1",
    });
    const rethB = obs({
      stableId: "proj-b/reth1",
      labels: { "com.docker.compose.service": "reth1" },
      ip: "172.28.11.2",
    });
    const beaconA = obs({
      stableId: "proj-a/beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.10.1",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    const beaconB = obs({
      stableId: "proj-b/beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.10.2",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    // beacon を先に、しかもプロジェクト順を入れ替えて観測させる。
    const targets = executionTargets([beaconB, beaconA, rethA, rethB]);
    expect(
      targets.map((t) => ({
        stableId: t.stableId,
        receivedAtKeys: t.receivedAtKeys,
      })),
    ).toEqual([
      {
        stableId: "proj-a/reth1",
        receivedAtKeys: ["proj-a/beacon1", "proj-a/reth1"],
      },
      {
        stableId: "proj-b/reth1",
        receivedAtKeys: ["proj-b/beacon1", "proj-b/reth1"],
      },
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
        receivedAtKeys: ["chainviz-ethereum/beacon1", "chainviz-ethereum/geth1"],
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

  it("only matches a beacon within the same compose project, even if another project's beacon is observed first", () => {
    // 同じサービス名 beacon1 が別プロジェクトにも存在する（ノード群キーは
    // ともに "1" で一致する）場合でも、docker compose プロジェクト
    // （stableId の "<project>/" 部分、projectOf()）が異なる beacon は対応
    // 付けない。1 つの collector インスタンスが複数プロジェクトを同時に
    // 観測する状況（通常運用では起きないが QA 検証等で発生しうる）でも、
    // プロジェクト跨ぎの対応付けが起きないことを保証する（Issue #153）。
    const beaconOther = obs({
      stableId: "other-project/beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.9.1",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    // 他プロジェクトの beacon が観測順で先に来ても、自プロジェクト
    // （chainviz-ethereum）の beacon1 だけが選ばれる。
    expect(
      beaconStableIdForExecution(obs(), [beaconOther, beacon1]),
    ).toBe("chainviz-ethereum/beacon1");
  });

  it("returns undefined when only a different project's beacon shares the node key", () => {
    // 自プロジェクトに対応する beacon が存在せず、別プロジェクトの
    // 同名サービスしか無い場合はフォールバック（undefined）する。
    const beaconOther = obs({
      stableId: "other-project/beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.9.1",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(
      beaconStableIdForExecution(obs(), [beaconOther]),
    ).toBeUndefined();
  });

  it("scopes each execution to its own project's beacon across three mixed projects", () => {
    // 3 プロジェクト（proj-a/proj-b/proj-c）がノード群キー "1" を共有した状態で
    // 同時観測されても、各 execution は自プロジェクトの beacon にだけ対応する
    // （Issue #153 のスコープが 2 プロジェクト超でも成立することを固定する）。
    const beaconFor = (project: string, ip: string) =>
      obs({
        stableId: `${project}/beacon1`,
        labels: { "com.docker.compose.service": "beacon1" },
        image: "sigp/lighthouse:latest",
        ip,
        processes: [{ command: "lighthouse bn", name: "lighthouse" }],
      });
    const rethFor = (project: string, ip: string) =>
      obs({
        stableId: `${project}/reth1`,
        labels: { "com.docker.compose.service": "reth1" },
        ip,
      });
    const beaconA = beaconFor("proj-a", "172.28.10.1");
    const beaconB = beaconFor("proj-b", "172.28.10.2");
    const beaconC = beaconFor("proj-c", "172.28.10.3");
    const rethA = rethFor("proj-a", "172.28.11.1");
    const rethB = rethFor("proj-b", "172.28.11.2");
    const rethC = rethFor("proj-c", "172.28.11.3");
    // 観測順は意図的にプロジェクトを交錯させる（先に来た別プロジェクトの
    // beacon を掴まないこと）。
    const all = [beaconC, beaconA, beaconB, rethA, rethB, rethC];
    expect(beaconStableIdForExecution(rethA, all)).toBe("proj-a/beacon1");
    expect(beaconStableIdForExecution(rethB, all)).toBe("proj-b/beacon1");
    expect(beaconStableIdForExecution(rethC, all)).toBe("proj-c/beacon1");
  });

  it("requires an exact project match, not a prefix match", () => {
    // プロジェクト名がもう一方の接頭辞になっている（"chainviz" ⊂
    // "chainviz-ethereum"）場合でも、projectOf は先頭セグメントの完全一致で
    // 判定するので別プロジェクト扱いになり対応付けない。
    const beaconPrefixProject = obs({
      stableId: "chainviz/beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.12.1",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(
      beaconStableIdForExecution(obs(), [beaconPrefixProject]),
    ).toBeUndefined();
  });

  it("does not match a beacon whose stableId lacks a project prefix", () => {
    // execution にはプロジェクト接頭辞があり、beacon 側の stableId には無い
    // 場合、beacon の projectOf は stableId 全体（"beacon1"）になり
    // execution のプロジェクト（"chainviz-ethereum"）と一致しないため
    // 対応付けない。
    const bareBeacon = obs({
      stableId: "beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.12.2",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(
      beaconStableIdForExecution(obs(), [bareBeacon]),
    ).toBeUndefined();
  });

  it("does not match when neither execution nor beacon carries a project prefix", () => {
    // プロジェクト接頭辞が無い（compose ラベルが揃わずコンテナ名に
    // フォールバックした）stableId 同士では、projectOf がそれぞれ "reth1" /
    // "beacon1" を返して一致しないため対応が取れない。プロジェクト接頭辞に
    // 依存する現仕様の限界を固定する（通常運用の stableId は必ず
    // "<project>/<service>" 形式なので実害は無い。詳細は worklog 参照）。
    const bareReth = obs({
      stableId: "reth1",
      labels: { "com.docker.compose.service": "reth1" },
    });
    const bareBeacon = obs({
      stableId: "beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.12.3",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(
      beaconStableIdForExecution(bareReth, [bareReth, bareBeacon]),
    ).toBeUndefined();
  });

  it("uses only the leading path segment as the project (extra slashes belong to the project boundary)", () => {
    // computeStableId は "<project>/<service>" の 1 スラッシュ形式を作るが、
    // projectOf は split("/")[0] で先頭セグメントのみをプロジェクトとみなす。
    // 仮に stableId に想定外の追加スラッシュが含まれても、先頭セグメントが
    // 一致すれば同一プロジェクト扱いになることを固定する。
    const rethNested = obs({
      stableId: "proj/extra/reth1",
      labels: { "com.docker.compose.service": "reth1" },
    });
    const beaconNested = obs({
      stableId: "proj/extra/beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.12.4",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    expect(
      beaconStableIdForExecution(rethNested, [rethNested, beaconNested]),
    ).toBe("proj/extra/beacon1");
  });
});

describe("executionStableIdForBeacon (Issue #186)", () => {
  it("maps a beacon container to the execution node in the same logical node", () => {
    expect(
      executionStableIdForBeacon(beacon1, [obs(), beacon1, validator1]),
    ).toBe("chainviz-ethereum/reth1");
  });

  it("does not confuse different node groups", () => {
    const beacon2 = obs({
      stableId: "chainviz-ethereum/beacon2",
      labels: { "com.docker.compose.service": "beacon2" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.2.2",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    // beacon2 に対応する reth2 は無いので、reth1 に誤って対応付けない。
    expect(
      executionStableIdForBeacon(beacon2, [obs(), beacon2]),
    ).toBeUndefined();
  });

  it("returns undefined when called with a validator container (not a beacon)", () => {
    // validator1 も lighthouse だが isBeaconService が false になるため、
    // 「そもそも beacon 役ではない」経路で undefined を返す。
    expect(
      executionStableIdForBeacon(validator1, [obs(), beacon1, validator1]),
    ).toBeUndefined();
  });

  it("returns undefined when called with an execution container (not a beacon)", () => {
    // pollInfra は全 NodeEntity に対して機械的に呼ぶため、reth 自身に対して
    // 呼んでも自己参照や無関係な対応付けを返さない自己防衛を確認する。
    expect(
      executionStableIdForBeacon(obs(), [obs(), beacon1]),
    ).toBeUndefined();
  });

  it("returns undefined when called with a workbench container (not a beacon)", () => {
    expect(
      executionStableIdForBeacon(workbench, [obs(), beacon1, workbench]),
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
    expect(executionStableIdForBeacon(beacon, [reth, beacon])).toBe(
      "chainviz-ethereum/reth",
    );
  });

  it("picks the paired execution among multiple execution candidates in the same project", () => {
    // beacon1 のノード群キーは "1" なので同一プロジェクト内に reth1/reth2 が
    // あっても reth1 だけに対応し、reth2 へ誤って対応付けない。
    const reth2 = obs({
      stableId: "chainviz-ethereum/reth2",
      name: "chainviz-ethereum-reth2-1",
      labels: { "com.docker.compose.service": "reth2" },
      ip: "172.28.1.2",
    });
    expect(executionStableIdForBeacon(beacon1, [obs(), reth2, beacon1])).toBe(
      "chainviz-ethereum/reth1",
    );
  });

  it("does not map a beacon to an execution node in a different compose project", () => {
    // ノード群キー "1" は一致するが projectOf が異なる（projA ≠ projB）ため
    // findPairedStableId のプロジェクトスコープにより対応付けない。1 つの
    // collector が複数 compose プロジェクトを同時観測する状況（QA 検証等）で
    // 別プロジェクトのコンテナを誤って対応付けないことを固定する。
    const beaconProjA = obs({
      stableId: "projA/beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.20.1",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    const rethProjB = obs({
      stableId: "projB/reth1",
      labels: { "com.docker.compose.service": "reth1" },
      ip: "172.28.20.2",
    });
    expect(
      executionStableIdForBeacon(beaconProjA, [beaconProjA, rethProjB]),
    ).toBeUndefined();
  });

  it("returns undefined when the observations list is empty", () => {
    expect(executionStableIdForBeacon(beacon1, [])).toBeUndefined();
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

  it("selects every execution client type, not just reth", () => {
    // 対象は EXECUTION_CLIENTS 全般（reth 専用ではない）。geth も admin_* を
    // 持つので同じくピア取得対象に含める。
    const geth1 = obs({
      stableId: "chainviz-ethereum/geth1",
      labels: { "com.docker.compose.service": "geth1" },
      image: "ethereum/client-go:latest",
      ip: "172.28.1.3",
      processes: [{ command: "geth", name: "geth" }],
    });
    const targets = executionPeerTargets([obs(), geth1]);
    expect(targets.map((t) => t.stableId)).toEqual([
      "chainviz-ethereum/reth1",
      "chainviz-ethereum/geth1",
    ]);
  });

  it("does not collide EL/CL networkIds when the project name contains '-consensus'", () => {
    // プロジェクト名にハイフンや紛らわしい語（-consensus）が入っていても、
    // EL は必ず -execution、CL は必ず -consensus を付けるので衝突しない。
    const rethWeird = obs({
      stableId: "weird-consensus/reth1",
      labels: { "com.docker.compose.service": "reth1" },
    });
    const beaconWeird = obs({
      stableId: "weird-consensus/beacon1",
      labels: { "com.docker.compose.service": "beacon1" },
      image: "sigp/lighthouse:latest",
      ip: "172.28.2.9",
      processes: [{ command: "lighthouse bn", name: "lighthouse" }],
    });
    const elNetworkId = executionPeerTargets([rethWeird])[0].networkId;
    const clNetworkId = beaconTargets([beaconWeird])[0].networkId;
    expect(elNetworkId).toBe("weird-consensus-execution");
    expect(clNetworkId).toBe("weird-consensus-consensus");
    expect(elNetworkId).not.toBe(clNetworkId);
  });

  it("derives each execution peer target's networkId from its own project when several projects are observed together", () => {
    // executionPeerTargets はノード横断の対応付けを一切せず、各 execution の
    // networkId を自身の stableId から導く。複数プロジェクトが混在しても
    // プロジェクトを跨いだ networkId の混線は起きない（このファイルで
    // beaconStableIdForExecution 以外にプロジェクト・スコープ漏れが無いことの
    // 確認を兼ねる）。
    const rethA = obs({
      stableId: "proj-a/reth1",
      labels: { "com.docker.compose.service": "reth1" },
      ip: "172.28.11.1",
    });
    const rethB = obs({
      stableId: "proj-b/reth1",
      labels: { "com.docker.compose.service": "reth1" },
      ip: "172.28.11.2",
    });
    const targets = executionPeerTargets([rethA, rethB]);
    expect(
      targets.map((t) => ({ stableId: t.stableId, networkId: t.networkId })),
    ).toEqual([
      { stableId: "proj-a/reth1", networkId: "proj-a-execution" },
      { stableId: "proj-b/reth1", networkId: "proj-b-execution" },
    ]);
  });

  it("keeps EL/CL networkIds distinct even across different projects (suffix guarantees separation)", () => {
    // あるプロジェクトの EL networkId が別プロジェクトの CL networkId と偶然
    // 一致することはない（末尾が -execution / -consensus で必ず異なるため）。
    const elA = executionPeerTargets([
      obs({ stableId: "proj-a/reth1" }),
    ])[0].networkId;
    const clB = beaconTargets([
      obs({
        stableId: "proj-a-execution/beacon1",
        labels: { "com.docker.compose.service": "beacon1" },
        image: "sigp/lighthouse:latest",
        ip: "172.28.2.3",
        processes: [{ command: "lighthouse bn", name: "lighthouse" }],
      }),
    ])[0].networkId;
    // proj-a-execution == proj-a + "-execution" のように紛れそうでも一致しない。
    expect(elA).toBe("proj-a-execution");
    expect(clB).toBe("proj-a-execution-consensus");
    expect(elA).not.toBe(clB);
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

describe("isValidatorService (Issue #246, com.chainviz.role ベースの判定)", () => {
  it("returns true when com.chainviz.role is exactly 'validator'", () => {
    expect(isValidatorService(validator1)).toBe(true);
  });

  it("returns false for beacon and execution services (no role label)", () => {
    expect(isValidatorService(beacon1)).toBe(false);
    expect(isValidatorService(obs())).toBe(false);
  });

  it("returns false when the role label is missing entirely", () => {
    expect(isValidatorService(obs({ labels: {} }))).toBe(false);
  });

  it("returns false when the compose service label is missing but the role label is present", () => {
    // 判定はロール ラベルのみを見るため、compose サービス名ラベル自体が
    // 欠けていても com.chainviz.role: "validator" さえあれば true になる。
    expect(
      isValidatorService(obs({ labels: { [ROLE_LABEL]: "validator" } })),
    ).toBe(true);
  });

  it("does not normalize case (role label values are fixed strings from compose/node-lifecycle.ts)", () => {
    // ROLE_LABEL の値は collector が生成するものではなく compose /
    // node-lifecycle.ts が付与する固定値のみを想定するため、旧実装
    // （名前ベース）にあった大文字小文字を無視する挙動は引き継がない。
    expect(
      isValidatorService(obs({ labels: { [ROLE_LABEL]: "VALIDATOR" } })),
    ).toBe(false);
  });

  it("returns false for other known role label values (execution/consensus/workbench)", () => {
    for (const role of ["execution", "consensus", "workbench"]) {
      expect(isValidatorService(obs({ labels: { [ROLE_LABEL]: role } }))).toBe(
        false,
      );
    }
  });

  // 完全一致（=== "validator"）であることを、"validator" に似ているが
  // 一致しない値（大文字小文字の揺れ・前後空白・接尾辞・空文字など）で
  // 固定する。ROLE_LABEL は compose / node-lifecycle.ts が付与する固定値
  // のみを想定するため、これらは一切正規化されず false になる。
  it.each([
    "Validator", // 先頭のみ大文字
    "vAlIdAtOr", // 混在
    "validator ", // 末尾に空白
    " validator", // 先頭に空白
    " validator ", // 前後に空白
    "validator-2", // 接尾辞つき
    "validator1", // 数字が続く（compose サービス名に似た値）
    "validators", // 複数形
    "tx-validator", // 接頭辞つき（旧実装なら誤検出しえた形）
    "validator\n", // 末尾改行
    "", // 空文字
  ])("returns false for the near-miss role label value %j", (roleValue) => {
    expect(
      isValidatorService(obs({ labels: { [ROLE_LABEL]: roleValue } })),
    ).toBe(false);
  });

  it("ignores the compose service name entirely; only the role label matters (regression test for Issue #246)", () => {
    // 旧実装（Issue #214）は compose サービス名に "validator" を含むかの
    // 部分一致で判定していたため、将来の別チェーンプロファイルで
    // "validator" を含むが実際は P2P に参加するノードの service 名
    // （例: "tx-validator"）を誤って VC と判定しうる、という指摘が #246。
    // ラベルベースの現在の実装では、名前に "validator" を含んでいても
    // role ラベルが "validator" 以外なら false になることを固定する。
    const rethNamedLikeValidator = obs({
      stableId: "chainviz-ethereum/tx-validator1",
      labels: {
        "com.docker.compose.service": "tx-validator1",
        [ROLE_LABEL]: "execution",
      },
      image: "ghcr.io/paradigmxyz/reth:latest",
      processes: [{ command: "reth node", name: "reth" }],
    });
    expect(isValidatorService(rethNamedLikeValidator)).toBe(false);

    // 逆に、compose サービス名が "validator" を一切含まなくても role
    // ラベルが "validator" なら true になる（名前ではなくラベルが判定
    // 材料そのものであることの確認）。
    const namedDifferentlyButValidatorRole = obs({
      stableId: "chainviz-ethereum/vc-a",
      labels: {
        "com.docker.compose.service": "vc-a",
        [ROLE_LABEL]: "validator",
      },
      image: "sigp/lighthouse:latest",
      processes: [{ command: "lighthouse vc", name: "lighthouse" }],
    });
    expect(isValidatorService(namedDifferentlyButValidatorRole)).toBe(true);
  });
});

describe("executionMetricsTargets", () => {
  it("selects execution nodes and builds their metrics URL", () => {
    expect(executionMetricsTargets([obs()])).toEqual([
      {
        stableId: "chainviz-ethereum/reth1",
        metricsUrl: `http://172.28.1.1:${EXECUTION_METRICS_PORT}/metrics`,
      },
    ]);
  });

  it("excludes beacon, validator and workbench containers", () => {
    expect(executionMetricsTargets([beacon1, validator1, workbench])).toEqual(
      [],
    );
  });

  it("excludes execution nodes without an IP address", () => {
    expect(executionMetricsTargets([{ ...obs(), ip: "" }])).toEqual([]);
  });

  it("lists every reachable execution node", () => {
    const reth2 = obs({
      stableId: "chainviz-ethereum/reth2",
      labels: { "com.docker.compose.service": "reth2" },
      ip: "172.28.1.2",
    });
    expect(
      executionMetricsTargets([obs(), reth2]).map((t) => t.metricsUrl),
    ).toEqual([
      `http://172.28.1.1:${EXECUTION_METRICS_PORT}/metrics`,
      `http://172.28.1.2:${EXECUTION_METRICS_PORT}/metrics`,
    ]);
  });

  it("returns no targets for an empty observation set", () => {
    expect(executionMetricsTargets([])).toEqual([]);
  });
});
