// Issue #420 テスト強化: validator→beacon の活動イベントが、正しい常設エッジ
// （validator が source 側の内部リンク）にだけ乗ることを固定する。
//
// collector 側の契約は「fromNodeId = 駆動する側」であり、reth の Engine API
// （beacon→reth）と validator（validator→beacon）で「駆動する側」が入れ替わる
// （docs/ARCHITECTURE.md §7.6.12）。フックはこの from/to をそのままエッジ ID に
// 使うため、collector 側で向きが逆になっただけでパルスが 1 本も出なくなる。
// 既存の useNodeLinkActivityPulses.test.tsx は Engine API 方向だけを扱うので、
// validator 方向の取り違えはこのファイルで見る（1ファイル1責務）。

import type { NodeLinkActivity } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type InternalLinkFlowEdge,
  type NodeLinkActivitySignal,
  internalLinkEdgeId,
} from "./internalLinkEdge.js";
import { useNodeLinkActivityPulses } from "./useNodeLinkActivityPulses.js";

/** validator→beacon（Beacon API。§7.6.11/§7.6.12）の常設エッジ。 */
function validatorEdge(): InternalLinkFlowEdge {
  return {
    id: internalLinkEdgeId("validator-1", "beacon-1"),
    type: "internalLink",
    source: "validator-1",
    target: "beacon-1",
    data: {
      drivingContainerName: "chainviz-ethereum-validator1-1",
      drivenContainerName: "chainviz-ethereum-beacon1-1",
      drivingNodeRole: "validator",
      drivenNodeRole: "consensus",
    },
  };
}

/** beacon→reth（Engine API）の常設エッジ。同じ beacon を端点に持つ。 */
function engineEdge(): InternalLinkFlowEdge {
  return {
    id: internalLinkEdgeId("beacon-1", "reth-1"),
    type: "internalLink",
    source: "beacon-1",
    target: "reth-1",
    data: {
      drivingContainerName: "chainviz-ethereum-beacon1-1",
      drivenContainerName: "chainviz-ethereum-reth1-1",
      drivingNodeRole: "consensus",
      drivenNodeRole: "execution",
    },
  };
}

function validatorSignal(
  seq: number,
  overrides: Partial<NodeLinkActivity> = {},
): NodeLinkActivitySignal {
  return {
    seq,
    activity: {
      fromNodeId: "validator-1",
      toNodeId: "beacon-1",
      calls: [{ method: "vc_signed_attestations_total:success", count: 1, latencyMs: 1.2 }],
      observedAt: 2_000,
      ...overrides,
    },
  };
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useNodeLinkActivityPulses: validator→beacon direction (Issue #420)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("attaches the pulse and last activity to the validator→beacon edge", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, [validatorEdge()]),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    rerender({ signals: [validatorSignal(0)] });
    advance(0);
    expect(result.current).toHaveLength(1);
    expect(result.current[0].data?.pulses).toHaveLength(1);
    expect(result.current[0].data?.lastActivity).toEqual({
      calls: [
        { method: "vc_signed_attestations_total:success", count: 1, latencyMs: 1.2 },
      ],
      observedAt: 2_000,
    });
  });

  it("ignores an activity whose direction is reversed (beacon→validator)", () => {
    // collector が from/to を取り違えた場合に相当。エッジ ID が一致しないため
    // ダングリングガードで落ち、誤った向きのパルスは描かれない。
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, [validatorEdge()]),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    rerender({
      signals: [
        validatorSignal(0, { fromNodeId: "beacon-1", toNodeId: "validator-1" }),
      ],
    });
    advance(0);
    expect(result.current[0].data?.pulses).toBeUndefined();
    expect(result.current[0].data?.lastActivity).toBeUndefined();
  });

  it("does not leak the validator activity onto the beacon→reth edge that shares the beacon", () => {
    const edges = [validatorEdge(), engineEdge()];
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, edges),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    rerender({ signals: [validatorSignal(0)] });
    advance(0);
    const validator = result.current.find((edge) => edge.source === "validator-1");
    const engine = result.current.find((edge) => edge.source === "beacon-1");
    expect(validator?.data?.pulses).toHaveLength(1);
    expect(engine?.data?.pulses).toBeUndefined();
    expect(engine?.data?.lastActivity).toBeUndefined();
  });

  it("keeps Engine API and validator observations on their own edges within one tick", () => {
    const edges = [validatorEdge(), engineEdge()];
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, edges),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    rerender({
      signals: [
        validatorSignal(0),
        validatorSignal(1, {
          fromNodeId: "beacon-1",
          toNodeId: "reth-1",
          calls: [{ method: "engine_newPayloadV4", count: 2 }],
          observedAt: 2_100,
        }),
      ],
    });
    advance(0);
    const validator = result.current.find((edge) => edge.source === "validator-1");
    const engine = result.current.find((edge) => edge.source === "beacon-1");
    expect(validator?.data?.lastActivity?.calls).toEqual([
      { method: "vc_signed_attestations_total:success", count: 1, latencyMs: 1.2 },
    ]);
    expect(engine?.data?.lastActivity?.calls).toEqual([
      { method: "engine_newPayloadV4", count: 2 },
    ]);
  });

  it("keeps the last activity after the pulse animation ends (hover still shows the breakdown)", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, [validatorEdge()]),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    rerender({ signals: [validatorSignal(0)] });
    advance(0);
    advance(5_000);
    expect(result.current[0].data?.pulses).toBeUndefined();
    expect(result.current[0].data?.lastActivity?.observedAt).toBe(2_000);
  });
});
