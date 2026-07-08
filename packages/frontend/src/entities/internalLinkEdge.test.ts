import type { NodeEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  INTERNAL_LINK_EDGE_TYPE,
  INTERNAL_LINK_FRESHNESS_MS,
  INTERNAL_LINK_POLL_INTERVAL_MS,
  type InternalLinkFlowEdge,
  attachInternalLinkActivity,
  internalLinkEdgeId,
  internalLinkEdgesToFlowEdges,
  isInternalLinkFlowEdge,
} from "./internalLinkEdge.js";

function beacon(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "beacon-1",
    containerName: "chainviz-lighthouse-1",
    ip: "172.20.0.20",
    ports: [5052],
    resources: { cpuPercent: 1, memMB: 100 },
    process: { name: "lighthouse bn" },
    chainType: "ethereum",
    clientType: "lighthouse",
    syncStatus: "synced",
    blockHeight: 10,
    headBlockHash: "0x1",
    drivesNodeId: "reth-1",
    ...overrides,
  };
}

function reth(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "reth-1",
    containerName: "chainviz-reth-1",
    ip: "172.20.0.10",
    ports: [8545],
    resources: { cpuPercent: 2, memMB: 200 },
    process: { name: "reth node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 10,
    headBlockHash: "0x1",
    ...overrides,
  };
}

describe("internalLinkEdgeId", () => {
  it("builds a stable id from the driving/driven node id pair", () => {
    expect(internalLinkEdgeId("beacon-1", "reth-1")).toBe(
      "internal-link-beacon-1=>reth-1",
    );
  });
});

describe("internalLinkEdgesToFlowEdges", () => {
  it("builds one edge from a CL node to its driven EL node", () => {
    const nodes = [beacon(), reth()];
    const present = new Set(["beacon-1", "reth-1"]);
    const edges = internalLinkEdgesToFlowEdges(nodes, present);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: "internal-link-beacon-1=>reth-1",
      type: INTERNAL_LINK_EDGE_TYPE,
      source: "beacon-1",
      target: "reth-1",
      data: {
        drivingContainerName: "chainviz-lighthouse-1",
        drivenContainerName: "chainviz-reth-1",
      },
    });
  });

  it("ignores nodes without drivesNodeId", () => {
    const nodes = [reth(), reth({ id: "reth-2", containerName: "chainviz-reth-2" })];
    const edges = internalLinkEdgesToFlowEdges(nodes, new Set(["reth-1", "reth-2"]));
    expect(edges).toHaveLength(0);
  });

  it("does not draw a self-loop when drivesNodeId points at itself", () => {
    const nodes = [beacon({ drivesNodeId: "beacon-1" })];
    const edges = internalLinkEdgesToFlowEdges(nodes, new Set(["beacon-1"]));
    expect(edges).toHaveLength(0);
  });

  it("is a dangling guard: skips when the driving node itself is not present", () => {
    const nodes = [beacon(), reth()];
    // beacon-1 自身がキャンバス上に無い（present に含まれない）。
    const edges = internalLinkEdgesToFlowEdges(nodes, new Set(["reth-1"]));
    expect(edges).toHaveLength(0);
  });

  it("is a dangling guard: skips when the driven node is not present", () => {
    const nodes = [beacon(), reth()];
    const edges = internalLinkEdgesToFlowEdges(nodes, new Set(["beacon-1"]));
    expect(edges).toHaveLength(0);
  });

  it("is a dangling guard: skips when the driven node id cannot be resolved among the given nodes", () => {
    // reth-1 が present 集合には入っているが、nodes 配列自体には存在しない
    // （ワールドステートから既に消えた/未解決のケース）。
    const nodes = [beacon()];
    const edges = internalLinkEdgesToFlowEdges(nodes, new Set(["beacon-1", "reth-1"]));
    expect(edges).toHaveLength(0);
  });

  it("accepts presentNodeIds as a plain iterable, not only a Set", () => {
    const nodes = [beacon(), reth()];
    const edges = internalLinkEdgesToFlowEdges(nodes, ["beacon-1", "reth-1"]);
    expect(edges).toHaveLength(1);
  });

  it("builds independent edges for multiple CL/EL pairs", () => {
    const nodes = [
      beacon(),
      reth(),
      beacon({ id: "beacon-2", containerName: "chainviz-beacon-follower-1", drivesNodeId: "reth-2" }),
      reth({ id: "reth-2", containerName: "chainviz-reth-follower-1" }),
    ];
    const present = new Set(nodes.map((n) => n.id));
    const edges = internalLinkEdgesToFlowEdges(nodes, present);
    expect(edges.map((e) => e.id).sort()).toEqual([
      "internal-link-beacon-1=>reth-1",
      "internal-link-beacon-2=>reth-2",
    ]);
  });

  it("builds two distinct edges when two CL nodes drive the same EL node (fan-in; type-possible even if unusual)", () => {
    // NodeEntity.drivesNodeId 単体からは fan-out（1つの CL が複数 EL を駆動）は
    // 表現できないが、fan-in（複数 CL が同じ EL を指す）は型上あり得る。
    // エッジ id は駆動元ごとに分かれるため衝突せず、2本が独立して張られる。
    const nodes = [
      beacon(),
      beacon({ id: "beacon-2", containerName: "chainviz-lighthouse-2", drivesNodeId: "reth-1" }),
      reth(),
    ];
    const edges = internalLinkEdgesToFlowEdges(nodes, new Set(nodes.map((n) => n.id)));
    expect(edges.map((e) => e.id).sort()).toEqual([
      "internal-link-beacon-1=>reth-1",
      "internal-link-beacon-2=>reth-1",
    ]);
    // 両エッジとも同じ EL を target にするが id 衝突は起きない。
    expect(edges.every((e) => e.target === "reth-1")).toBe(true);
    expect(new Set(edges.map((e) => e.id)).size).toBe(2);
  });
});

