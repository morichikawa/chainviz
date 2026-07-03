import { describe, expect, it } from "vitest";
import { toPeerEdges, type BeaconNodePeers } from "./peers.js";

function beaconNode(overrides: Partial<BeaconNodePeers> = {}): BeaconNodePeers {
  return {
    stableId: "p/beacon1",
    peerId: "peer-1",
    networkId: "p-consensus",
    connectedPeerIds: [],
    ...overrides,
  };
}

describe("toPeerEdges", () => {
  it("returns no edges when there are no connections", () => {
    expect(toPeerEdges([beaconNode()])).toEqual([]);
  });

  it("creates one undirected edge between two mutually connected nodes", () => {
    const b1 = beaconNode({
      stableId: "p/beacon1",
      peerId: "peer-1",
      connectedPeerIds: ["peer-2"],
    });
    const b2 = beaconNode({
      stableId: "p/beacon2",
      peerId: "peer-2",
      connectedPeerIds: ["peer-1"],
    });
    const edges = toPeerEdges([b1, b2]);
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "p/beacon1",
        toNodeId: "p/beacon2",
        networkId: "p-consensus",
      },
    ]);
  });

  it("canonicalizes edge direction regardless of who reports the peer", () => {
    // beacon2 だけが beacon1 を接続相手として報告するケースでも、
    // from/to は安定 ID の昇順に正規化される。
    const b1 = beaconNode({
      stableId: "p/beacon1",
      peerId: "peer-1",
      connectedPeerIds: [],
    });
    const b2 = beaconNode({
      stableId: "p/beacon2",
      peerId: "peer-2",
      connectedPeerIds: ["peer-1"],
    });
    const edges = toPeerEdges([b1, b2]);
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "p/beacon1",
        toNodeId: "p/beacon2",
        networkId: "p-consensus",
      },
    ]);
  });

  it("drops connections to peers that are not observed nodes", () => {
    // 観測対象外（peer_id が解決できない）のピアはエッジにしない。
    const b1 = beaconNode({
      stableId: "p/beacon1",
      peerId: "peer-1",
      connectedPeerIds: ["unknown-external-peer"],
    });
    expect(toPeerEdges([b1])).toEqual([]);
  });

  it("ignores self-connections", () => {
    const b1 = beaconNode({
      stableId: "p/beacon1",
      peerId: "peer-1",
      connectedPeerIds: ["peer-1"],
    });
    expect(toPeerEdges([b1])).toEqual([]);
  });

  it("does not emit duplicate edges when both sides report the connection", () => {
    const b1 = beaconNode({
      stableId: "p/beacon1",
      peerId: "peer-1",
      connectedPeerIds: ["peer-2", "peer-2"],
    });
    const b2 = beaconNode({
      stableId: "p/beacon2",
      peerId: "peer-2",
      connectedPeerIds: ["peer-1"],
    });
    expect(toPeerEdges([b1, b2])).toHaveLength(1);
  });

  it("builds edges across a three-node mesh without duplicates", () => {
    const b1 = beaconNode({
      stableId: "p/beacon1",
      peerId: "peer-1",
      connectedPeerIds: ["peer-2", "peer-3"],
    });
    const b2 = beaconNode({
      stableId: "p/beacon2",
      peerId: "peer-2",
      connectedPeerIds: ["peer-1", "peer-3"],
    });
    const b3 = beaconNode({
      stableId: "p/beacon3",
      peerId: "peer-3",
      connectedPeerIds: ["peer-1", "peer-2"],
    });
    const edges = toPeerEdges([b1, b2, b3]);
    const pairs = edges.map((e) => `${e.fromNodeId}-${e.toNodeId}`).sort();
    expect(pairs).toEqual([
      "p/beacon1-p/beacon2",
      "p/beacon1-p/beacon3",
      "p/beacon2-p/beacon3",
    ]);
  });

  it("returns no edges for an empty node list", () => {
    expect(toPeerEdges([])).toEqual([]);
  });

  it("takes the networkId from the node that reports the connection", () => {
    // 報告元ノードの networkId がエッジに載る。
    const b1 = beaconNode({
      stableId: "p/beacon1",
      peerId: "peer-1",
      networkId: "net-1",
      connectedPeerIds: ["peer-2"],
    });
    const b2 = beaconNode({
      stableId: "p/beacon2",
      peerId: "peer-2",
      networkId: "net-2",
      connectedPeerIds: [],
    });
    const edges = toPeerEdges([b1, b2]);
    expect(edges).toHaveLength(1);
    expect(edges[0].networkId).toBe("net-1");
  });

  it("ignores a self reference mixed in with real peers", () => {
    // 自分自身の peer_id が接続一覧に混ざっていても自己ループは除外し、
    // 実際の相手とのエッジだけを残す。
    const b1 = beaconNode({
      stableId: "p/beacon1",
      peerId: "peer-1",
      connectedPeerIds: ["peer-1", "peer-2"],
    });
    const b2 = beaconNode({
      stableId: "p/beacon2",
      peerId: "peer-2",
      connectedPeerIds: [],
    });
    const edges = toPeerEdges([b1, b2]);
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "p/beacon1",
        toNodeId: "p/beacon2",
        networkId: "p-consensus",
      },
    ]);
  });

  it("resolves a duplicated peer_id to the last node that claims it", () => {
    // 同じ peer_id を複数ノードが名乗った場合、対応表は後勝ちになる。
    // 想定外の入力でも破綻せず 1 本のエッジへ畳めることを確認する。
    const b1 = beaconNode({
      stableId: "p/beacon1",
      peerId: "dup",
      connectedPeerIds: [],
    });
    const b2 = beaconNode({
      stableId: "p/beacon2",
      peerId: "dup",
      connectedPeerIds: [],
    });
    const b3 = beaconNode({
      stableId: "p/beacon3",
      peerId: "peer-3",
      connectedPeerIds: ["dup"],
    });
    const edges = toPeerEdges([b1, b2, b3]);
    // "dup" は後勝ちで b2 に解決されるので b3 が報告する接続は b2<->b3 になる。
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "p/beacon2",
        toNodeId: "p/beacon3",
        networkId: "p-consensus",
      },
    ]);
  });

  it("skips nodes without a resolvable peer id when mapping", () => {
    // peerId が空のノードは相手として解決されない。
    const b1 = beaconNode({
      stableId: "p/beacon1",
      peerId: "",
      connectedPeerIds: ["peer-2"],
    });
    const b2 = beaconNode({
      stableId: "p/beacon2",
      peerId: "peer-2",
      connectedPeerIds: [""],
    });
    // b1 -> peer-2 は解決できるが、b1 自身は peerId 空で相手から解決されない。
    const edges = toPeerEdges([b1, b2]);
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "p/beacon1",
        toNodeId: "p/beacon2",
        networkId: "p-consensus",
      },
    ]);
  });
});
