import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { resolveBootNodes, resolveRpcTargetNode } from "./connectionTargets.js";

function node(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "reth-1",
    containerName: "chainviz-reth-1",
    ip: "172.20.0.2",
    ports: [8545],
    resources: { cpuPercent: 1, memMB: 100 },
    process: { name: "reth node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 1,
    headBlockHash: "0x0",
    ...overrides,
  };
}

function workbench(overrides: Partial<WorkbenchEntity> = {}): WorkbenchEntity {
  return {
    kind: "workbench",
    id: "wb-1",
    containerName: "chainviz-wb-1",
    ip: "172.20.0.9",
    ports: [],
    resources: { cpuPercent: 0, memMB: 10 },
    process: { name: "foundry" },
    label: "Alice",
    walletIds: [],
    ...overrides,
  };
}

describe("resolveBootNodes", () => {
  it("finds the execution and consensus bootnodes by clientType category", () => {
    const elBoot = node({ id: "reth-1", clientType: "reth", p2pRole: "bootnode" });
    const clBoot = node({
      id: "lh-1",
      clientType: "lighthouse",
      p2pRole: "bootnode",
    });
    const result = resolveBootNodes([elBoot, clBoot]);
    expect(result.execution).toBe(elBoot);
    expect(result.consensus).toBe(clBoot);
  });

  it("ignores non-bootnode peers", () => {
    const peer = node({ id: "reth-2", clientType: "reth", p2pRole: "peer" });
    expect(resolveBootNodes([peer])).toEqual({});
  });

  it("ignores nodes without a p2pRole (undefined = unknown)", () => {
    const unknown = node({ id: "reth-2", clientType: "reth" });
    expect(resolveBootNodes([unknown])).toEqual({});
  });

  it("returns an empty object when there are no entities", () => {
    expect(resolveBootNodes([])).toEqual({});
  });

  it("ignores non-node entities", () => {
    expect(resolveBootNodes([workbench()])).toEqual({});
  });

  it("keeps the first match per category when duplicate bootnode roles exist", () => {
    const first = node({ id: "reth-1", clientType: "reth", p2pRole: "bootnode" });
    const second = node({ id: "reth-2", clientType: "reth", p2pRole: "bootnode" });
    const result = resolveBootNodes([first, second]);
    expect(result.execution).toBe(first);
  });

  it("only sets the category actually present", () => {
    const elBoot = node({ id: "reth-1", clientType: "reth", p2pRole: "bootnode" });
    const result = resolveBootNodes([elBoot]);
    expect(result.execution).toBe(elBoot);
    expect(result.consensus).toBeUndefined();
  });

  it("only sets the consensus category when just a consensus bootnode is present", () => {
    // execution-only の対称ケース。片側だけ解決できても他方は undefined のまま。
    const clBoot = node({ id: "lh-1", clientType: "lighthouse", p2pRole: "bootnode" });
    const result = resolveBootNodes([clBoot]);
    expect(result.consensus).toBe(clBoot);
    expect(result.execution).toBeUndefined();
  });

  it("ignores a bootnode whose clientType category is unrecognized (neither EL nor CL)", () => {
    const oddBoot = node({ id: "x-1", clientType: "some-unknown-client", p2pRole: "bootnode" });
    expect(resolveBootNodes([oddBoot])).toEqual({});
  });
});

describe("resolveRpcTargetNode", () => {
  it("resolves the node referenced by an existing workbench's rpcTargetNodeId", () => {
    const target = node({ id: "reth-1" });
    const wb = workbench({ rpcTargetNodeId: "reth-1" });
    expect(resolveRpcTargetNode([target, wb])).toBe(target);
  });

  it("returns undefined when no workbench has rpcTargetNodeId set", () => {
    const target = node({ id: "reth-1" });
    const wb = workbench({});
    expect(resolveRpcTargetNode([target, wb])).toBeUndefined();
  });

  it("returns undefined when rpcTargetNodeId points at a node that no longer exists", () => {
    const wb = workbench({ rpcTargetNodeId: "does-not-exist" });
    expect(resolveRpcTargetNode([wb])).toBeUndefined();
  });

  it("returns undefined for an empty entity list", () => {
    expect(resolveRpcTargetNode([])).toBeUndefined();
  });

  it("uses the first workbench with a resolvable target when several exist", () => {
    const target = node({ id: "reth-1" });
    const wbNoTarget = workbench({ id: "wb-1" });
    const wbWithTarget = workbench({ id: "wb-2", rpcTargetNodeId: "reth-1" });
    expect(resolveRpcTargetNode([wbNoTarget, wbWithTarget, target])).toBe(target);
  });

  it("skips a workbench whose rpcTargetNodeId is dangling and uses the next resolvable one", () => {
    // 先頭のワークベンチは rpcTargetNodeId を持つが、指す先のノードが存在しない
    // （collector が毎ポーリング解決し直すため、対象ノードが観測から消えると
    // 一時的にダングリングし得る。worklog の collector からの申し送り参照）。
    // ここで探索を打ち切らず、次に解決できるワークベンチの対象を返す。
    const target = node({ id: "reth-1" });
    const wbDangling = workbench({ id: "wb-1", rpcTargetNodeId: "removed-node" });
    const wbResolvable = workbench({ id: "wb-2", rpcTargetNodeId: "reth-1" });
    expect(resolveRpcTargetNode([wbDangling, wbResolvable, target])).toBe(target);
  });
});