describe("isInternalLinkFlowEdge", () => {
  it("narrows internal link edges apart from other edge types", () => {
    const edges = internalLinkEdgesToFlowEdges([beacon(), reth()], ["beacon-1", "reth-1"]);
    expect(isInternalLinkFlowEdge(edges[0])).toBe(true);
    expect(isInternalLinkFlowEdge({ id: "x", source: "a", target: "b", type: "peer" })).toBe(
      false,
    );
  });
});

describe("attachInternalLinkActivity", () => {
  function baseEdge(): InternalLinkFlowEdge {
    return internalLinkEdgesToFlowEdges([beacon(), reth()], ["beacon-1", "reth-1"])[0];
  }

  it("attaches pulses and last activity for a matching edge id", () => {
    const edges = [baseEdge()];
    const pulses = new Map([[edges[0].id, [{ key: "p1", durationMs: 900 }]]]);
    const lastActivity = new Map([
      [edges[0].id, { calls: [{ method: "engine_newPayloadV4", count: 2 }], observedAt: 100 }],
    ]);
    const result = attachInternalLinkActivity(edges, pulses, lastActivity);
    expect(result[0].data?.pulses).toEqual([{ key: "p1", durationMs: 900 }]);
    expect(result[0].data?.lastActivity).toEqual({
      calls: [{ method: "engine_newPayloadV4", count: 2 }],
      observedAt: 100,
    });
  });

  it("keeps the same object reference when nothing changed (perf: avoid needless re-renders)", () => {
    const edges = [baseEdge()];
    const result = attachInternalLinkActivity(edges, new Map(), new Map());
    expect(result[0]).toBe(edges[0]);
  });

  it("clears stale pulses for an edge that no longer has active pulses (matches blockPulse.ts's attachPulsesToEdges convention: undefined, not [])", () => {
    const edges = [{ ...baseEdge(), data: { ...baseEdge().data!, pulses: [{ key: "old", durationMs: 900 }] } }];
    const result = attachInternalLinkActivity(edges, new Map(), new Map());
    expect(result[0].data?.pulses).toBeUndefined();
  });

  it("leaves an edge with no matching id untouched (no stale pulses to begin with)", () => {
    const edges = [baseEdge(), { ...baseEdge(), id: "internal-link-other=>x" }];
    const pulses = new Map([[edges[0].id, [{ key: "p1", durationMs: 900 }]]]);
    const result = attachInternalLinkActivity(edges, pulses, new Map());
    expect(result[0].data?.pulses).toHaveLength(1);
    expect(result[1].data?.pulses).toBeUndefined();
    expect(result[1]).toBe(edges[1]); // 変化が無いので参照も保たれる
  });

  it("routes pulses and last activity only to the matching edge across multiple real edges (no cross-contamination)", () => {
    // 2ペアの実エッジを土台に、片方にだけパルス・もう片方にだけ直近観測を
    // 与えても取り違えが起きないことを確認する（複数エッジ同時存在時の混線防止）。
    const nodes = [
      beacon(),
      reth(),
      beacon({ id: "beacon-2", containerName: "chainviz-lighthouse-2", drivesNodeId: "reth-2" }),
      reth({ id: "reth-2", containerName: "chainviz-reth-2" }),
    ];
    const edges = internalLinkEdgesToFlowEdges(nodes, new Set(nodes.map((n) => n.id)));
    const edgeA = edges.find((e) => e.source === "beacon-1")!;
    const edgeB = edges.find((e) => e.source === "beacon-2")!;
    const pulses = new Map([[edgeA.id, [{ key: "pa", durationMs: 900 }]]]);
    const lastActivity = new Map([
      [edgeB.id, { calls: [{ method: "engine_getPayloadV4", count: 1 }], observedAt: 500 }],
    ]);
    const result = attachInternalLinkActivity(edges, pulses, lastActivity);
    const outA = result.find((e) => e.id === edgeA.id)!;
    const outB = result.find((e) => e.id === edgeB.id)!;
    expect(outA.data?.pulses).toHaveLength(1);
    expect(outA.data?.lastActivity).toBeUndefined();
    expect(outB.data?.pulses).toBeUndefined();
    expect(outB.data?.lastActivity?.observedAt).toBe(500);
  });
});

describe("freshness constants", () => {
  it("derives the freshness window from the poll interval (3 scrapes + margin, ARCHITECTURE.md §7.6.3)", () => {
    expect(INTERNAL_LINK_POLL_INTERVAL_MS).toBe(3000);
    expect(INTERNAL_LINK_FRESHNESS_MS).toBe(INTERNAL_LINK_POLL_INTERVAL_MS * 3 + 1000);
    expect(INTERNAL_LINK_FRESHNESS_MS).toBe(10000);
  });
});
