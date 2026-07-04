import { describe, expect, it, vi } from "vitest";
import {
  groupEdgesByNetwork,
  peerEdgesToFlowEdges,
} from "../entities/peerEdge.js";
import {
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
