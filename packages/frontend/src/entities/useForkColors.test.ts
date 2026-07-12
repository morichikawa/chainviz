import type { BlockEntity } from "@chainviz/shared";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useForkColorAssignment } from "./useForkColors.js";

afterEach(cleanup);

function block(
  hash: string,
  number: number,
  parentHash: string,
): BlockEntity {
  return { kind: "block", hash, number, parentHash, timestamp: 0, receivedAt: {} };
}

const commonAncestor = block("0x80", 128, "0x7f");
const branchAMid = block("0xa81", 129, commonAncestor.hash);
const branchATip = block("0xa82", 130, branchAMid.hash);
const branchBTip = block("0xb81", 129, commonAncestor.hash);
const branchATip2 = block("0xa83", 131, branchATip.hash);
const branchBTip2 = block("0xb82", 130, branchBTip.hash);

describe("useForkColorAssignment", () => {
  it("returns an empty assignment when there is no fork", () => {
    const { result } = renderHook(() =>
      useForkColorAssignment(
        [{ id: "el-a", headBlockHash: branchATip.hash }],
        [commonAncestor, branchAMid, branchATip],
      ),
    );
    expect(result.current.colorIndexByNodeId.size).toBe(0);
  });

  it("assigns different color indices to each branch during a fork", () => {
    const { result } = renderHook(() =>
      useForkColorAssignment(
        [
          { id: "el-a", headBlockHash: branchATip.hash },
          { id: "el-b", headBlockHash: branchBTip.hash },
        ],
        [commonAncestor, branchAMid, branchATip, branchBTip],
      ),
    );
    const colorA = result.current.colorIndexByNodeId.get("el-a");
    const colorB = result.current.colorIndexByNodeId.get("el-b");
    expect(colorA).not.toBeUndefined();
    expect(colorB).not.toBeUndefined();
    expect(colorA).not.toBe(colorB);
  });

  it("keeps the same color for a branch across renders as its tip advances (stability)", () => {
    const { result, rerender } = renderHook(
      ({ nodes, blocks }: { nodes: { id: string; headBlockHash: string }[]; blocks: BlockEntity[] }) =>
        useForkColorAssignment(nodes, blocks),
      {
        initialProps: {
          nodes: [
            { id: "el-a", headBlockHash: branchATip.hash },
            { id: "el-b", headBlockHash: branchBTip.hash },
          ],
          blocks: [commonAncestor, branchAMid, branchATip, branchBTip],
        },
      },
    );
    const firstColorA = result.current.colorIndexByNodeId.get("el-a");
    const firstColorB = result.current.colorIndexByNodeId.get("el-b");

    // branch A が1ブロック進む（同じチェーン上の延長）。
    rerender({
      nodes: [
        { id: "el-a", headBlockHash: branchATip2.hash },
        { id: "el-b", headBlockHash: branchBTip.hash },
      ],
      blocks: [commonAncestor, branchAMid, branchATip, branchATip2, branchBTip],
    });

    expect(result.current.colorIndexByNodeId.get("el-a")).toBe(firstColorA);
    expect(result.current.colorIndexByNodeId.get("el-b")).toBe(firstColorB);
  });

  it("clears the assignment once all tips converge, and starts fresh on the next fork", () => {
    const { result, rerender } = renderHook(
      ({ nodes, blocks }: { nodes: { id: string; headBlockHash: string }[]; blocks: BlockEntity[] }) =>
        useForkColorAssignment(nodes, blocks),
      {
        initialProps: {
          nodes: [
            { id: "el-a", headBlockHash: branchATip.hash },
            { id: "el-b", headBlockHash: branchBTip.hash },
          ],
          blocks: [commonAncestor, branchAMid, branchATip, branchBTip],
        },
      },
    );
    expect(result.current.colorIndexByNodeId.size).toBe(2);

    // el-b が branch A の tip へ収束（reorg）。
    rerender({
      nodes: [
        { id: "el-a", headBlockHash: branchATip.hash },
        { id: "el-b", headBlockHash: branchATip.hash },
      ],
      blocks: [commonAncestor, branchAMid, branchATip, branchBTip],
    });
    expect(result.current.colorIndexByNodeId.size).toBe(0);

    // 新しいフォークが起きたとき、内部状態がリセットされていて
    // 新規割り当てから始まること（前回のフォークの色に影響されない）を
    // 少なくとも「距離のある2色」が割り当てられることで確認する。
    rerender({
      nodes: [
        { id: "el-a", headBlockHash: branchATip2.hash },
        { id: "el-b", headBlockHash: branchBTip2.hash },
      ],
      blocks: [
        commonAncestor,
        branchAMid,
        branchATip,
        branchATip2,
        branchBTip,
        branchBTip2,
      ],
    });
    const colorA = result.current.colorIndexByNodeId.get("el-a");
    const colorB = result.current.colorIndexByNodeId.get("el-b");
    expect(colorA).not.toBeUndefined();
    expect(colorB).not.toBeUndefined();
    expect(colorA).not.toBe(colorB);
  });

  it("assigns the same color to multiple nodes on the same branch", () => {
    const { result } = renderHook(() =>
      useForkColorAssignment(
        [
          { id: "el-a", headBlockHash: branchATip.hash },
          { id: "cl-a", headBlockHash: branchATip.hash },
          { id: "el-b", headBlockHash: branchBTip.hash },
        ],
        [commonAncestor, branchAMid, branchATip, branchBTip],
      ),
    );
    expect(result.current.colorIndexByNodeId.get("el-a")).toBe(
      result.current.colorIndexByNodeId.get("cl-a"),
    );
  });
});
