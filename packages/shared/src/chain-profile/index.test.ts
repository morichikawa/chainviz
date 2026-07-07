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
});
