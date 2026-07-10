import type { NodeEntity, PeerEdge } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { connectingEdgesToFlowEdges } from "./connectingEdge.js";

function node(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "reth-2",
    containerName: "chainviz-reth-2",
    ip: "172.20.0.3",
    ports: [8545],
    resources: { cpuPercent: 1, memMB: 100 },
    process: { name: "reth node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "syncing",
    blockHeight: 0,
    headBlockHash: "0x0",
    ...overrides,
  };
}

const bootExecution = node({ id: "reth-1", clientType: "reth", p2pRole: "bootnode" });
const bootConsensus = node({
  id: "lighthouse-1",
  clientType: "lighthouse",
  p2pRole: "bootnode",
});

describe("connectingEdgesToFlowEdges", () => {
  it("draws an edge from a peer-less node to its layer's bootnode", () => {
    const peer = node({ id: "reth-2", clientType: "reth" });
    const edges = connectingEdgesToFlowEdges(
      [peer],
      [],
      { execution: bootExecution },
      ["reth-2", "reth-1"],
    );
    expect(edges).toEqual([
      {
        id: "connecting-reth-2",
        type: "connecting",
        source: "reth-2",
        target: "reth-1",
        className: "connecting-edge",
      },
    ]);
  });

  it("does not draw an edge once the node has at least one real PeerEdge", () => {
    const peer = node({ id: "reth-2", clientType: "reth" });
    const realEdge: PeerEdge = {
      kind: "peer",
      fromNodeId: "reth-2",
      toNodeId: "reth-1",
      networkId: "1337",
    };
    const edges = connectingEdgesToFlowEdges(
      [peer],
      [realEdge],
      { execution: bootExecution },
      ["reth-2", "reth-1"],
    );
    expect(edges).toEqual([]);
  });

  it("recognizes an existing PeerEdge regardless of which side matches (from or to)", () => {
    const peer = node({ id: "reth-2", clientType: "reth" });
    const realEdge: PeerEdge = {
      kind: "peer",
      fromNodeId: "reth-1",
      toNodeId: "reth-2",
      networkId: "1337",
    };
    const edges = connectingEdgesToFlowEdges(
      [peer],
      [realEdge],
      { execution: bootExecution },
      ["reth-2", "reth-1"],
    );
    expect(edges).toEqual([]);
  });

  it("does not draw a self-loop for the bootnode itself", () => {
    const edges = connectingEdgesToFlowEdges(
      [bootExecution],
      [],
      { execution: bootExecution },
      ["reth-1"],
    );
    expect(edges).toEqual([]);
  });

  it("skips a node whose category has no resolved bootnode (Issue #123 §4-5 fallback)", () => {
    const peer = node({ id: "reth-2", clientType: "reth" });
    const edges = connectingEdgesToFlowEdges([peer], [], {}, ["reth-2"]);
    expect(edges).toEqual([]);
  });

  it("skips a node whose clientType category is unrecognized (neither execution nor consensus)", () => {
    const other = node({ id: "other-1", clientType: "unknown-client" });
    const edges = connectingEdgesToFlowEdges(
      [other],
      [],
      { execution: bootExecution },
      ["other-1", "reth-1"],
    );
    expect(edges).toEqual([]);
  });

  it("does not draw a dangling edge when the node itself is not currently present", () => {
    const peer = node({ id: "reth-2", clientType: "reth" });
    const edges = connectingEdgesToFlowEdges(
      [peer],
      [],
      { execution: bootExecution },
      ["reth-1"],
    );
    expect(edges).toEqual([]);
  });

  it("does not draw a dangling edge when the bootnode itself is not currently present", () => {
    const peer = node({ id: "reth-2", clientType: "reth" });
    const edges = connectingEdgesToFlowEdges(
      [peer],
      [],
      { execution: bootExecution },
      ["reth-2"],
    );
    expect(edges).toEqual([]);
  });

  it("handles both execution and consensus layers independently", () => {
    const peerEl = node({ id: "reth-2", clientType: "reth" });
    const peerCl = node({ id: "lighthouse-2", clientType: "lighthouse" });
    const edges = connectingEdgesToFlowEdges(
      [peerEl, peerCl],
      [],
      { execution: bootExecution, consensus: bootConsensus },
      ["reth-2", "reth-1", "lighthouse-2", "lighthouse-1"],
    );
    expect(edges.map((e) => e.target).sort()).toEqual(["lighthouse-1", "reth-1"]);
  });

  it("stops drawing once the node has any PeerEdge, even to a non-bootnode peer (discovery mesh)", () => {
    // reth-2 が（ブートノードではなく）別のフォロワー reth-3 とだけピア接続を
    // 確立した状態。接続確立中エッジは相手がブートノードかどうかに関係なく、
    // ピアが1本でも付けば消える（P2P はブートノードを入口にした後、ディスカバリで
    // 網目状に繋がるため。UX設計 §3 の「参加後は自動でメッシュ化」を反映）。
    const follower = node({ id: "reth-2", clientType: "reth" });
    const meshEdge: PeerEdge = {
      kind: "peer",
      fromNodeId: "reth-2",
      toNodeId: "reth-3",
      networkId: "1337",
    };
    const edges = connectingEdgesToFlowEdges(
      [follower],
      [meshEdge],
      { execution: bootExecution },
      ["reth-2", "reth-1", "reth-3"],
    );
    expect(edges).toEqual([]);
  });

  it("draws a separate edge for each peer-less node of the same layer to the shared bootnode", () => {
    // 同じ EL 層のフォロワーが2つとも未接続なら、共有ブートノードへ向けて
    // それぞれ独立したエッジを引く（1本に潰れたり取りこぼしたりしない）。
    const follower1 = node({ id: "reth-2", clientType: "reth" });
    const follower2 = node({ id: "reth-3", clientType: "reth" });
    const edges = connectingEdgesToFlowEdges(
      [follower1, follower2],
      [],
      { execution: bootExecution },
      ["reth-1", "reth-2", "reth-3"],
    );
    expect(edges.map((e) => e.source).sort()).toEqual(["reth-2", "reth-3"]);
    expect(edges.every((e) => e.target === "reth-1")).toBe(true);
  });

  it("excludes a node with p2pRole 'none' from the connecting edge target (Issue #214)", () => {
    // validator client 相当。consensus カテゴリだが P2P に参加しないため
    // PeerEdge を永久に持たず、除外しないと「接続確立中」が固着してしまう。
    const vc = node({
      id: "lighthouse-vc-1",
      clientType: "lighthouse",
      p2pRole: "none",
    });
    const edges = connectingEdgesToFlowEdges(
      [vc],
      [],
      { consensus: bootConsensus },
      ["lighthouse-vc-1", "lighthouse-1"],
    );
    expect(edges).toEqual([]);
  });

  it("keeps drawing a connecting edge when p2pRole is omitted (undefined, unchanged behavior)", () => {
    // p2pRole 省略時（旧 collector との互換含む）は従来どおり対象に含める。
    const peer = node({ id: "reth-2", clientType: "reth", p2pRole: undefined });
    const edges = connectingEdgesToFlowEdges(
      [peer],
      [],
      { execution: bootExecution },
      ["reth-2", "reth-1"],
    );
    expect(edges).toEqual([
      {
        id: "connecting-reth-2",
        type: "connecting",
        source: "reth-2",
        target: "reth-1",
        className: "connecting-edge",
      },
    ]);
  });

  it("returns an empty array for no nodes", () => {
    expect(connectingEdgesToFlowEdges([], [], {}, [])).toEqual([]);
  });

  it("accepts a plain array (not only a Set) for presentInfraIds", () => {
    const peer = node({ id: "reth-2", clientType: "reth" });
    const edges = connectingEdgesToFlowEdges(
      [peer],
      [],
      { execution: bootExecution },
      new Set(["reth-2", "reth-1"]),
    );
    expect(edges).toHaveLength(1);
  });
});
