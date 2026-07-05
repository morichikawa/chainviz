import type {
  DiffEvent,
  NodeEntity,
  WorkbenchEntity,
} from "@chainviz/shared";
import { describe, expect, it, vi } from "vitest";
import type { RpcObservation } from "./logging-proxy.js";
import {
  createOperationObserver,
  parseProxyTargetHost,
  resolveOperationEdge,
  type OperationEndpointResolver,
} from "./operation-observer.js";

function workbench(overrides: Partial<WorkbenchEntity> = {}): WorkbenchEntity {
  return {
    kind: "workbench",
    id: "chainviz-ethereum/workbench1",
    containerName: "workbench1",
    ip: "172.28.2.5",
    ports: [],
    resources: { cpuPercent: 1, memMB: 10 },
    process: { name: "workbench" },
    label: "workbench1",
    walletIds: [],
    ...overrides,
  };
}

function node(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "chainviz-ethereum/reth1",
    containerName: "reth1",
    ip: "172.28.1.1",
    ports: [8545],
    resources: { cpuPercent: 10, memMB: 100 },
    process: { name: "reth" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 0,
    headBlockHash: "",
    ...overrides,
  };
}

function observation(overrides: Partial<RpcObservation> = {}): RpcObservation {
  return {
    timestamp: 1_700_000_000_000,
    callerIp: "172.28.2.5",
    method: "eth_sendRawTransaction",
    params: [],
    id: 1,
    ...overrides,
  };
}

/** in-memory の解決口。ip → エンティティの単純検索。 */
function resolverOf(
  workbenches: WorkbenchEntity[],
  nodes: NodeEntity[],
): OperationEndpointResolver {
  return {
    findWorkbenchByIp: (ip) => workbenches.find((w) => w.ip === ip),
    findNodeByIp: (ip) => nodes.find((n) => n.ip === ip),
  };
}

describe("parseProxyTargetHost", () => {
  it("extracts the host from a target url", () => {
    expect(parseProxyTargetHost("http://172.28.1.1:8545")).toBe("172.28.1.1");
  });

  it("extracts a hostname target", () => {
    expect(parseProxyTargetHost("http://reth1:8545")).toBe("reth1");
  });

  it("returns undefined for an unparseable target", () => {
    expect(parseProxyTargetHost("not a url")).toBeUndefined();
  });
});

describe("resolveOperationEdge", () => {
  it("maps an observation to an operation edge (method/timestamp/ip resolution)", () => {
    const resolver = resolverOf(
      [workbench({ id: "w-1", ip: "172.28.2.5" })],
      [node({ id: "n-1", ip: "172.28.1.1" })],
    );
    const result = resolveOperationEdge(
      observation({
        callerIp: "172.28.2.5",
        method: "eth_call",
        timestamp: 42,
      }),
      "172.28.1.1",
      resolver,
    );
    expect(result).toEqual({
      ok: true,
      edge: {
        kind: "operation",
        fromWorkbenchId: "w-1",
        toNodeId: "n-1",
        operation: "eth_call",
        observedAt: 42,
      },
    });
  });

  it("fails with workbench-unresolved when the caller ip matches no workbench", () => {
    const resolver = resolverOf([], [node({ ip: "172.28.1.1" })]);
    const result = resolveOperationEdge(
      observation({ callerIp: "10.0.0.99" }),
      "172.28.1.1",
      resolver,
    );
    expect(result).toEqual({
      ok: false,
      reason: "workbench-unresolved",
      callerIp: "10.0.0.99",
    });
  });

  it("fails with node-unresolved when the target host matches no node", () => {
    const resolver = resolverOf(
      [workbench({ ip: "172.28.2.5" })],
      [node({ ip: "172.28.1.1" })],
    );
    const result = resolveOperationEdge(
      observation({ callerIp: "172.28.2.5" }),
      "172.28.9.9",
      resolver,
    );
    expect(result).toEqual({
      ok: false,
      reason: "node-unresolved",
      targetHost: "172.28.9.9",
    });
  });
});

describe("createOperationObserver", () => {
  it("broadcasts an operationObserved event when both endpoints resolve", () => {
    const resolver = resolverOf(
      [workbench({ id: "w-1", ip: "172.28.2.5" })],
      [node({ id: "n-1", ip: "172.28.1.1" })],
    );
    const broadcast = vi.fn<(events: DiffEvent[]) => void>();
    const log = vi.fn();
    const observe = createOperationObserver({
      targetHost: "172.28.1.1",
      resolver,
      broadcast,
      log,
    });

    observe(observation({ method: "eth_getBalance", timestamp: 7 }));

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith([
      {
        type: "operationObserved",
        edge: {
          kind: "operation",
          fromWorkbenchId: "w-1",
          toNodeId: "n-1",
          operation: "eth_getBalance",
          observedAt: 7,
        },
      },
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it("does not broadcast and logs when the caller ip resolves to no workbench", () => {
    const resolver = resolverOf([], [node({ ip: "172.28.1.1" })]);
    const broadcast = vi.fn<(events: DiffEvent[]) => void>();
    const log = vi.fn();
    const observe = createOperationObserver({
      targetHost: "172.28.1.1",
      resolver,
      broadcast,
      log,
    });

    observe(observation({ callerIp: "10.0.0.99", method: "eth_call" }));

    expect(broadcast).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const [message, detail] = log.mock.calls[0];
    expect(message).toContain("10.0.0.99");
    expect(message).toContain("no workbench");
    expect(detail).toEqual({ method: "eth_call" });
  });

  it("does not broadcast and logs when the target host resolves to no node", () => {
    const resolver = resolverOf([workbench({ ip: "172.28.2.5" })], []);
    const broadcast = vi.fn<(events: DiffEvent[]) => void>();
    const log = vi.fn();
    const observe = createOperationObserver({
      targetHost: "172.28.9.9",
      resolver,
      broadcast,
      log,
    });

    observe(observation({ callerIp: "172.28.2.5", method: "eth_call" }));

    expect(broadcast).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const [message] = log.mock.calls[0];
    expect(message).toContain("172.28.9.9");
    expect(message).toContain("does not match");
  });

  it("resolves against the current resolver state on each call (late-added workbench)", () => {
    const workbenches: WorkbenchEntity[] = [];
    const resolver: OperationEndpointResolver = {
      findWorkbenchByIp: (ip) => workbenches.find((w) => w.ip === ip),
      findNodeByIp: (ip) =>
        ip === "172.28.1.1" ? node({ id: "n-1", ip }) : undefined,
    };
    const broadcast = vi.fn<(events: DiffEvent[]) => void>();
    const observe = createOperationObserver({
      targetHost: "172.28.1.1",
      resolver,
      broadcast,
      log: vi.fn(),
    });

    // まだワークベンチが存在しない時点では配信されない。
    observe(observation({ callerIp: "172.28.2.5" }));
    expect(broadcast).not.toHaveBeenCalled();

    // 後からワークベンチが追加されると、次の観測は解決できて配信される。
    workbenches.push(workbench({ id: "w-late", ip: "172.28.2.5" }));
    observe(observation({ callerIp: "172.28.2.5" }));
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0][0]).toMatchObject({
      type: "operationObserved",
      edge: { fromWorkbenchId: "w-late", toNodeId: "n-1" },
    });
  });
});
