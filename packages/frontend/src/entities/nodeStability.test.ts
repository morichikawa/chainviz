import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  sameByReference,
  stabilizeArrayReference,
  stabilizeNodes,
} from "./nodeStability.js";

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

  it("handles add, remove, and update all happening in the same tick", () => {
    // previous: a, b, c → next: a(同じ), b(変更), d(新規)。c は削除。
    const previous = [node("a", "va"), node("b", "vb"), node("c", "vc")];
    const next = [node("a", "va"), node("b", "vb-changed"), node("d", "vd")];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(previous[0]); // 変わっていない a は再利用
    expect(result[1]).toBe(next[1]); // 変更された b は新しい参照
    expect(result[2]).toBe(next[2]); // 新規 d は新しい参照
    expect(result.map((n) => n.id)).toEqual(["a", "b", "d"]);
    // 集合が変わったので配列自体は前回と別参照。
    expect(result).not.toBe(previous);
  });

  it("does not return the previous array when an id was swapped even though the length is equal", () => {
    // 長さは同じ(2件)だが b→c の入れ替えが起きているケース。identical フラグが
    // 長さだけで早合点して previous を返してしまわないことの確認。
    const previous = [node("a", "va"), node("b", "vb")];
    const next = [node("a", "va"), node("c", "vc")];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result).not.toBe(previous);
    expect(result[0]).toBe(previous[0]);
    expect(result[1]).toBe(next[1]);
    expect(result.map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("returns a fresh object when a node changes even if positioned in the middle of a longer array", () => {
    const previous = [node("a", "va"), node("b", "vb")];
    const next = [node("a", "va"), node("b", "vb-changed"), node("c", "vc")];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result[0]).toBe(previous[0]);
    expect(result[1]).toBe(next[1]);
    expect(result[2]).toBe(next[2]);
  });

  it("reuses the previous reference for an unchanged node that moved to a new array index", () => {
    // b は内容不変だが index が 1→0 に動く。参照は再利用しつつ、並びが
    // 変わったので配列は新参照になる(古い並びを誤って使い回さない)。
    const previous = [node("a", "va"), node("b", "vb")];
    const next = [node("b", "vb"), node("a", "va")];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result[0]).toBe(previous[1]);
    expect(result[1]).toBe(previous[0]);
    expect(result).not.toBe(previous);
  });

  it("returns a fresh array (not previous) when the only change is a removal", () => {
    // 長さが減るケース。identical は長さ比較で false になる。
    const previous = [node("a", "va"), node("b", "vb")];
    const next = [node("a", "va")];
    const result = stabilizeNodes(next, previous, isSame);
    expect(result).not.toBe(previous);
    expect(result[0]).toBe(previous[0]);
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

describe("stabilizeArrayReference", () => {
  // Issue #166 差し戻し対応: App.tsx の `contracts`
  // (`entities.filter(isContractEntity)`) は state 更新のたびに新しい配列を
  // 作るため、要素の中身(参照)が全く変わっていなくても愚直に使うと下流の
  // useMemo(`contractsByAddress`)まで毎回作り直されてしまう。この関数は
  // その無駄な参照の入れ替わりを止める。

  it("returns the exact previous reference when every element matches by reference", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const previous = [a, b];
    const next = [a, b]; // 別配列だが要素は同じ参照
    const result = stabilizeArrayReference(next, previous);
    expect(result).toBe(previous);
    expect(result).not.toBe(next);
  });

  it("returns the previous reference for two independently constructed empty arrays", () => {
    // 空配列同士(sameByReference は長さ0同士を true とみなす)。
    const previous: unknown[] = [];
    const next: unknown[] = [];
    expect(stabilizeArrayReference(next, previous)).toBe(previous);
  });

  it("returns next when an element was replaced with a different reference (same length)", () => {
    const a = { id: "a" };
    const bOld = { id: "b" };
    const bNew = { id: "b" }; // 中身が同じでも別オブジェクト
    const previous = [a, bOld];
    const next = [a, bNew];
    const result = stabilizeArrayReference(next, previous);
    expect(result).toBe(next);
    expect(result).not.toBe(previous);
  });

  it("returns next when an element was added (length grew)", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const previous = [a];
    const next = [a, b];
    const result = stabilizeArrayReference(next, previous);
    expect(result).toBe(next);
  });

  it("returns next when an element was removed (length shrank)", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const previous = [a, b];
    const next = [a];
    const result = stabilizeArrayReference(next, previous);
    expect(result).toBe(next);
  });

  it("returns next when there is no previous output yet (first call)", () => {
    const a = { id: "a" };
    const next = [a];
    const result = stabilizeArrayReference(next, []);
    expect(result).toBe(next);
  });
});
