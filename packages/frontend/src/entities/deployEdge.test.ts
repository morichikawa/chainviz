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

describe("deployEdgesToFlowEdges address casing (Issue #201)", () => {
  it("matches a deployer address that differs in case from the tracked wallet id", () => {
    // deployerAddress はチェーン側の生の表記(小文字)、presentWalletIds は
    // EIP-55 チェックサム表記になりうる想定の再現。
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xc1", deployerAddress: "0xabcdef" })],
      ["0xABCDEF"],
    );
    expect(edges).toHaveLength(1);
    // React Flow がノードを解決できるよう、source/id にはキャンバス上に
    // 実在するウォレットの表記(presentWalletIds側)を使う。
    expect(edges[0]).toMatchObject({
      source: "0xABCDEF",
      target: "0xc1",
      id: "deploy-0xABCDEF-0xc1",
      data: { deployerAddress: "0xABCDEF" },
    });
  });

  it("still rejects a deployer that is not present even case-insensitively", () => {
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xc1", deployerAddress: "0xabcdef" })],
      ["0xdifferent"],
    );
    expect(edges).toEqual([]);
  });

  it("matches when both sides use mixed casing that differs from each other", () => {
    // deployerAddress と presentWalletIds が互いに異なる混在表記でも、
    // どちらも同じ小文字キーに正規化されるので一致する。
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xC1", deployerAddress: "0xAbCdEf" })],
      ["0xaBcDeF"],
    );
    expect(edges).toHaveLength(1);
    // 端点にはキャンバス上に実在する表記（present 側）を採用する。
    expect(edges[0]).toMatchObject({
      source: "0xaBcDeF",
      target: "0xC1",
      id: "deploy-0xaBcDeF-0xC1",
    });
  });

  it("resolves to the last representation when presentWalletIds contains casing duplicates (defensive)", () => {
    // 通常は起きないが、presentWalletIds に同一アドレスの表記揺れが複数
    // 混在した場合、小文字キーの Map は後勝ちになる。エッジは 1 本だけ作られ、
    // 端点には最後に現れた表記が採られる（重複エッジを作らないことの回帰）。
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xc1", deployerAddress: "0xabcdef" })],
      ["0xABCDEF", "0xAbCdEf"],
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "0xAbCdEf",
      id: "deploy-0xAbCdEf-0xc1",
    });
  });
});

describe("deployEdgesToFlowEdges refactoring equivalence (Issue #232)", () => {
  // buildLowerCaseIndex への切り出しで動作が変わっていないことの確認。
  // 索引を1度だけ作って複数コントラクトを回す経路（リファクタで導入）を
  // 通しても、従来と同じ端点解決になることを保証する。
  it("reuses one case-insensitive index across multiple contracts in a single call", () => {
    const edges = deployEdgesToFlowEdges(
      [
        contract({ address: "0xc1", deployerAddress: "0xABCDEF" }),
        contract({ address: "0xc2", deployerAddress: "0xabcdef" }),
      ],
      ["0xAbCdEf"],
    );
    // どちらのコントラクトも同じ present 表記へ解決される。
    expect(edges.map((e) => e.source)).toEqual(["0xAbCdEf", "0xAbCdEf"]);
    expect(edges.map((e) => e.target)).toEqual(["0xc1", "0xc2"]);
  });

  it("preserves input contract order in the output edges", () => {
    const edges = deployEdgesToFlowEdges(
      [
        contract({ address: "0xc3", deployerAddress: "0xw1" }),
        contract({ address: "0xc1", deployerAddress: "0xw1" }),
        contract({ address: "0xc2", deployerAddress: "0xw1" }),
      ],
      ["0xw1"],
    );
    expect(edges.map((e) => e.target)).toEqual(["0xc3", "0xc1", "0xc2"]);
  });

  it("normalizes only the deployer (source); the contract target keeps its raw casing", () => {
    // present はウォレットの集合であり、コントラクト address はそこと照合
    // しない。target は入力の contract.address をそのまま使う（source だけが
    // present 側の表記へ解決される非対称性の回帰）。
    const edges = deployEdgesToFlowEdges(
      [contract({ address: "0xMixedCaseContract", deployerAddress: "0xabcdef" })],
      ["0xABCDEF"],
    );
    expect(edges[0]).toMatchObject({
      source: "0xABCDEF",
      target: "0xMixedCaseContract",
      id: "deploy-0xABCDEF-0xMixedCaseContract",
    });
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
