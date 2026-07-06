import type { PeerEdge } from "@chainviz/shared";
import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  NETWORK_COLORS,
  describeNetwork,
  groupEdgesByNetwork,
  isPeerFlowEdge,
  networkClassToken,
  networkIdColor,
  peerEdgesToFlowEdges,
  stableIdServiceName,
} from "./peerEdge.js";

function peer(
  fromNodeId: string,
  toNodeId: string,
  networkId = "1337",
): PeerEdge {
  return { kind: "peer", fromNodeId, toNodeId, networkId };
}

describe("networkIdColor", () => {
  it("returns a color from the palette", () => {
    expect(NETWORK_COLORS).toContain(networkIdColor("1337"));
  });

  it("is deterministic for the same networkId", () => {
    expect(networkIdColor("1337")).toBe(networkIdColor("1337"));
  });

  it("tends to differ for different networkIds", () => {
    expect(networkIdColor("1337")).not.toBe(networkIdColor("2337"));
  });

  it("returns a palette color for the empty string", () => {
    // hash は 0 のままなので index 0 に落ちる。例外や undefined を返さない。
    expect(NETWORK_COLORS).toContain(networkIdColor(""));
  });

  it("returns a palette color for networkIds with special characters", () => {
    for (const id of ["eth:mainnet", "こんにちは", "网络-1", "a b\tc\n"]) {
      expect(NETWORK_COLORS).toContain(networkIdColor(id));
    }
  });

  it("always stays within the palette range for many distinct networkIds", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(NETWORK_COLORS).toContain(networkIdColor(`net-${i}`));
    }
  });
});

