import { describe, expect, it } from "vitest";
import type { ContractEntity } from "../world-state/index.js";
import type { ChainAdapter } from "./index.js";

/**
 * ChainAdapter 境界契約のテスト。ここでは実装ロジックではなく、Phase 4 で
 * 追加した subscribeContracts? が「省略可能フィールド」として型契約を壊さない
 * ことを型レベルで検証する。コントラクトという概念を持たない非 EVM チェーン
 * （Bitcoin 等）のアダプタが subscribeContracts を実装しなくても ChainAdapter
 * を満たせること、そのようなアダプタ利用側が optional chaining で安全に
 * 分岐できることを確認する。
 */
describe("ChainAdapter contract subscription boundary", () => {
  it("satisfies ChainAdapter without implementing subscribeContracts (非 EVM 互換)", () => {
    // subscribeContracts を持たない最小アダプタ。コントラクトの概念が無い
    // チェーンでもこの型契約を満たせる（省略可能）ことの確認。
    const nonContractAdapter: ChainAdapter = {
      chainType: "ethereum",
      async pollInfra() {
        return {};
      },
      subscribePeers() {
        // no-op
      },
      async subscribeBlocks() {
        // no-op
      },
      async subscribeTransactions() {
        // no-op
      },
    };

    expect(nonContractAdapter.subscribeContracts).toBeUndefined();
    // 利用側は optional chaining で「配線しない」側に安全に倒れる。
    expect(nonContractAdapter.subscribeContracts?.(() => {})).toBeUndefined();
  });

  it("accepts an adapter that implements subscribeContracts (コントラクト対応チェーン)", async () => {
    const seen: ContractEntity[] = [];
    const contractAdapter: ChainAdapter = {
      chainType: "ethereum",
      async pollInfra() {
        return {};
      },
      subscribePeers() {
        // no-op
      },
      async subscribeBlocks() {
        // no-op
      },
      async subscribeTransactions() {
        // no-op
      },
      async subscribeContracts(onContract) {
        onContract({
          kind: "contract",
          address: "0x00000000000000000000000000000000000c0de",
          chainType: "ethereum",
          name: "ChainvizToken",
        });
      },
    };

    // 利用側は実装があれば呼び出し、無ければ何もしない分岐を optional chaining
    // 1 本で書ける（存在確認と呼び出しが同じ形になる）。
    await contractAdapter.subscribeContracts?.((contract) => {
      seen.push(contract);
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe("ChainvizToken");
  });

  it("satisfies ChainAdapter without implementing subscribeNodeInternals (D層を持たないチェーン)", () => {
    // subscribeNodeInternals を持たない最小アダプタ。ノード内部という階層を
    // 持たないチェーン（非 EVM 等）でも型契約を満たせる（省略可能）ことの確認。
    const minimalAdapter: ChainAdapter = {
      chainType: "ethereum",
      async pollInfra() {
        return {};
      },
      subscribePeers() {
        // no-op
      },
      async subscribeBlocks() {
        // no-op
      },
      async subscribeTransactions() {
        // no-op
      },
    };

    expect(minimalAdapter.subscribeNodeInternals).toBeUndefined();
    // 利用側は optional chaining で「配線しない」側に安全に倒れる。
    expect(
      minimalAdapter.subscribeNodeInternals?.({
        onInternals: () => {},
        onLinkActivity: () => {},
      }),
    ).toBeUndefined();
  });

  it("accepts an adapter that implements subscribeNodeInternals (D層対応チェーン)", async () => {
    const internalsSeen: string[] = [];
    const activitySeen: string[] = [];
    const internalsAdapter: ChainAdapter = {
      chainType: "ethereum",
      async pollInfra() {
        return {};
      },
      subscribePeers() {
        // no-op
      },
      async subscribeBlocks() {
        // no-op
      },
      async subscribeTransactions() {
        // no-op
      },
      async subscribeNodeInternals({ onInternals, onLinkActivity }) {
        // 1 回のスクレイプから内部状態の更新と駆動リンク活動の両方が届く。
        onInternals("node-1", {
          syncStages: [{ stage: "Headers", checkpoint: 10 }],
          mempool: { pending: 1, queued: 0 },
        });
        onLinkActivity({
          fromNodeId: "beacon-1",
          toNodeId: "node-1",
          calls: [{ method: "engine_newPayload", count: 1 }],
          observedAt: 1_700_000_000_000,
        });
      },
    };

    await internalsAdapter.subscribeNodeInternals?.({
      onInternals: (nodeId, internals) => {
        internalsSeen.push(`${nodeId}:${internals.syncStages?.length ?? 0}`);
      },
      onLinkActivity: (activity) => {
        activitySeen.push(`${activity.fromNodeId}->${activity.toNodeId}`);
      },
    });

    expect(internalsSeen).toEqual(["node-1:1"]);
    expect(activitySeen).toEqual(["beacon-1->node-1"]);
  });

  it("treats subscribeContracts and subscribeNodeInternals as independently optional", () => {
    // 2 つの optional 購読口は互いに独立している。片方だけ実装したアダプタが
    // それぞれ型契約を満たし、利用側が optional chaining で個別に分岐できること
    // を確認する（C層はあるが D層は無い／その逆のチェーンを見据える）。
    const contractsOnly: ChainAdapter = {
      chainType: "ethereum",
      async pollInfra() {
        return {};
      },
      subscribePeers() {
        // no-op
      },
      async subscribeBlocks() {
        // no-op
      },
      async subscribeTransactions() {
        // no-op
      },
      async subscribeContracts() {
        // no-op
      },
    };
    expect(contractsOnly.subscribeContracts).toBeDefined();
    expect(contractsOnly.subscribeNodeInternals).toBeUndefined();

    const internalsOnly: ChainAdapter = {
      chainType: "ethereum",
      async pollInfra() {
        return {};
      },
      subscribePeers() {
        // no-op
      },
      async subscribeBlocks() {
        // no-op
      },
      async subscribeTransactions() {
        // no-op
      },
      async subscribeNodeInternals() {
        // no-op
      },
    };
    expect(internalsOnly.subscribeContracts).toBeUndefined();
    expect(internalsOnly.subscribeNodeInternals).toBeDefined();
  });

  it("passes empty internals ({}) through onInternals as a degraded observation", async () => {
    // ノードは observable だが syncStages も mempool も観測できなかった縮退の
    // ケース。onInternals は空の NodeInternals を受け取れ、両フィールドが
    // undefined として扱えることを確認する（アダプタが「欠落で落ちない」
    // 縮退動作をした結果が購読口を素通りする）。
    let received: number | undefined;
    const adapter: ChainAdapter = {
      chainType: "ethereum",
      async pollInfra() {
        return {};
      },
      subscribePeers() {
        // no-op
      },
      async subscribeBlocks() {
        // no-op
      },
      async subscribeTransactions() {
        // no-op
      },
      async subscribeNodeInternals({ onInternals }) {
        onInternals("node-1", {});
      },
    };

    await adapter.subscribeNodeInternals?.({
      onInternals: (_nodeId, internals) => {
        received =
          (internals.syncStages?.length ?? 0) +
          (internals.mempool ? 1 : 0);
      },
      onLinkActivity: () => {
        // no-op
      },
    });

    expect(received).toBe(0);
  });
});
