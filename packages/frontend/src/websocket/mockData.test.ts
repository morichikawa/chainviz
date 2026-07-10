import type { DiffEvent, NodeEntity } from "@chainviz/shared";
import { describe, expect, it, vi } from "vitest";
import {
  groupEdgesByNetwork,
  peerEdgesToFlowEdges,
} from "../entities/peerEdge.js";
import {
  ADD_NODE_PEER_CONNECT_DELAY_MS,
  MOCK_NETWORK_ID,
  createMockClient,
  createMockSnapshot,
  createMultiNetworkMockSnapshot,
} from "./mockData.js";

describe("createMockSnapshot", () => {
  it("contains reth nodes and a workbench with stable ids", () => {
    const snapshot = createMockSnapshot();
    const ids = snapshot.entities.map((e) =>
      e.kind === "node" || e.kind === "workbench" ? e.id : e.kind,
    );
    expect(ids).toContain("reth-node-1");
    expect(ids).toContain("workbench-alice");
    const kinds = snapshot.entities.map((e) => e.kind);
    expect(kinds).toContain("node");
    expect(kinds).toContain("workbench");
  });

  it("includes a single-network peer edge between the reth nodes", () => {
    const snapshot = createMockSnapshot();
    expect(snapshot.edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "reth-node-1",
        toNodeId: "reth-node-2",
        networkId: MOCK_NETWORK_ID,
      },
    ]);
    // 端点は必ずスナップショット内のノードとして存在する。
    const nodeIds = new Set(
      snapshot.entities
        .filter((e) => e.kind === "node")
        .map((e) => (e as { id: string }).id),
    );
    for (const edge of snapshot.edges) {
      expect(nodeIds.has(edge.fromNodeId)).toBe(true);
      expect(nodeIds.has(edge.toNodeId)).toBe(true);
    }
  });
});

describe("createMockSnapshot connection targets (Issue #123)", () => {
  it("marks reth-node-1 and lighthouse-1 as the EL/CL bootnodes", () => {
    const snapshot = createMockSnapshot();
    const byId = new Map(
      snapshot.entities
        .filter((e): e is NodeEntity => e.kind === "node")
        .map((e) => [e.id, e]),
    );
    expect(byId.get("reth-node-1")?.p2pRole).toBe("bootnode");
    expect(byId.get("lighthouse-1")?.p2pRole).toBe("bootnode");
    expect(byId.get("reth-node-2")?.p2pRole).toBe("peer");
  });

  it("resolves workbench-alice's rpcTargetNodeId to the EL bootnode", () => {
    const snapshot = createMockSnapshot();
    const wb = snapshot.entities.find((e) => e.kind === "workbench");
    expect(wb?.kind === "workbench" && wb.rpcTargetNodeId).toBe("reth-node-1");
  });
});

describe("createMockSnapshot P2P非参加ノード (Issue #214)", () => {
  it("includes validator-1/validator-2 as p2pRole 'none' (VC相当。P2Pに参加しない)", () => {
    const snapshot = createMockSnapshot();
    const byId = new Map(
      snapshot.entities
        .filter((e): e is NodeEntity => e.kind === "node")
        .map((e) => [e.id, e]),
    );
    expect(byId.get("validator-1")?.p2pRole).toBe("none");
    expect(byId.get("validator-2")?.p2pRole).toBe("none");
  });

  it("does not include validator-1/validator-2 as an endpoint of any PeerEdge", () => {
    const snapshot = createMockSnapshot();
    const peerEndpoints = new Set(
      snapshot.edges.flatMap((e) => [e.fromNodeId, e.toNodeId]),
    );
    expect(peerEndpoints.has("validator-1")).toBe(false);
    expect(peerEndpoints.has("validator-2")).toBe(false);
  });
});

describe("createMockSnapshot D-layer content (internal link, Issue #188)", () => {
  it("gives lighthouse-1 a drivesNodeId pointing at reth-node-1", () => {
    const snapshot = createMockSnapshot();
    const byId = new Map(
      snapshot.entities
        .filter((e): e is NodeEntity => e.kind === "node")
        .map((e) => [e.id, e]),
    );
    expect(byId.get("lighthouse-1")?.drivesNodeId).toBe("reth-node-1");
  });

  it("does not set drivesNodeId on EL (reth) nodes", () => {
    const snapshot = createMockSnapshot();
    const byId = new Map(
      snapshot.entities
        .filter((e): e is NodeEntity => e.kind === "node")
        .map((e) => [e.id, e]),
    );
    expect(byId.get("reth-node-1")?.drivesNodeId).toBeUndefined();
    expect(byId.get("reth-node-2")?.drivesNodeId).toBeUndefined();
  });
});

