import type { ContractEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  contractsToFlowNodes,
  isSameContractNode,
} from "./contractNode.js";

/**
 * `ContractNodeData.walletAddresses`（Issue #315。「発行済み NFT」節の
 * 所有者ラベル解決に使う）の配線を確認する。`activity`/`layout` 等の
 * 既存の項目は `contractNode.test.ts` が担当するため、この観点だけを
 * 分離する（1ファイル1責務）。
 */
function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: "0xabc",
    chainType: "ethereum",
    ...overrides,
  };
}

describe("contractsToFlowNodes walletAddresses (Issue #315)", () => {
  it("defaults to an empty Set when ctx.walletAddresses is omitted", () => {
    const [node] = contractsToFlowNodes([contract()], { layout: {} });
    expect(node.data.walletAddresses).toEqual(new Set());
  });

  it("carries ctx.walletAddresses through to every node's data", () => {
    const walletAddresses = new Set(["0xalice", "0xbob"]);
    const nodes = contractsToFlowNodes(
      [contract({ address: "0xa" }), contract({ address: "0xb" })],
      { layout: {}, walletAddresses },
    );
    expect(nodes[0].data.walletAddresses).toBe(walletAddresses);
    expect(nodes[1].data.walletAddresses).toBe(walletAddresses);
  });
});

describe("isSameContractNode walletAddresses comparison (Issue #315)", () => {
  it("returns true when walletAddresses is the same reference", () => {
    const walletAddresses = new Set(["0xalice"]);
    const entity = contract();
    const previous = contractsToFlowNodes([entity], {
      layout: {},
      walletAddresses,
    })[0];
    const next = contractsToFlowNodes([entity], {
      layout: {},
      walletAddresses,
    })[0];
    expect(isSameContractNode(previous, next)).toBe(true);
  });

  it("returns false when walletAddresses reference changed (even with identical contents)", () => {
    const entity = contract();
    const previous = contractsToFlowNodes([entity], {
      layout: {},
      walletAddresses: new Set(["0xalice"]),
    })[0];
    const next = contractsToFlowNodes([entity], {
      layout: {},
      walletAddresses: new Set(["0xalice"]),
    })[0];
    expect(isSameContractNode(previous, next)).toBe(false);
  });
});
