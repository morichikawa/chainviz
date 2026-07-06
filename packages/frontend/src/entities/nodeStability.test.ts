import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { sameByReference, stabilizeNodes } from "./nodeStability.js";

interface TestData extends Record<string, unknown> {
  value: string;
}

type TestNode = Node<TestData, "test">;

function node(id: string, value: string, x = 0, y = 0): TestNode {
  return { id, type: "test", position: { x, y }, data: { value } };
}

/** テスト用の等価判定: data.value の参照と position が一致するか。 */
function isSame(previous: TestNode, next: TestNode): boolean {
  return (
    previous.data.value === next.data.value &&
    previous.position.x === next.position.x &&
    previous.position.y === next.position.y
  );
}

describe("stabilizeNodes", () => {
  it("returns nextNodes unchanged when there is no previous output", () => {
    const next = [node("a", "va")];
    expect(stabilizeNodes(next, [], isSame)).toBe(next);
  });

  it("reuses the previous object reference when content is unchanged", () => {
    const previous = [node("a", "va")];
    const next = [node("a", "va")]; // 新しいオブジェクトだが内容は同じ
    const result = stabilizeNodes(next, previous, isSame);
    expect(result[0]).toBe(previous[0]);
    expect(result[0]).not.toBe(next[0]);
  });

  it("returns the exact previous array reference when nothing changed at all", () => {
    const previous = [node("a", "va"), node("b", "vb")];
    const next = [node("a", "va"), node("b", "vb")];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result).toBe(previous);
  });

  it("keeps a fresh object for nodes whose content changed", () => {
    const previous = [node("a", "va")];
    const next = [node("a", "vb")];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result[0]).toBe(next[0]);
    expect(result[0]).not.toBe(previous[0]);
    expect(result).not.toBe(previous);
  });

  it("keeps a fresh object for nodes whose position changed", () => {
    const previous = [node("a", "va", 0, 0)];
    const next = [node("a", "va", 10, 0)];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result[0]).toBe(next[0]);
  });

  it("mixes reused and fresh objects when only some nodes changed", () => {
    const previous = [node("a", "va"), node("b", "vb")];
    const next = [node("a", "va"), node("b", "vb2")];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result[0]).toBe(previous[0]);
    expect(result[1]).toBe(next[1]);
    // 一部変化したので配列自体は前回と別の参照になる。
    expect(result).not.toBe(previous);
  });

  it("returns fresh objects for newly added nodes not present before", () => {
    const previous = [node("a", "va")];
    const next = [node("a", "va"), node("b", "vb")];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result[0]).toBe(previous[0]);
    expect(result[1]).toBe(next[1]);
  });

  it("does not resurrect nodes removed from the next array", () => {
    const previous = [node("a", "va"), node("b", "vb")];
    const next = [node("a", "va")];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(previous[0]);
  });

  it("treats reordering as a change to the array reference even if all elements are reused", () => {
    const previous = [node("a", "va"), node("b", "vb")];
    const next = [node("b", "vb"), node("a", "va")];
    const result = stabilizeNodes(next, previous, isSame);
    // 各要素は再利用されるが、並び順が変わったため配列自体は新しい参照になる。
    expect(result).not.toBe(previous);
    expect(result[0]).toBe(previous[1]);
    expect(result[1]).toBe(previous[0]);
  });

  it("handles an empty next array", () => {
    const previous = [node("a", "va")];
    expect(stabilizeNodes([], previous, isSame)).toEqual([]);
  });
});

describe("sameByReference", () => {
  it("returns true for two empty arrays", () => {
    expect(sameByReference([], [])).toBe(true);
  });

  it("returns true when every element is the same reference in the same order", () => {
    const a = { x: 1 };
    const b = { x: 2 };
    expect(sameByReference([a, b], [a, b])).toBe(true);
  });

  it("returns false when lengths differ", () => {
    const a = { x: 1 };
    expect(sameByReference([a], [a, a])).toBe(false);
  });

  it("returns false when an element has a different reference despite equal content", () => {
    expect(sameByReference([{ x: 1 }], [{ x: 1 }])).toBe(false);
  });

  it("returns false when order differs", () => {
    const a = { x: 1 };
    const b = { x: 2 };
    expect(sameByReference([a, b], [b, a])).toBe(false);
  });
});