describe("createMockSnapshot C-layer content", () => {
  it("includes wallets (EOA, smart account) and transactions", () => {
    const snapshot = createMockSnapshot();
    const wallets = snapshot.entities.filter((e) => e.kind === "wallet");
    const txs = snapshot.entities.filter((e) => e.kind === "transaction");
    expect(wallets.length).toBeGreaterThanOrEqual(2);
    expect(txs.length).toBeGreaterThanOrEqual(1);
    expect(wallets.some((w) => w.kind === "wallet" && w.isSmartAccount)).toBe(
      true,
    );
  });

  it("includes an orphaned wallet whose owner was deleted (ownerWorkbenchId null)", () => {
    const snapshot = createMockSnapshot();
    const orphaned = snapshot.entities.filter(
      (e) => e.kind === "wallet" && e.ownerWorkbenchId === null,
    );
    expect(orphaned.length).toBeGreaterThanOrEqual(1);
  });

  it("has a pending transaction to demonstrate the mempool state", () => {
    const snapshot = createMockSnapshot();
    const pending = snapshot.entities.filter(
      (e) => e.kind === "transaction" && e.status === "pending",
    );
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  it("references its wallets from the workbench walletIds", () => {
    const snapshot = createMockSnapshot();
    const workbench = snapshot.entities.find(
      (e) => e.kind === "workbench",
    );
    const walletAddresses = new Set(
      snapshot.entities
        .filter((e) => e.kind === "wallet")
        .map((e) => (e as { address: string }).address),
    );
    if (workbench?.kind !== "workbench") throw new Error("no workbench");
    expect(workbench.walletIds.length).toBeGreaterThanOrEqual(1);
    for (const id of workbench.walletIds) {
      expect(walletAddresses.has(id)).toBe(true);
    }
  });
});

describe("createMockClient tx lifecycle", () => {
  it("settles the pending tx and injects a new pending tx on each tick", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();
    vi.advanceTimersByTime(1000);

    expect(onDiff).toHaveBeenCalledTimes(1);
    const diffs = onDiff.mock.calls[0][0];
    // 前回 pending だった tx が included へ確定する差分がある。
    const settled = diffs.find(
      (d: { type: string; patch?: { status?: string } }) =>
        d.type === "entityUpdated" && d.patch?.status === "included",
    );
    expect(settled).toBeTruthy();
    // 新しい pending tx が mempool へ投入される差分がある。
    const added = diffs.find(
      (d: { type: string; entity?: { kind?: string; status?: string } }) =>
        d.type === "entityAdded" &&
        d.entity?.kind === "transaction" &&
        d.entity?.status === "pending",
    );
    expect(added).toBeTruthy();
    client.disconnect();
    vi.useRealTimers();
  });

  it("advances the owner wallet's nonce when a tx settles", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();
    vi.advanceTimersByTime(1000);
    const diffs = onDiff.mock.calls[0][0];
    const nonceUpdate = diffs.find(
      (d: { type: string; patch?: { nonce?: number } }) =>
        d.type === "entityUpdated" && typeof d.patch?.nonce === "number",
    );
    expect(nonceUpdate).toBeTruthy();
    client.disconnect();
    vi.useRealTimers();
  });

  it("observes a workbench -> reth-node-1 operation on each tick", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();
    vi.advanceTimersByTime(1000);
    const diffs = onDiff.mock.calls[0][0];
    const observed = diffs.find(
      (d: { type: string }) => d.type === "operationObserved",
    );
    expect(observed).toMatchObject({
      type: "operationObserved",
      edge: {
        kind: "operation",
        fromWorkbenchId: "workbench-alice",
        toNodeId: "reth-node-1",
        operation: "eth_sendRawTransaction",
      },
    });
    // 端点はともにスナップショット内のインフラエンティティとして存在する。
    expect(observed.edge.fromWorkbenchId).toBe("workbench-alice");
    client.disconnect();
    vi.useRealTimers();
  });

  it("emits a lighthouse-1 -> reth-node-1 nodeLinkActivity on each tick (D層。Issue #188)", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();
    vi.advanceTimersByTime(1000);
    const diffs = onDiff.mock.calls[0][0];
    const activity = diffs.find(
      (d: { type: string }) => d.type === "nodeLinkActivity",
    );
    expect(activity).toMatchObject({
      type: "nodeLinkActivity",
      activity: {
        fromNodeId: "lighthouse-1",
        toNodeId: "reth-node-1",
      },
    });
    expect(activity.activity.calls.length).toBeGreaterThan(0);
    client.disconnect();
    vi.useRealTimers();
  });

  it("emits a fresh nodeLinkActivity on every subsequent tick", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(onDiff).toHaveBeenCalledTimes(2);
    for (const call of onDiff.mock.calls) {
      const activity = call[0].find(
        (d: { type: string }) => d.type === "nodeLinkActivity",
      );
      expect(activity).toBeTruthy();
    }
    client.disconnect();
    vi.useRealTimers();
  });
});

