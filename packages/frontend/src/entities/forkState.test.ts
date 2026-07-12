import type { BlockEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  buildBlockIndex,
  chainRelation,
  defaultMaxAncestorSteps,
  detectForkGroups,
  highestTipHash,
} from "./forkState.js";

function block(
  hash: string,
  number: number,
  parentHash: string,
): BlockEntity {
  return { kind: "block", hash, number, parentHash, timestamp: 0, receivedAt: {} };
}

describe("defaultMaxAncestorSteps", () => {
  it("returns the block count as-is", () => {
    expect(defaultMaxAncestorSteps(0)).toBe(0);
    expect(defaultMaxAncestorSteps(5)).toBe(5);
  });
});

describe("chainRelation", () => {
  const genesis = block("0x1", 1, "0x0");
  const b2 = block("0x2", 2, "0x1");
  const b3 = block("0x3", 3, "0x2");

  it("returns 'same' for identical hashes", () => {
    const byHash = buildBlockIndex([genesis]);
    expect(chainRelation(genesis, genesis, byHash, 10)).toBe("same");
  });

  it("returns 'same' when the higher tip's ancestor at the lower height matches", () => {
    const byHash = buildBlockIndex([genesis, b2, b3]);
    expect(chainRelation(b3, genesis, byHash, 10)).toBe("same");
    // 順序を入れ替えても対称であること。
    expect(chainRelation(genesis, b3, byHash, 10)).toBe("same");
  });

  it("returns 'fork' for two blocks at the same height with different hashes", () => {
    const forkB2 = block("0x2b", 2, "0x1");
    const byHash = buildBlockIndex([genesis, b2, forkB2]);
    expect(chainRelation(b2, forkB2, byHash, 10)).toBe("fork");
  });

  it("returns 'fork' when walking to the lower height lands on a different hash", () => {
    const forkB2 = block("0x2b", 2, "0x1");
    const forkB3 = block("0x3b", 3, "0x2b");
    const byHash = buildBlockIndex([genesis, b2, b3, forkB2, forkB3]);
    expect(chainRelation(b3, forkB3, byHash, 10)).toBe("fork");
  });

  it("returns 'unknown' when an intermediate block is missing (safe side)", () => {
    // b3 の親(b2)がストアに無いため、genesis の高さまで辿り切れない。
    const byHash = buildBlockIndex([genesis, b3]);
    expect(chainRelation(b3, genesis, byHash, 10)).toBe("unknown");
  });

  it("returns 'unknown' when maxSteps is exceeded before reaching the target height", () => {
    const byHash = buildBlockIndex([genesis, b2, b3]);
    // 高さ3→1へは2ホップ必要だが、上限を1に制限する。
    expect(chainRelation(b3, genesis, byHash, 1)).toBe("unknown");
  });

  it("respects maxSteps=0 (no hops allowed) even for equal-height blocks", () => {
    const byHash = buildBlockIndex([genesis]);
    expect(chainRelation(genesis, genesis, byHash, 0)).toBe("same");
  });
});