describe("NETWORK_COLORS palette separation (Issue #95)", () => {
  // C層の所有エッジ色（styles.css の --own-edge）。P2P パレットとは別の
  // 意味を持つエッジなので、この値と混同されやすい色をパレットに含めない。
  // CSS 変数を直接 import できないため、regression 用にリテラルで固定する。
  const OWN_EDGE_HEX = "#e0a94f";

  function hexToRgb(hex: string): [number, number, number] {
    const n = Number.parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // 簡易的な知覚色差（正確な CIEDE2000 ではなく sRGB のユークリッド距離）。
  // 用途は「パレット色と所有エッジ色が明らかに違う」ことの下限保証であり、
  // 厳密な色差モデルまでは要らないため簡便な指標で十分。
  function roughColorDistance(a: string, b: string): number {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  }

  it("no longer includes the amber tone that used to collide with --own-edge", () => {
    // 旧パレットの #f5b544 は所有エッジの #e0a94f とほぼ同一色相で、
    // 検証環境(networkId "1337")で実際に判別困難になっていた。
    expect(NETWORK_COLORS).not.toContain("#f5b544");
  });

  it("keeps every palette color clearly distinct from the ownership edge color", () => {
    for (const color of NETWORK_COLORS) {
      // しきい値40は「琥珀 #e0a94f と旧 #f5b544 の距離(約27)」より明確に大きく、
      // かつ現パレットの各色の距離(最小でも約49)は余裕を持って上回る。
      expect(roughColorDistance(color, OWN_EDGE_HEX)).toBeGreaterThan(40);
    }
  });

  it("has no duplicate colors in the palette", () => {
    expect(new Set(NETWORK_COLORS).size).toBe(NETWORK_COLORS.length);
  });
});

describe("networkClassToken", () => {
  it("keeps safe characters and replaces the rest", () => {
    expect(networkClassToken("1337")).toBe("1337");
    expect(networkClassToken("eth:mainnet 1")).toBe("eth_mainnet_1");
  });

  it("returns an empty string for the empty string", () => {
    expect(networkClassToken("")).toBe("");
  });

  it("replaces every unsafe character, including leading and trailing", () => {
    expect(networkClassToken(":a:b:")).toBe("_a_b_");
    expect(networkClassToken("网络")).toBe("__");
  });

  it("preserves already-safe hyphenated and underscored tokens", () => {
    expect(networkClassToken("eth-mainnet_1")).toBe("eth-mainnet_1");
  });
});

describe("peerEdgesToFlowEdges", () => {
  const present = new Set(["reth-node-1", "reth-node-2", "reth-node-3"]);

  it("maps a peer edge onto the matching node ids", () => {
    const edges = peerEdgesToFlowEdges(
      [peer("reth-node-1", "reth-node-2")],
      present,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("reth-node-1");
    expect(edges[0].target).toBe("reth-node-2");
    expect(edges[0].data?.networkId).toBe("1337");
  });

  it("accepts an iterable (array) of present node ids", () => {
    const edges = peerEdgesToFlowEdges(
      [peer("reth-node-1", "reth-node-2")],
      ["reth-node-1", "reth-node-2"],
    );
    expect(edges).toHaveLength(1);
  });

  it("drops edges whose endpoints are not both present", () => {
    const edges = peerEdgesToFlowEdges(
      [peer("reth-node-1", "ghost")],
      present,
    );
    expect(edges).toEqual([]);
  });

  it("drops self-loops", () => {
    const edges = peerEdgesToFlowEdges(
      [peer("reth-node-1", "reth-node-1")],
      present,
    );
    expect(edges).toEqual([]);
  });

  it("treats a reverse-direction peer as the same undirected cord", () => {
    const edges = peerEdgesToFlowEdges(
      [peer("reth-node-1", "reth-node-2"), peer("reth-node-2", "reth-node-1")],
      present,
    );
    expect(edges).toHaveLength(1);
  });

  it("normalizes endpoint order so ids are stable regardless of direction", () => {
    const forward = peerEdgesToFlowEdges(
      [peer("reth-node-2", "reth-node-1")],
      present,
    );
    const reverse = peerEdgesToFlowEdges(
      [peer("reth-node-1", "reth-node-2")],
      present,
    );
    expect(forward[0].id).toBe(reverse[0].id);
    expect(forward[0].source).toBe("reth-node-1");
    expect(forward[0].target).toBe("reth-node-2");
  });

  it("keeps same-pair edges on different networks as distinct cords", () => {
    const edges = peerEdgesToFlowEdges(
      [
        peer("reth-node-1", "reth-node-2", "1337"),
        peer("reth-node-1", "reth-node-2", "2337"),
      ],
      present,
    );
    expect(edges).toHaveLength(2);
  });

  it("colors edges by networkId", () => {
    const edges = peerEdgesToFlowEdges(
      [peer("reth-node-1", "reth-node-2", "1337")],
      present,
    );
    expect(edges[0].style?.stroke).toBe(networkIdColor("1337"));
    expect(edges[0].className).toContain("peer-edge--net-1337");
  });

  it("returns an empty array for no edges", () => {
    expect(peerEdgesToFlowEdges([], present)).toEqual([]);
  });

  it("returns an empty array when no node ids are present", () => {
    expect(
      peerEdgesToFlowEdges([peer("reth-node-1", "reth-node-2")], []),
    ).toEqual([]);
  });

  it("drops an edge whose source endpoint is missing", () => {
    // 既存テストは to 側の欠落のみ。from 側の欠落も落とすことを確認する。
    expect(
      peerEdgesToFlowEdges([peer("ghost", "reth-node-2")], present),
    ).toEqual([]);
  });

  it("drops an edge when both endpoints are missing", () => {
    expect(peerEdgesToFlowEdges([peer("ghost-a", "ghost-b")], present)).toEqual(
      [],
    );
  });

  it("dedupes exact duplicate edges (same from/to/networkId)", () => {
    const edges = peerEdgesToFlowEdges(
      [peer("reth-node-1", "reth-node-2"), peer("reth-node-1", "reth-node-2")],
      present,
    );
    expect(edges).toHaveLength(1);
  });

  it("keeps valid edges while dropping self-loops and dangling ones in one batch", () => {
    const edges = peerEdgesToFlowEdges(
      [
        peer("reth-node-1", "reth-node-1"), // 自己ループ
        peer("reth-node-2", "ghost"), // 端点欠落
        peer("reth-node-2", "reth-node-3"), // 有効
      ],
      present,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("reth-node-2");
    expect(edges[0].target).toBe("reth-node-3");
  });

  it("treats the reverse direction on a different network as a distinct cord", () => {
    // 無向の重複排除は networkId 単位。向きが逆でも networkId が違えば別の紐。
    const edges = peerEdgesToFlowEdges(
      [
        peer("reth-node-1", "reth-node-2", "1337"),
        peer("reth-node-2", "reth-node-1", "2337"),
      ],
      present,
    );
    expect(edges).toHaveLength(2);
    expect(new Set(edges.map((e) => e.data?.networkId))).toEqual(
      new Set(["1337", "2337"]),
    );
  });

  it("preserves the original networkId in data even after order normalization", () => {
    const edges = peerEdgesToFlowEdges(
      [peer("reth-node-3", "reth-node-1", "2337")],
      present,
    );
    // 端点は [小, 大] に並べ替えられるが、networkId は元の値のまま。
    expect(edges[0].source).toBe("reth-node-1");
    expect(edges[0].target).toBe("reth-node-3");
    expect(edges[0].data?.networkId).toBe("2337");
  });

  it("sanitizes special-character networkIds in the className only", () => {
    const present2 = new Set(["a", "b"]);
    const edges = peerEdgesToFlowEdges([peer("a", "b", "eth:main 1")], present2);
    expect(edges[0].className).toContain("peer-edge--net-eth_main_1");
    // id キーには生の networkId を使う（クラス名トークンではない）。
    expect(edges[0].id).toContain("eth:main 1");
  });

  it("does not merge networkIds that collapse to the same class token", () => {
    // "a:b" と "a b" はクラス名では同じ "a_b" になるが、別ネットワーク扱い。
    const present2 = new Set(["x", "y"]);
    const edges = peerEdgesToFlowEdges(
      [peer("x", "y", "a:b"), peer("x", "y", "a b")],
      present2,
    );
    expect(edges).toHaveLength(2);
    expect(new Set(edges.map((e) => e.id)).size).toBe(2);
  });
});

describe("describeNetwork (Issue #124)", () => {
  it("recognizes the Ethereum execution suffix", () => {
    expect(describeNetwork("chainviz-ethereum-execution")).toEqual({
      kind: "known",
      labelKey: "network.execution",
      termKey: "execution-p2p",
    });
  });

  it("recognizes the Ethereum consensus suffix", () => {
    expect(describeNetwork("chainviz-ethereum-consensus")).toEqual({
      kind: "known",
      labelKey: "network.consensus",
      termKey: "consensus-p2p",
    });
  });

  it("falls back to raw for the empty string", () => {
    expect(describeNetwork("")).toEqual({ kind: "raw" });
  });

  it("falls back to raw for an unrelated networkId", () => {
    expect(describeNetwork("1337")).toEqual({ kind: "raw" });
    expect(describeNetwork("some-other-chain-network")).toEqual({ kind: "raw" });
  });

  it("still matches when the prefix before the suffix is empty", () => {
    // networkId が接尾辞そのものだけ（接頭辞が空）でも suffix 判定は成立する。
    // 実運用では起きないが、endsWith の素直な挙動を固定しておく。
    expect(describeNetwork("-execution").kind).toBe("known");
    expect(describeNetwork("-consensus").kind).toBe("known");
  });

  it("is case-sensitive: uppercased suffixes do not match", () => {
    // targets.ts は小文字の接尾辞しか付けないため、大文字は既知扱いしない
    // （生の networkId 表示にフォールバックする）。
    expect(describeNetwork("x-Execution")).toEqual({ kind: "raw" });
    expect(describeNetwork("x-EXECUTION")).toEqual({ kind: "raw" });
    expect(describeNetwork("X-CONSENSUS")).toEqual({ kind: "raw" });
  });

  it("requires the hyphen: a bare word without the hyphen is raw", () => {
    // "execution"（先頭ハイフン無し）は "-execution" で終わらないので raw。
    expect(describeNetwork("execution")).toEqual({ kind: "raw" });
    expect(describeNetwork("consensus")).toEqual({ kind: "raw" });
  });

  it("requires the suffix to be at the end, not merely contained", () => {
    // 中間に含むだけ（末尾がハイフン以外で続く）なら未知扱い。
    expect(describeNetwork("x-execution-foo")).toEqual({ kind: "raw" });
    expect(describeNetwork("x-execution ")).toEqual({ kind: "raw" });
  });

  it("lets the trailing suffix win when both words appear", () => {
    // 末尾の接尾辞だけで決まる。"consensus-execution" は execution 側、
    // "execution-consensus" は consensus 側になる（中間語には引きずられない）。
    expect(describeNetwork("consensus-execution")).toEqual({
      kind: "known",
      labelKey: "network.execution",
      termKey: "execution-p2p",
    });
    expect(describeNetwork("execution-consensus")).toEqual({
      kind: "known",
      labelKey: "network.consensus",
      termKey: "consensus-p2p",
    });
  });
});

describe("stableIdServiceName (Issue #124)", () => {
  it("returns the segment after the last slash", () => {
    expect(stableIdServiceName("chainviz-ethereum/reth1")).toBe("reth1");
  });

  it("returns the whole id when there is no slash", () => {
    expect(stableIdServiceName("reth1")).toBe("reth1");
  });

  it("returns an empty string for the empty string", () => {
    expect(stableIdServiceName("")).toBe("");
  });

  it("uses the last slash when several are present", () => {
    expect(stableIdServiceName("proj/group/reth1")).toBe("reth1");
  });

  it("returns an empty string when the id ends with a slash", () => {
    expect(stableIdServiceName("proj/")).toBe("");
    expect(stableIdServiceName("a/b/c/")).toBe("");
  });

  it("handles a leading slash (empty project part)", () => {
    expect(stableIdServiceName("/reth1")).toBe("reth1");
  });
});

describe("isPeerFlowEdge (Issue #124)", () => {
  const base = { id: "e", source: "a", target: "b" };

  it("returns true for a peer-typed edge", () => {
    expect(isPeerFlowEdge({ ...base, type: "peer" })).toBe(true);
  });

  it("returns false for ownership and operation edges", () => {
    // 所有エッジ・操作エッジはホバー説明の対象外・凡例の集計対象外。
    expect(isPeerFlowEdge({ ...base, type: "ownership" })).toBe(false);
    expect(isPeerFlowEdge({ ...base, type: "operation" })).toBe(false);
  });

  it("returns false for an edge with no type", () => {
    expect(isPeerFlowEdge({ ...base } as Edge)).toBe(false);
  });

  it("filters a mixed edge list down to peer edges only", () => {
    // Canvas.tsx が凡例へ渡す peerEdges 抽出・ホバー注入の前提を固定する。
    const edges: Edge[] = [
      { ...base, id: "p1", type: "peer" },
      { ...base, id: "o1", type: "ownership" },
      { ...base, id: "op1", type: "operation" },
      { ...base, id: "p2", type: "peer" },
    ];
    expect(edges.filter(isPeerFlowEdge).map((e) => e.id)).toEqual(["p1", "p2"]);
  });
});

describe("groupEdgesByNetwork", () => {
  const present = new Set(["a", "b", "c", "d"]);

  it("buckets flow edges by their networkId", () => {
    const flow = peerEdgesToFlowEdges(
      [peer("a", "b", "1337"), peer("c", "d", "2337")],
      present,
    );
    const groups = groupEdgesByNetwork(flow);
    expect([...groups.keys()].sort()).toEqual(["1337", "2337"]);
    expect(groups.get("1337")).toHaveLength(1);
    expect(groups.get("2337")).toHaveLength(1);
  });

  it("returns an empty map for no edges", () => {
    expect(groupEdgesByNetwork([]).size).toBe(0);
  });

  it("groups multiple edges of the same network into one bucket", () => {
    const flow = peerEdgesToFlowEdges(
      [peer("a", "b", "1337"), peer("c", "d", "1337"), peer("a", "c", "2337")],
      present,
    );
    const groups = groupEdgesByNetwork(flow);
    expect(groups.get("1337")).toHaveLength(2);
    expect(groups.get("2337")).toHaveLength(1);
  });

  it("buckets flow edges lacking data under the empty-string network", () => {
    // data が無いエッジ（防御的経路）は "" のバケットへ落ちる。
    const groups = groupEdgesByNetwork([
      { id: "e1", source: "a", target: "b" },
    ]);
    expect(groups.get("")).toHaveLength(1);
  });
});