describe("createMultiNetworkMockSnapshot", () => {
  it("provides two distinct networkIds for grouping checks", () => {
    const snapshot = createMultiNetworkMockSnapshot();
    const networkIds = new Set(snapshot.edges.map((e) => e.networkId));
    expect(networkIds.size).toBe(2);
    expect(networkIds).toContain(MOCK_NETWORK_ID);
  });

  it("keeps every edge endpoint present as a node", () => {
    const snapshot = createMultiNetworkMockSnapshot();
    const nodeIds = new Set(
      snapshot.entities
        .filter((e) => e.kind === "node")
        .map((e) => (e as { id: string }).id),
    );
    for (const edge of snapshot.edges) {
      expect(nodeIds.has(edge.fromNodeId)).toBe(true);
      expect(nodeIds.has(edge.toNodeId)).toBe(true);
    }
  });

  it("renders into two grouped cords with no dangling edges", () => {
    // スナップショット → 描画変換までを通し、端点欠落やグルーピング崩れが
    // 起きないことを確認する。
    const snapshot = createMultiNetworkMockSnapshot();
    const presentNodeIds = snapshot.entities
      .filter((e) => e.kind === "node")
      .map((e) => (e as { id: string }).id);
    const flow = peerEdgesToFlowEdges(snapshot.edges, presentNodeIds);
    expect(flow).toHaveLength(snapshot.edges.length);
    const groups = groupEdgesByNetwork(flow);
    expect(groups.size).toBe(2);
    for (const bucket of groups.values()) {
      expect(bucket).toHaveLength(1);
    }
  });
});

