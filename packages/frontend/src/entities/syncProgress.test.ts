import type { NodeEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  computeMaxSyncTargetHeight,
  findCurrentSyncStage,
} from "./syncProgress.js";

function node(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "reth-1",
    containerName: "chainviz-reth-1",
    ip: "172.20.0.11",
    ports: [8545],
    resources: { cpuPercent: 1, memMB: 100 },
    process: { name: "reth node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 128,
    headBlockHash: "0x80",
    ...overrides,
  };
}

describe("computeMaxSyncTargetHeight", () => {
  it("returns the highest blockHeight among nodes that report syncStages", () => {
    const nodes = [
      node({ id: "a", blockHeight: 100, internals: { syncStages: [] } }),
      node({ id: "b", blockHeight: 128, internals: { syncStages: [] } }),
      node({ id: "c", blockHeight: 64, internals: { syncStages: [] } }),
    ];
    expect(computeMaxSyncTargetHeight(nodes)).toBe(128);
  });

  it("ignores nodes without internals.syncStages even if their blockHeight is higher", () => {
    const nodes = [
      node({ id: "a", blockHeight: 999 }), // internals自体が省略（CLノード相当）
      node({ id: "b", blockHeight: 50, internals: { syncStages: [] } }),
    ];
    expect(computeMaxSyncTargetHeight(nodes)).toBe(50);
  });

  it("returns 0 when no node reports syncStages", () => {
    const nodes = [node({ blockHeight: 500 })];
    expect(computeMaxSyncTargetHeight(nodes)).toBe(0);
  });

  it("returns 0 for an empty node list", () => {
    expect(computeMaxSyncTargetHeight([])).toBe(0);
  });

  it("does not error on a node whose syncStages is an empty array (still counts toward the max)", () => {
    const nodes = [node({ blockHeight: 10, internals: { syncStages: [] } })];
    expect(computeMaxSyncTargetHeight(nodes)).toBe(10);
  });

  it("ignores a node that has internals but no syncStages field (mempool-only internals)", () => {
    // internals は存在するが syncStages が省略されているノード（例: mempool
    // だけ観測できた EL、あるいは将来 CL に mempool 相当が乗るケース）は
    // 分母対象に含めない。判定は `internals?.syncStages === undefined`。
    const nodes = [
      node({ id: "a", blockHeight: 777, internals: { mempool: { pending: 1, queued: 0 } } }),
      node({ id: "b", blockHeight: 42, internals: { syncStages: [] } }),
    ];
    expect(computeMaxSyncTargetHeight(nodes)).toBe(42);
  });

  it("returns the common value when every reporting node shares the same blockHeight", () => {
    const nodes = [
      node({ id: "a", blockHeight: 200, internals: { syncStages: [] } }),
      node({ id: "b", blockHeight: 200, internals: { syncStages: [] } }),
    ];
    expect(computeMaxSyncTargetHeight(nodes)).toBe(200);
  });

  it("returns 0 when every reporting node is still at blockHeight 0 (backfill just started)", () => {
    // 全 EL が起動直後で blockHeight 0（バックフィル開始直後）の縮退状態。
    // 目標高0はバーを出さないフォールバックへ倒す前提（呼び出し側）。
    const nodes = [
      node({ id: "a", blockHeight: 0, internals: { syncStages: [] } }),
      node({ id: "b", blockHeight: 0, internals: { syncStages: [] } }),
    ];
    expect(computeMaxSyncTargetHeight(nodes)).toBe(0);
  });
});

describe("findCurrentSyncStage", () => {
  const stages = [
    { stage: "Headers", checkpoint: 128 },
    { stage: "Bodies", checkpoint: 64 },
    { stage: "SenderRecovery", checkpoint: 0 },
    { stage: "Execution", checkpoint: 0 },
  ];

  it("returns the first stage whose checkpoint is behind the target height", () => {
    expect(findCurrentSyncStage(stages, 128)?.stage).toBe("Bodies");
  });

  it("returns the last stage when every stage has already caught up to target", () => {
    const caughtUp = stages.map((s) => ({ ...s, checkpoint: 128 }));
    expect(findCurrentSyncStage(caughtUp, 128)?.stage).toBe("Execution");
  });

  it("falls back to the first stage when targetHeight is 0 (unresolvable)", () => {
    expect(findCurrentSyncStage(stages, 0)?.stage).toBe("Headers");
  });

  it("falls back to the first stage when targetHeight is negative (defensive)", () => {
    expect(findCurrentSyncStage(stages, -1)?.stage).toBe("Headers");
  });

  it("returns undefined for an empty stages array", () => {
    expect(findCurrentSyncStage([], 128)).toBeUndefined();
  });

  it("treats a stage exactly at the target height as caught up (boundary), not in progress", () => {
    const atTarget = [{ stage: "Headers", checkpoint: 128 }];
    expect(findCurrentSyncStage(atTarget, 128)?.stage).toBe("Headers");
    // 唯一のステージなので in-progress でも caught-up でも同じ要素が返る点を
    // 明確にするため、checkpoint が target 未満のケースと対比させる。
    const behindTarget = [{ stage: "Headers", checkpoint: 127 }];
    expect(findCurrentSyncStage(behindTarget, 128)?.checkpoint).toBe(127);
  });

  it("returns the first stage when all stages share the same checkpoint below the target", () => {
    // 全ステージの checkpoint が同値かつ target 未満なら、配列順で最初の
    // ステージが「現在」になる（find は先頭で一致して即返る）。
    const allBehind = [
      { stage: "Headers", checkpoint: 50 },
      { stage: "Bodies", checkpoint: 50 },
      { stage: "Execution", checkpoint: 50 },
    ];
    expect(findCurrentSyncStage(allBehind, 128)?.stage).toBe("Headers");
  });

  it("returns the last stage when all stages share the same checkpoint equal to the target", () => {
    // 全ステージが同値かつ target と一致（= 全て追いついた）なら最後を返す。
    const allAtTarget = [
      { stage: "Headers", checkpoint: 128 },
      { stage: "Bodies", checkpoint: 128 },
      { stage: "Execution", checkpoint: 128 },
    ];
    expect(findCurrentSyncStage(allAtTarget, 128)?.stage).toBe("Execution");
  });

  it("ignores checkpoints ahead of the target and still returns the first stage strictly behind", () => {
    // 後段ステージが target を追い越しているように見えても（実運用では
    // 起こらないが型上は可能）、配列順で最初に「checkpoint < target」を
    // 満たすステージが返る。
    const mixed = [
      { stage: "Headers", checkpoint: 200 },
      { stage: "Bodies", checkpoint: 100 },
    ];
    expect(findCurrentSyncStage(mixed, 128)?.stage).toBe("Bodies");
  });
});
