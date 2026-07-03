import { describe, expect, it, vi } from "vitest";
import { createMockClient, createMockSnapshot } from "./mockData.js";

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