describe("createMockClient", () => {
  it("emits a snapshot on connect and reports connected status", () => {
    const onSnapshot = vi.fn();
    const onStatusChange = vi.fn();
    const client = createMockClient(
      { onSnapshot, onStatusChange },
      { intervalMs: 0 },
    );
    client.connect();
    expect(client.getStatus()).toBe("connected");
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("connected");
  });

  it("does not start a timer when intervalMs is 0", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const client = createMockClient({ onSnapshot: vi.fn() }, { intervalMs: 0 });
    client.connect();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("emits blockHeight diffs on each tick", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();
    vi.advanceTimersByTime(2000);
    expect(onDiff).toHaveBeenCalledTimes(2);
    client.disconnect();
    vi.advanceTimersByTime(2000);
    expect(onDiff).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("returns a mock command id from sendCommand", () => {
    const client = createMockClient({}, { intervalMs: 0 });
    expect(client.sendCommand({ action: "addWorkbench", label: "x" })).toMatch(
      /^mock-cmd-/,
    );
  });

  it("simulates a successful addNode with an entityAdded diff and ok result", async () => {
    const onDiff = vi.fn();
    const onCommandResult = vi.fn();
    const client = createMockClient(
      { onDiff, onCommandResult },
      { intervalMs: 0 },
    );
    client.connect();
    const id = client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    await Promise.resolve();

    expect(onCommandResult).toHaveBeenCalledWith(id, true, undefined);
    const diff = onDiff.mock.calls[0][0];
    expect(diff[0].type).toBe("entityAdded");
    expect(diff[0].entity.kind).toBe("node");
  });

  it("simulates a successful addWorkbench carrying the given label", async () => {
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({ action: "addWorkbench", label: "Carol" });
    await Promise.resolve();

    const diff = onDiff.mock.calls[0][0];
    expect(diff[0].type).toBe("entityAdded");
    expect(diff[0].entity.kind).toBe("workbench");
    expect(diff[0].entity.label).toBe("Carol");
  });

  it("rejects removing an initial (validator) node with ok:false and an error", async () => {
    const onDiff = vi.fn();
    const onCommandResult = vi.fn();
    const client = createMockClient(
      { onDiff, onCommandResult },
      { intervalMs: 0 },
    );
    client.connect();
    const id = client.sendCommand({ action: "removeNode", nodeId: "reth-node-1" });
    await Promise.resolve();

    expect(onCommandResult).toHaveBeenCalledWith(id, false, expect.any(String));
    expect(onDiff).not.toHaveBeenCalled();
  });

  it("removes an added follower node and reports success", async () => {
    const onDiff = vi.fn();
    const onCommandResult = vi.fn();
    const client = createMockClient(
      { onDiff, onCommandResult },
      { intervalMs: 0 },
    );
    client.connect();
    client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    await Promise.resolve();
    const addedId = onDiff.mock.calls[0][0][0].entity.id as string;

    const removeId = client.sendCommand({ action: "removeNode", nodeId: addedId });
    await Promise.resolve();

    expect(onCommandResult).toHaveBeenLastCalledWith(removeId, true, undefined);
    const lastDiff = onDiff.mock.calls.at(-1)?.[0];
    expect(lastDiff[0]).toEqual({ type: "entityRemoved", id: addedId });
  });

  it("rejects removing an unknown workbench", async () => {
    const onCommandResult = vi.fn();
    const client = createMockClient({ onCommandResult }, { intervalMs: 0 });
    client.connect();
    const id = client.sendCommand({
      action: "removeWorkbench",
      workbenchId: "does-not-exist",
    });
    await Promise.resolve();
    expect(onCommandResult).toHaveBeenCalledWith(id, false, expect.any(String));
  });

  it("rejects removing a node id that never existed", async () => {
    const onDiff = vi.fn();
    const onCommandResult = vi.fn();
    const client = createMockClient({ onDiff, onCommandResult }, { intervalMs: 0 });
    client.connect();
    const id = client.sendCommand({ action: "removeNode", nodeId: "ghost-node" });
    await Promise.resolve();
    expect(onCommandResult).toHaveBeenCalledWith(id, false, expect.any(String));
    expect(onDiff).not.toHaveBeenCalled();
  });

  it("adds and removes a workbench in a round trip", async () => {
    const onDiff = vi.fn();
    const onCommandResult = vi.fn();
    const client = createMockClient({ onDiff, onCommandResult }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({ action: "addWorkbench", label: "Zoe" });
    await Promise.resolve();
    const addedId = onDiff.mock.calls[0][0][0].entity.id as string;

    const removeId = client.sendCommand({
      action: "removeWorkbench",
      workbenchId: addedId,
    });
    await Promise.resolve();
    expect(onCommandResult).toHaveBeenLastCalledWith(removeId, true, undefined);
    expect(onDiff.mock.calls.at(-1)?.[0][0]).toEqual({
      type: "entityRemoved",
      id: addedId,
    });
  });

  it("assigns unique entity ids across a burst of mixed adds", async () => {
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    client.sendCommand({ action: "addWorkbench", label: "a" });
    client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    client.sendCommand({ action: "addWorkbench", label: "b" });
    await Promise.resolve();

    const ids = onDiff.mock.calls.map((call) => call[0][0].entity.id as string);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    // 追加エンティティの id は初期スナップショットの id と衝突しない。
    for (const id of ids) {
      expect(id).not.toBe("reth-node-1");
      expect(id).not.toBe("workbench-alice");
    }
  });

  it("returns monotonically increasing command ids", () => {
    const client = createMockClient({}, { intervalMs: 0 });
    const first = client.sendCommand({ action: "addWorkbench", label: "a" });
    const second = client.sendCommand({ action: "addWorkbench", label: "b" });
    expect(first).not.toBe(second);
  });

  it("defers command results by commandLatencyMs and clears them on disconnect", () => {
    vi.useFakeTimers();
    const onCommandResult = vi.fn();
    const client = createMockClient(
      { onCommandResult },
      { intervalMs: 0, commandLatencyMs: 500 },
    );
    client.connect();
    client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    // 遅延中はまだ結果が返らない。
    vi.advanceTimersByTime(499);
    expect(onCommandResult).not.toHaveBeenCalled();

    // 結果が返る前に切断すると保留中のタイマーは破棄され、結果は届かない。
    client.disconnect();
    vi.advanceTimersByTime(5000);
    expect(onCommandResult).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("delivers a deferred command result once the latency elapses", () => {
    vi.useFakeTimers();
    const onCommandResult = vi.fn();
    const client = createMockClient(
      { onCommandResult },
      { intervalMs: 0, commandLatencyMs: 500 },
    );
    client.connect();
    const id = client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    vi.advanceTimersByTime(500);
    expect(onCommandResult).toHaveBeenCalledWith(id, true, undefined);
    vi.useRealTimers();
  });

  it("does not re-emit a snapshot on a second connect while connected", () => {
    const onSnapshot = vi.fn();
    const client = createMockClient({ onSnapshot }, { intervalMs: 0 });
    client.connect();
    client.connect();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it("re-emits a snapshot after a disconnect/connect cycle", () => {
    const onSnapshot = vi.fn();
    const client = createMockClient({ onSnapshot }, { intervalMs: 0 });
    client.connect();
    client.disconnect();
    client.connect();
    expect(onSnapshot).toHaveBeenCalledTimes(2);
  });

  it("does not fire a status change when disconnecting without connecting", () => {
    const onStatusChange = vi.fn();
    const client = createMockClient({ onStatusChange }, { intervalMs: 0 });
    client.disconnect();
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(client.getStatus()).toBe("disconnected");
  });

  it("does not start a timer for a negative interval", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const client = createMockClient({ onSnapshot: vi.fn() }, { intervalMs: -1 });
    client.connect();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("stops emitting diffs and can be safely disconnected twice", () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 1000 });
    client.connect();
    vi.advanceTimersByTime(1000);
    expect(onDiff).toHaveBeenCalledTimes(1);
    client.disconnect();
    expect(() => client.disconnect()).not.toThrow();
    vi.advanceTimersByTime(5000);
    expect(onDiff).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("createMockClient addNode reth+beacon pair (Issue #123 §4-6)", () => {
  it("emits both a reth and a beacon entityAdded in a single diff for one addNode", async () => {
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    await Promise.resolve();

    const diff = onDiff.mock.calls[0][0] as DiffEvent[];
    expect(diff).toHaveLength(2);
    const kinds = diff.map((e) => e.type === "entityAdded" && e.entity.kind);
    expect(kinds).toEqual(["node", "node"]);
    const clientTypes = diff.map(
      (e) => e.type === "entityAdded" && e.entity.kind === "node" && e.entity.clientType,
    );
    expect(clientTypes.sort()).toEqual(["lighthouse", "reth"]);
  });

  it("marks both new nodes as p2pRole peer and removable", async () => {
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    await Promise.resolve();

    const diff = onDiff.mock.calls[0][0] as DiffEvent[];
    for (const event of diff) {
      if (event.type !== "entityAdded" || event.entity.kind !== "node") continue;
      expect(event.entity.p2pRole).toBe("peer");
      expect(event.entity.removable).toBe(true);
    }
  });

  it("assigns each addNode call a distinct reth/beacon id pair", async () => {
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    await Promise.resolve();

    const ids = onDiff.mock.calls.flatMap((call) =>
      (call[0] as DiffEvent[]).map(
        (e) => e.type === "entityAdded" && e.entity.kind === "node" && e.entity.id,
      ),
    );
    expect(new Set(ids).size).toBe(4);
  });

  it("resolves a new workbench's rpcTargetNodeId to the EL bootnode", async () => {
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({ action: "addWorkbench", label: "Zoe" });
    await Promise.resolve();

    const diff = onDiff.mock.calls[0][0] as DiffEvent[];
    const event = diff[0];
    expect(event.type === "entityAdded" && event.entity.kind === "workbench" && event.entity.rpcTargetNodeId).toBe(
      "reth-node-1",
    );
  });

  it("emits edgeAdded diffs for both new nodes after the connect delay elapses", async () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({ action: "addNode", chainProfile: "ethereum" });

    // コマンド結果・entityAdded 自体はマイクロタスク（queueMicrotask）で解決
    // されるため、フェイクタイマーの advance ではなく Promise を1度挟んで
    // マイクロタスクキューを吐き出させる必要がある。
    await Promise.resolve();
    const callsBeforeDelay = onDiff.mock.calls.length;

    vi.advanceTimersByTime(ADD_NODE_PEER_CONNECT_DELAY_MS - 1);
    expect(onDiff.mock.calls.length).toBe(callsBeforeDelay);

    vi.advanceTimersByTime(1);
    expect(onDiff.mock.calls.length).toBe(callsBeforeDelay + 1);
    const edgeDiff = onDiff.mock.calls.at(-1)?.[0] as DiffEvent[];
    expect(edgeDiff).toHaveLength(2);
    expect(edgeDiff.every((e) => e.type === "edgeAdded")).toBe(true);
    vi.useRealTimers();
  });

  it("does not emit the delayed edgeAdded diffs if disconnected before the delay elapses", async () => {
    vi.useFakeTimers();
    const onDiff = vi.fn();
    const client = createMockClient({ onDiff }, { intervalMs: 0 });
    client.connect();
    client.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    await Promise.resolve();
    const callsBeforeDisconnect = onDiff.mock.calls.length;

    client.disconnect();
    vi.advanceTimersByTime(ADD_NODE_PEER_CONNECT_DELAY_MS * 2);
    expect(onDiff.mock.calls.length).toBe(callsBeforeDisconnect);
    vi.useRealTimers();
  });
});
