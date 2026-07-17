import type { WorldStateEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { dedupeBlockReceipts } from "./blockReceiptDedup.js";
import { testNode } from "./testFixtures.js";

function entitiesOf(...nodes: WorldStateEntity[]): Record<string, WorldStateEntity> {
  const map: Record<string, WorldStateEntity> = {};
  for (const node of nodes) {
    map[node.kind === "node" || node.kind === "workbench" ? node.id : ""] = node;
  }
  return map;
}

describe("dedupeBlockReceipts", () => {
  it("keeps a single non-paired reception as-is", () => {
    const entities = entitiesOf(testNode({ id: "reth-1" }));
    const result = dedupeBlockReceipts({ "reth-1": 1000 }, entities);
    expect(result).toEqual([{ nodeId: "reth-1", receivedAt: 1000 }]);
  });

  it("drops the driving (beacon) alias key when the driven (execution) key has the same timestamp", () => {
    // Issue #141: executionTargets が [beaconStableId, obs.stableId] の両方へ
    // 同じ時刻を書き込む。beacon(CL) が drivesNodeId で execution(EL) を指す。
    const entities = entitiesOf(
      testNode({ id: "beacon-1", drivesNodeId: "reth-1", clientType: "lighthouse" }),
      testNode({ id: "reth-1" }),
    );
    const result = dedupeBlockReceipts(
      { "beacon-1": 1000, "reth-1": 1000 },
      entities,
    );
    expect(result).toEqual([{ nodeId: "reth-1", receivedAt: 1000 }]);
  });

  it("keeps both keys when their timestamps differ (not an alias pair, both are real receptions)", () => {
    const entities = entitiesOf(
      testNode({ id: "beacon-1", drivesNodeId: "reth-1", clientType: "lighthouse" }),
      testNode({ id: "reth-1" }),
    );
    const result = dedupeBlockReceipts(
      { "beacon-1": 1000, "reth-1": 1005 },
      entities,
    );
    expect(result).toEqual([
      { nodeId: "beacon-1", receivedAt: 1000 },
      { nodeId: "reth-1", receivedAt: 1005 },
    ]);
  });

  it("keeps a key whose entity is unknown (removed/never observed) as-is", () => {
    const result = dedupeBlockReceipts({ "unknown-node": 1000 }, {});
    expect(result).toEqual([{ nodeId: "unknown-node", receivedAt: 1000 }]);
  });

  it("ignores non-finite timestamps (NaN/Infinity), matching blockPulse.ts's contract", () => {
    const entities = entitiesOf(testNode({ id: "reth-1" }));
    const result = dedupeBlockReceipts(
      { "reth-1": Number.NaN, "reth-2": Number.POSITIVE_INFINITY },
      entities,
    );
    expect(result).toEqual([]);
  });

  it("does not drop an EL-only node that has no paired beacon", () => {
    const entities = entitiesOf(testNode({ id: "reth-only" }));
    const result = dedupeBlockReceipts({ "reth-only": 1000 }, entities);
    expect(result).toEqual([{ nodeId: "reth-only", receivedAt: 1000 }]);
  });
});
