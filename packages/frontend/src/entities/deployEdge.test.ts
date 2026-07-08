import type { ContractEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  DEPLOY_EDGE_TYPE,
  deployEdgesToFlowEdges,
  isDeployFlowEdge,
} from "./deployEdge.js";

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: "0xc0ntract",
    chainType: "ethereum",
    ...overrides,
  };
}

describe("deployEdgesToFlowEdges", () => {
  it("creates a wallet → contract edge when the deployer is present", () => {
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xc1", deployerAddress: "0xw1" })],
      ["0xw1"],
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: DEPLOY_EDGE_TYPE,
      source: "0xw1",
      target: "0xc1",
      data: { deployerAddress: "0xw1" },
    });
  });

  it("skips contracts whose deployer was not observed (deployerAddress omitted)", () => {
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xc1" })],
      ["0xw1"],
    );
    expect(edges).toEqual([]);
  });

  it("skips edges whose deployer wallet is not currently on the canvas (dangling guard)", () => {
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xc1", deployerAddress: "0xgone" })],
      ["0xw1"],
    );
    expect(edges).toEqual([]);
  });

  it("supports one wallet deploying multiple contracts", () => {
    const edges = deployEdgesToFlowEdges(
      [
        contract({ address: "0xc1", deployerAddress: "0xw1" }),
        contract({ address: "0xc2", deployerAddress: "0xw1" }),
      ],
      ["0xw1"],
    );
    expect(edges.map((e) => e.target).sort()).toEqual(["0xc1", "0xc2"]);
    expect(edges.every((e) => e.source === "0xw1")).toBe(true);
  });

  it("gives each edge a stable unique id", () => {
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xc1", deployerAddress: "0xw1" })],
      new Set(["0xw1"]),
    );
    expect(edges[0].id).toBe("deploy-0xw1-0xc1");
  });

  it("accepts a plain iterable (not just a Set) for presentWalletIds", () => {
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xc1", deployerAddress: "0xw1" })],
      ["0xw1", "0xw2"],
    );
    expect(edges).toHaveLength(1);
  });

  it("returns an empty array when there are no contracts", () => {
    expect(deployEdgesToFlowEdges([], ["0xw1"])).toEqual([]);
  });

  it("returns an empty array when no wallets are present (empty iterable)", () => {
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xc1", deployerAddress: "0xw1" })],
      [],
    );
    expect(edges).toEqual([]);
  });

  it("skips a contract whose deployerAddress is an empty string (falsy guard boundary)", () => {
    // deployerAddress: "" は「観測できなかった」と同じ扱い（!deployer で弾く）。
    // 空文字を present 集合に入れても端点にしない。
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xc1", deployerAddress: "" })],
      [""],
    );
    expect(edges).toEqual([]);
  });

  it("keeps only the edges whose deployer is present in a mixed batch", () => {
    const edges = deployEdgesToFlowEdges(
      [
        contract({ address: "0xc1", deployerAddress: "0xw1" }),
        contract({ address: "0xc2", deployerAddress: "0xgone" }),
        contract({ address: "0xc3" }),
      ],
      ["0xw1"],
    );
    expect(edges.map((e) => e.target)).toEqual(["0xc1"]);
  });

  it("gives distinct ids when two wallets each deploy a same-addressed contract (id keyed by deployer+target)", () => {
    // 型上は同一 address の ContractEntity が別 deployer を持つ状態が作れる
    // （通常は起きない）。id は deploy-<deployer>-<target> なので衝突しない。
    const edges = deployEdgesToFlowEdges(
      [
        contract({ address: "0xc1", deployerAddress: "0xw1" }),
        contract({ address: "0xc1", deployerAddress: "0xw2" }),
      ],
      ["0xw1", "0xw2"],
    );
    const ids = edges.map((e) => e.id);
    expect(ids).toEqual(["deploy-0xw1-0xc1", "deploy-0xw2-0xc1"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("isDeployFlowEdge", () => {
  it("narrows deploy edges", () => {
    const [edge] = deployEdgesToFlowEdges(
      [contract({ address: "0xc1", deployerAddress: "0xw1" })],
      ["0xw1"],
    );
    expect(isDeployFlowEdge(edge)).toBe(true);
  });

  it("rejects other edge types", () => {
    expect(
      isDeployFlowEdge({ id: "e1", source: "a", target: "b", type: "peer" }),
    ).toBe(false);
  });
});