describe("detectForkGroups", () => {
  const commonAncestor = block("0x80", 128, "0x7f");
  const branchAMid = block("0xa81", 129, commonAncestor.hash);
  const branchATip = block("0xa82", 130, branchAMid.hash);
  const branchBTip = block("0xb81", 129, commonAncestor.hash);

  it("returns no groups when fewer than 2 nodes have resolvable tips", () => {
    const blocks = [commonAncestor];
    expect(
      detectForkGroups([{ id: "n1", headBlockHash: commonAncestor.hash }], blocks),
    ).toEqual([]);
    expect(detectForkGroups([], blocks)).toEqual([]);
  });

  it("excludes nodes with an empty headBlockHash (unobserved, e.g. validator)", () => {
    const blocks = [commonAncestor, branchATip, branchBTip, branchAMid];
    const groups = detectForkGroups(
      [
        { id: "el-a", headBlockHash: branchATip.hash },
        { id: "el-b", headBlockHash: branchBTip.hash },
        { id: "validator", headBlockHash: "" },
      ],
      blocks,
    );
    const allNodeIds = groups.flatMap((g) => g.nodeIds);
    expect(allNodeIds).not.toContain("validator");
    expect(allNodeIds.sort()).toEqual(["el-a", "el-b"]);
  });

  it("excludes nodes whose headBlockHash cannot be resolved to a known BlockEntity", () => {
    const blocks = [commonAncestor, branchATip];
    const groups = detectForkGroups(
      [
        { id: "el-a", headBlockHash: branchATip.hash },
        { id: "el-unknown", headBlockHash: "0xdeadbeef" },
      ],
      blocks,
    );
    // 有効な tip が1件しか残らないため、フォークなし扱い。
    expect(groups).toEqual([]);
  });

  it("does not flag ordinary propagation lag as a fork (one tip is an ancestor of the other)", () => {
    const blocks = [commonAncestor, branchAMid, branchATip];
    const groups = detectForkGroups(
      [
        { id: "fast", headBlockHash: branchATip.hash },
        { id: "slow", headBlockHash: branchAMid.hash },
        { id: "slower", headBlockHash: commonAncestor.hash },
      ],
      blocks,
    );
    expect(groups).toEqual([]);
  });

  it("detects a genuine fork and groups nodes by branch", () => {
    const blocks = [commonAncestor, branchAMid, branchATip, branchBTip];
    const groups = detectForkGroups(
      [
        { id: "el-a", headBlockHash: branchATip.hash },
        { id: "cl-a", headBlockHash: branchATip.hash },
        { id: "el-b", headBlockHash: branchBTip.hash },
      ],
      blocks,
    );
    expect(groups).toHaveLength(2);
    const byNode = new Map(groups.flatMap((g) => g.nodeIds.map((id) => [id, g.groupKey])));
    expect(byNode.get("el-a")).toBe(byNode.get("cl-a"));
    expect(byNode.get("el-a")).not.toBe(byNode.get("el-b"));
  });

  it("groups a lagging node on branch A with the branch A tip, separate from branch B", () => {
    const blocks = [commonAncestor, branchAMid, branchATip, branchBTip];
    const groups = detectForkGroups(
      [
        { id: "el-a-fast", headBlockHash: branchATip.hash },
        { id: "el-a-slow", headBlockHash: branchAMid.hash },
        { id: "el-b", headBlockHash: branchBTip.hash },
      ],
      blocks,
    );
    expect(groups).toHaveLength(2);
    const byNode = new Map(groups.flatMap((g) => g.nodeIds.map((id) => [id, g.groupKey])));
    expect(byNode.get("el-a-fast")).toBe(byNode.get("el-a-slow"));
    expect(byNode.get("el-a-fast")).not.toBe(byNode.get("el-b"));
  });

  it("does not report a fork when the relation cannot be determined (missing intermediate block)", () => {
    // branchAMid をストアから欠落させ、branchATip → commonAncestor の高さまで
    // 辿り切れないようにする。
    const blocks = [commonAncestor, branchATip, branchBTip];
    const groups = detectForkGroups(
      [
        { id: "el-a", headBlockHash: branchATip.hash },
        { id: "el-b", headBlockHash: branchBTip.hash },
      ],
      blocks,
    );
    expect(groups).toEqual([]);
  });

  it("does not report a fork once all nodes converge on the same tip", () => {
    const blocks = [commonAncestor, branchAMid, branchATip];
    const groups = detectForkGroups(
      [
        { id: "el-a", headBlockHash: branchATip.hash },
        { id: "el-b", headBlockHash: branchATip.hash },
      ],
      blocks,
    );
    expect(groups).toEqual([]);
  });

  it("sorts nodeIds and tipHashes within each group deterministically", () => {
    const blocks = [commonAncestor, branchAMid, branchATip, branchBTip];
    const groups = detectForkGroups(
      [
        { id: "z-node", headBlockHash: branchATip.hash },
        { id: "a-node", headBlockHash: branchATip.hash },
        { id: "el-b", headBlockHash: branchBTip.hash },
      ],
      blocks,
    );
    const branchAGroup = groups.find((g) => g.nodeIds.includes("a-node"));
    expect(branchAGroup?.nodeIds).toEqual(["a-node", "z-node"]);
  });
});

describe("highestTipHash", () => {
  const genesis = block("0x1", 1, "0x0");
  const b2 = block("0x2", 2, "0x1");
  const b3 = block("0x3", 3, "0x2");

  it("returns the hash of the tip with the greatest block number", () => {
    const byHash = buildBlockIndex([genesis, b2, b3]);
    const group = { groupKey: "0x1", nodeIds: ["n1", "n2"], tipHashes: ["0x1", "0x3", "0x2"] };
    expect(highestTipHash(group, byHash)).toBe("0x3");
  });

  it("falls back to the first tip hash when none resolve to a known block", () => {
    const byHash = buildBlockIndex([]);
    const group = { groupKey: "0xabc", nodeIds: ["n1"], tipHashes: ["0xabc"] };
    expect(highestTipHash(group, byHash)).toBe("0xabc");
  });
});
