import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppearanceOrder } from "./useAppearanceOrder.js";

afterEach(cleanup);

describe("useAppearanceOrder", () => {
  it("assigns increasing sequence numbers in input order on the first render", () => {
    const { result } = renderHook(() => useAppearanceOrder(["a", "b", "c"]));
    expect(result.current.get("a")).toBe(0);
    expect(result.current.get("b")).toBe(1);
    expect(result.current.get("c")).toBe(2);
  });

  it("assigns a new, higher sequence number to an id that appears later", () => {
    const { result, rerender } = renderHook(({ ids }) => useAppearanceOrder(ids), {
      initialProps: { ids: ["a", "b"] },
    });
    expect(result.current.get("a")).toBe(0);
    expect(result.current.get("b")).toBe(1);

    rerender({ ids: ["a", "b", "c"] });
    expect(result.current.get("c")).toBe(2);
  });

  it("keeps the order of an id that disappears and never re-adds it retroactively", () => {
    const { result, rerender } = renderHook(({ ids }) => useAppearanceOrder(ids), {
      initialProps: { ids: ["a", "b"] },
    });
    rerender({ ids: ["b"] });
    // "a" のシーケンス番号は内部記録から消えない（実害の無い前提。docstring 参照）。
    expect(result.current.get("a")).toBe(0);
    rerender({ ids: ["a", "b"] });
    // 再び現れても新しい番号は振り直さない。
    expect(result.current.get("a")).toBe(0);
  });

  it("does not renumber ids that have not changed across renders", () => {
    const { result, rerender } = renderHook(({ ids }) => useAppearanceOrder(ids), {
      initialProps: { ids: ["a", "b"] },
    });
    const firstOrder = result.current;
    rerender({ ids: ["a", "b"] });
    // 変化が無ければ同じ Map 参照が返る（呼び出し側の再計算コストを抑える）。
    expect(result.current).toBe(firstOrder);
  });

  it("returns an empty map for an empty id list", () => {
    const { result } = renderHook(() => useAppearanceOrder([]));
    expect(result.current.size).toBe(0);
  });

  it("keeps a strictly increasing order across many appearances (no collisions)", () => {
    const { result, rerender } = renderHook(({ ids }) => useAppearanceOrder(ids), {
      initialProps: { ids: [] as string[] },
    });
    for (let i = 0; i < 20; i += 1) {
      rerender({ ids: [`id-${i}`] });
    }
    const values = Array.from({ length: 20 }, (_, i) => result.current.get(`id-${i}`));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThan(values[i - 1] as number);
    }
  });
});
