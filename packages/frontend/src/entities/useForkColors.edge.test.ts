import type { BlockEntity } from "@chainviz/shared";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FORK_COLOR_PALETTE_SIZE, useForkColorAssignment } from "./useForkColors.js";

/**
 * 色割り当てフック（`useForkColors.ts`、Issue #296）のエッジケース。
 * 基本的な安定性・収束は `useForkColors.test.ts` にあるため、こちらは以下に
 * 絞る（CLAUDE.md「1ファイル1責務」をテストファイルにも適用）:
 * - 色プール（0〜3 の 4 色）を使い切ったときの巡回割り当て
 * - 一部の枝だけが収束したとき、リセットが早期発火せず残りの色が保たれること
 * - 3 分岐以上での色分け
 * - 未観測（headBlockHash 空）ノードが色付けの対象にならないこと
 */

afterEach(cleanup);

function block(hash: string, number: number, parentHash: string): BlockEntity {
  return { kind: "block", hash, number, parentHash, timestamp: 0, receivedAt: {} };
}

type Node = { id: string; headBlockHash: string };

describe("useForkColorAssignment palette exhaustion", () => {
  it("wraps to a reused color once more than FORK_COLOR_PALETTE_SIZE branches fork", () => {
    // 4 色を超える 5 分岐。5 番目は未使用色が無いため巡回して 0 を再利用する。
    const c0 = block("0x100", 100, "0x0ff");
    const tips = [0, 1, 2, 3, 4].map((i) =>
      block(`0xf${i}`, 101, c0.hash),
    );
    const blocks = [c0, ...tips];
    const nodes: Node[] = tips.map((t, i) => ({
      id: `n${i}`,
      headBlockHash: t.hash,
    }));

    const { result } = renderHook(() => useForkColorAssignment(nodes, blocks));
    const map = result.current.colorIndexByNodeId;

    expect(map.size).toBe(5);
    // 全ての色 index はパレット範囲（0〜3）に収まる。
    for (const color of map.values()) {
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThan(FORK_COLOR_PALETTE_SIZE);
    }
    // グループは groupKey（tip ハッシュ）昇順に処理され、未使用の最小色から
    // 割り当てられるため 0,1,2,3、5 番目は巡回して 0 になる。
    const assigned = ["n0", "n1", "n2", "n3", "n4"].map((id) => map.get(id));
    expect(assigned).toEqual([0, 1, 2, 3, 0]);
    // 4 色すべてが使われ、1 色（0）だけが重複する。
    expect(new Set(assigned)).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe("useForkColorAssignment partial convergence", () => {
  it("does not reset colors when only one of three branches converges", () => {
    const c0 = block("0x100", 100, "0x0ff");
    const a1 = block("0xa101", 101, c0.hash);
    const b1 = block("0xb101", 101, c0.hash);
    const d1 = block("0xd101", 101, c0.hash);
    const blocks = [c0, a1, b1, d1];

    const { result, rerender } = renderHook(
      ({ nodes, blocks: bs }: { nodes: Node[]; blocks: BlockEntity[] }) =>
        useForkColorAssignment(nodes, bs),
      {
        initialProps: {
          nodes: [
            { id: "el-a", headBlockHash: a1.hash },
            { id: "el-b", headBlockHash: b1.hash },
            { id: "el-d", headBlockHash: d1.hash },
          ],
          blocks,
        },
      },
    );

    expect(result.current.colorIndexByNodeId.size).toBe(3);
    const colorA = result.current.colorIndexByNodeId.get("el-a");
    const colorB = result.current.colorIndexByNodeId.get("el-b");
    expect(colorA).not.toBeUndefined();
    expect(colorB).not.toBeUndefined();

    // el-d が branch A の tip へ収束（reorg）。branch A と B はまだ分岐中なので
    // 全収束ではない。リセットは発火せず、A/B の色は保たれるべき。
    rerender({
      nodes: [
        { id: "el-a", headBlockHash: a1.hash },
        { id: "el-b", headBlockHash: b1.hash },
        { id: "el-d", headBlockHash: a1.hash },
      ],
      blocks,
    });

    // まだフォークが残るのでリセットされていない（size は 0 でない）。
    expect(result.current.colorIndexByNodeId.size).toBe(3);
    // A と B の色は安定して引き継がれる。
    expect(result.current.colorIndexByNodeId.get("el-a")).toBe(colorA);
    expect(result.current.colorIndexByNodeId.get("el-b")).toBe(colorB);
    // 収束した el-d は branch A と同じ色に合流する。
    expect(result.current.colorIndexByNodeId.get("el-d")).toBe(colorA);
  });
});

describe("useForkColorAssignment three-way fork", () => {
  it("assigns three distinct colors to three diverging branches", () => {
    const c0 = block("0x100", 100, "0x0ff");
    const a1 = block("0xa101", 101, c0.hash);
    const b1 = block("0xb101", 101, c0.hash);
    const d1 = block("0xd101", 101, c0.hash);
    const blocks = [c0, a1, b1, d1];

    const { result } = renderHook(() =>
      useForkColorAssignment(
        [
          { id: "el-a", headBlockHash: a1.hash },
          { id: "el-b", headBlockHash: b1.hash },
          { id: "el-d", headBlockHash: d1.hash },
        ],
        blocks,
      ),
    );
    const map = result.current.colorIndexByNodeId;
    expect(map.size).toBe(3);
    const colors = new Set(map.values());
    expect(colors.size).toBe(3);
  });
});

describe("useForkColorAssignment excludes unobserved nodes", () => {
  it("never colors a validator with an empty headBlockHash", () => {
    const c0 = block("0x100", 100, "0x0ff");
    const a1 = block("0xa101", 101, c0.hash);
    const b1 = block("0xb101", 101, c0.hash);
    const blocks = [c0, a1, b1];

    const { result } = renderHook(() =>
      useForkColorAssignment(
        [
          { id: "el-a", headBlockHash: a1.hash },
          { id: "el-b", headBlockHash: b1.hash },
          { id: "validator-1", headBlockHash: "" },
        ],
        blocks,
      ),
    );
    const map = result.current.colorIndexByNodeId;
    expect(map.has("validator-1")).toBe(false);
    // フォーク中の 2 ノードには色が付く（validator だけが除外される）。
    expect(map.has("el-a")).toBe(true);
    expect(map.has("el-b")).toBe(true);
  });
});
