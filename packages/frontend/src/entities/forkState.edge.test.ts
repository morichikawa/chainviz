import type { BlockEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { chainRelation, buildBlockIndex, detectForkGroups } from "./forkState.js";

/**
 * フォーク検知（`forkState.ts`、Issue #296）のエッジケース・境界値・
 * 設計上のトレードオフを固定するテスト。基本的なハッピーパスは
 * `forkState.test.ts` にあるため、こちらは以下の観点に絞る
 * （CLAUDE.md「1ファイル1責務」をテストファイルにも適用）:
 * - 祖先探索の打ち切り上限（maxSteps）ちょうどの境界
 * - 保持ブロック数から導出される既定 maxSteps が本物の深いフォークを
 *   誤って打ち切らないこと
 * - Union-Find が unknown ペアを安全側で併合することによる過小検出
 *   トレードオフ（設計メモに明記された既知の挙動）
 * - 3 分岐以上のフォーク
 */

function block(hash: string, number: number, parentHash: string): BlockEntity {
  return { kind: "block", hash, number, parentHash, timestamp: 0, receivedAt: {} };
}

describe("chainRelation maxSteps boundary", () => {
  const genesis = block("0x1", 1, "0x0");
  const b2 = block("0x2", 2, "0x1");
  const b3 = block("0x3", 3, "0x2");
  const byHash = buildBlockIndex([genesis, b2, b3]);

  it("resolves 'same' when maxSteps exactly equals the hops needed (boundary)", () => {
    // 高さ3→1 へは 2 ホップ必要。上限をちょうど 2 に設定すると辿り切れる。
    expect(chainRelation(b3, genesis, byHash, 2)).toBe("same");
  });

  it("returns 'unknown' when maxSteps is one short of the hops needed (boundary)", () => {
    // 上限を 1 に減らすと、目的の高さへ到達する前に打ち切られる。
    expect(chainRelation(b3, genesis, byHash, 1)).toBe("unknown");
  });

  it("resolves 'fork' at the exact boundary when the ancestor differs", () => {
    // 分岐先も同じホップ数で辿れる境界で、辿った先が異なれば fork と確定する
    // （maxSteps がちょうど足りるときに unknown へ倒れないことの確認）。
    const forkB2 = block("0x2b", 2, "0x1");
    const forkB3 = block("0x3b", 3, "0x2b");
    const forkByHash = buildBlockIndex([genesis, b2, b3, forkB2, forkB3]);
    expect(chainRelation(b3, forkB3, forkByHash, 2)).toBe("fork");
  });

  it("returns 'unknown' when the immediate parent is missing (zero hops resolvable)", () => {
    // 高い方の tip の親がそもそもストアに無く、1 ホップも辿れないケース。
    const onlyTip = buildBlockIndex([genesis, b3]);
    expect(chainRelation(b3, genesis, onlyTip, 10)).toBe("unknown");
  });
});

describe("detectForkGroups default maxSteps derivation", () => {
  it("still detects a genuinely deep fork when all intermediate blocks are present", () => {
    // 既定の maxSteps はフロントが保持するブロック数（blocks.length）から
    // 導出される。全ブロックが揃っていれば必要ホップ数は必ず保持数以下に
    // なるため、深いフォークでも打ち切られてはならないことの回帰ガード。
    const c0 = block("0x100", 100, "0x0ff");
    const a101 = block("0xa101", 101, c0.hash);
    const a102 = block("0xa102", 102, a101.hash);
    const a103 = block("0xa103", 103, a102.hash);
    const a104 = block("0xa104", 104, a103.hash);
    const a105 = block("0xa105", 105, a104.hash);
    const a106 = block("0xa106", 106, a105.hash);
    const b101 = block("0xb101", 101, c0.hash);
    const blocks = [c0, a101, a102, a103, a104, a105, a106, b101];

    const groups = detectForkGroups(
      [
        { id: "el-a", headBlockHash: a106.hash },
        { id: "el-b", headBlockHash: b101.hash },
      ],
      blocks,
    );
    expect(groups).toHaveLength(2);
  });
});

describe("detectForkGroups three-way fork", () => {
  it("reports three separate groups when three branches diverge from a common ancestor", () => {
    const c0 = block("0x100", 100, "0x0ff");
    const a1 = block("0xa101", 101, c0.hash);
    const b1 = block("0xb101", 101, c0.hash);
    const d1 = block("0xd101", 101, c0.hash);
    const blocks = [c0, a1, b1, d1];

    const groups = detectForkGroups(
      [
        { id: "el-a", headBlockHash: a1.hash },
        { id: "el-b", headBlockHash: b1.hash },
        { id: "el-d", headBlockHash: d1.hash },
      ],
      blocks,
    );
    expect(groups).toHaveLength(3);
    // 3 グループの代表キーが全て異なる（取り違え無し）。
    const keys = new Set(groups.map((g) => g.groupKey));
    expect(keys.size).toBe(3);
  });

  it("keeps a lagging node with its own branch across three branches", () => {
    const c0 = block("0x100", 100, "0x0ff");
    const a1 = block("0xa101", 101, c0.hash);
    const a2 = block("0xa102", 102, a1.hash);
    const b1 = block("0xb101", 101, c0.hash);
    const d1 = block("0xd101", 101, c0.hash);
    const blocks = [c0, a1, a2, b1, d1];

    const groups = detectForkGroups(
      [
        { id: "el-a-fast", headBlockHash: a2.hash },
        { id: "el-a-slow", headBlockHash: a1.hash },
        { id: "el-b", headBlockHash: b1.hash },
        { id: "el-d", headBlockHash: d1.hash },
      ],
      blocks,
    );
    expect(groups).toHaveLength(3);
    const byNode = new Map(
      groups.flatMap((g) => g.nodeIds.map((id) => [id, g.groupKey])),
    );
    // branch A の fast/slow は同じチェーン上なので同一グループ。
    expect(byNode.get("el-a-fast")).toBe(byNode.get("el-a-slow"));
    expect(byNode.get("el-a-fast")).not.toBe(byNode.get("el-b"));
    expect(byNode.get("el-a-fast")).not.toBe(byNode.get("el-d"));
    expect(byNode.get("el-b")).not.toBe(byNode.get("el-d"));
  });
});

describe("detectForkGroups Union-Find under-detection tradeoff", () => {
  // 設計メモ（ARCHITECTURE.md §9.2）に明記された既知のトレードオフ:
  // unknown ペアを安全側で併合するため、判定不能な tip が本物のフォークの
  // 2 枝それぞれと unknown 関係になると、その 2 枝が同一グループへ吸収され、
  // 本物のフォークが見逃される（過小検出）。過大検出（誤って色を付ける）
  // より学習上の害が小さいという方針に基づく意図的な挙動。ここではその
  // 挙動が実際にその通りであることを characterization test として固定する。
  const c0 = block("0x100", 100, "0x0ff");
  const a1 = block("0xa101", 101, c0.hash);
  const b1 = block("0xb101", 101, c0.hash);
  // 親（0xc104）がストアに無いため、どの tip とも高さを揃えて比較できず unknown。
  const orphanTip = block("0xc105", 105, "0xc104");

  it("detects the genuine fork between branch A and B on their own (baseline)", () => {
    const blocks = [c0, a1, b1];
    const groups = detectForkGroups(
      [
        { id: "el-a", headBlockHash: a1.hash },
        { id: "el-b", headBlockHash: b1.hash },
      ],
      blocks,
    );
    expect(groups).toHaveLength(2);
  });

  it("absorbs the genuine A/B fork into one group when an unknown tip bridges them", () => {
    const blocks = [c0, a1, b1, orphanTip];
    const groups = detectForkGroups(
      [
        { id: "el-a", headBlockHash: a1.hash },
        { id: "el-b", headBlockHash: b1.hash },
        { id: "el-orphan", headBlockHash: orphanTip.hash },
      ],
      blocks,
    );
    // A vs orphan = unknown, B vs orphan = unknown → 両者が orphan 経由で
    // 併合され、A vs B の本物のフォークが 1 グループへ吸収される（過小検出）。
    expect(groups).toEqual([]);
  });
});
