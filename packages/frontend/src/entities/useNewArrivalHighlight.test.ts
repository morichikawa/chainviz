import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NEW_ARRIVAL_HIGHLIGHT_DURATION_MS,
  useNewArrivalHighlight,
} from "./useNewArrivalHighlight.js";

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useNewArrivalHighlight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not highlight ids present once ready becomes true (initial snapshot)", () => {
    const { result } = renderHook(() => useNewArrivalHighlight(["a", "b"], true));
    expect(result.current.size).toBe(0);
  });

  it("does not establish a baseline or highlight anything while ready is false", () => {
    const { result, rerender } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready),
      { initialProps: { ids: [] as string[], ready: false } },
    );
    rerender({ ids: ["a"], ready: false });
    rerender({ ids: ["a", "b"], ready: false });
    expect(result.current.size).toBe(0);
  });

  it(
    "does not highlight the initial snapshot's entities when they arrive a render " +
      "after ready flips true (async connect race, Issue #123 regression)",
    () => {
      // world-state への接続はマウント後に非同期で行われるため、最初の
      // レンダーでは ready=false・entityIds=[] で、次のレンダーで ready=true
      // と同時に初期スナップショットの id が届くことがある。「ready の初回
      // true 呼び出しを基準にする」ことで、この初期表示分は新着扱いに
      // ならないことを確認する。
      const { result, rerender } = renderHook(
        ({ ids, ready }: { ids: string[]; ready: boolean }) =>
          useNewArrivalHighlight(ids, ready),
        { initialProps: { ids: [] as string[], ready: false } },
      );
      expect(result.current.size).toBe(0);

      // ready と同時に初期スナップショット相当の4件が届く（同一レンダー）。
      rerender({
        ids: ["reth-node-1", "reth-node-2", "lighthouse-1", "workbench-alice"],
        ready: true,
      });
      expect(result.current.size).toBe(0);

      // この後に本当に新規追加されたノードだけが新着扱いになる。
      rerender({
        ids: [
          "reth-node-1",
          "reth-node-2",
          "lighthouse-1",
          "workbench-alice",
          "reth-follower-1",
        ],
        ready: true,
      });
      expect(result.current.size).toBe(1);
      expect(result.current.has("reth-follower-1")).toBe(true);
    },
  );

  it("highlights both entities of a reth+beacon pair that arrive in the same render (Issue #123 §4-2)", () => {
    // addNode は reth + beacon の2枚を同時に届ける。同一レンダーで複数の新規 id が
    // 現れても、その全てを新着として強調する（片方だけ拾う取りこぼしが無いこと）。
    const { result, rerender } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready),
      { initialProps: { ids: ["reth-1", "lighthouse-1"], ready: true } },
    );
    expect(result.current.size).toBe(0);

    rerender({
      ids: ["reth-1", "lighthouse-1", "reth-2", "lighthouse-2"],
      ready: true,
    });
    expect(result.current.has("reth-2")).toBe(true);
    expect(result.current.has("lighthouse-2")).toBe(true);
    expect(result.current.size).toBe(2);
  });

  it("clears a simultaneously-arrived pair together after the duration elapses", () => {
    const { result, rerender } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready),
      { initialProps: { ids: ["a"], ready: true } },
    );
    rerender({ ids: ["a", "b", "c"], ready: true });
    expect(result.current.size).toBe(2);

    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS - 1);
    expect(result.current.size).toBe(2);
    advance(1);
    expect(result.current.size).toBe(0);
  });

  it("highlights an id that appears after the ready baseline was established", () => {
    const { result, rerender } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready),
      { initialProps: { ids: ["a"], ready: true } },
    );
    expect(result.current.has("b")).toBe(false);

    rerender({ ids: ["a", "b"], ready: true });
    expect(result.current.has("b")).toBe(true);
    expect(result.current.has("a")).toBe(false);
  });

  it("stops highlighting after the default duration elapses", () => {
    const { result, rerender } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready),
      { initialProps: { ids: [] as string[], ready: true } },
    );
    rerender({ ids: ["a"], ready: true });
    expect(result.current.has("a")).toBe(true);

    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS - 1);
    expect(result.current.has("a")).toBe(true);

    advance(1);
    expect(result.current.has("a")).toBe(false);
  });

  it("times each newly-arrived id independently (staggered arrival)", () => {
    const { result, rerender } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready),
      { initialProps: { ids: [] as string[], ready: true } },
    );
    rerender({ ids: ["a"], ready: true });
    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS / 2);
    rerender({ ids: ["a", "b"], ready: true });

    expect(result.current.has("a")).toBe(true);
    expect(result.current.has("b")).toBe(true);

    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS / 2);
    // a は合計 duration 経過したので消える。b はまだ半分。
    expect(result.current.has("a")).toBe(false);
    expect(result.current.has("b")).toBe(true);

    advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS / 2);
    expect(result.current.has("b")).toBe(false);
  });

  it("respects a custom duration", () => {
    const { result, rerender } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready, 1000),
      { initialProps: { ids: [] as string[], ready: true } },
    );
    rerender({ ids: ["a"], ready: true });
    expect(result.current.has("a")).toBe(true);
    advance(999);
    expect(result.current.has("a")).toBe(true);
    advance(1);
    expect(result.current.has("a")).toBe(false);
  });

  it("keeps an id highlighted even if it disappears before the timeout fires (no crash)", () => {
    const { result, rerender } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready),
      { initialProps: { ids: [] as string[], ready: true } },
    );
    rerender({ ids: ["a"], ready: true });
    expect(result.current.has("a")).toBe(true);

    expect(() => rerender({ ids: [], ready: true })).not.toThrow();
    // 既に立てたタイマーが発火しても、消えた id への no-op として安全に処理される。
    expect(() => advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS)).not.toThrow();
  });

  it("re-highlights an id that disappeared and then reappeared (treated as a fresh arrival)", () => {
    const { result, rerender } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready),
      { initialProps: { ids: ["a"], ready: true } },
    );
    // "a" は基準確立時点で既に存在するため、ここではまだ新着扱いにならない。
    expect(result.current.has("a")).toBe(false);

    rerender({ ids: [], ready: true });
    rerender({ ids: ["a"], ready: true });
    // 一度居なくなってから同じ id で再登場した場合は、既知集合が消えた時点の
    // ものへ置き換わるため、改めて新着として強調される（例: 同名コンテナが
    // 削除後に再作成されたケースを新規到着として扱いたいための挙動）。
    expect(result.current.has("a")).toBe(true);
  });

  it("does not throw and cleans up timers when unmounted while highlights are pending", () => {
    const { rerender, unmount } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready),
      { initialProps: { ids: [] as string[], ready: true } },
    );
    rerender({ ids: ["a"], ready: true });
    expect(() => {
      unmount();
      advance(NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    }).not.toThrow();
  });

  it("returns an empty set for an empty id list", () => {
    const { result } = renderHook(() => useNewArrivalHighlight([], true));
    expect(result.current.size).toBe(0);
  });

  it("resumes normal new-arrival detection once ready flips back to true after a disconnect", () => {
    const { result, rerender } = renderHook(
      ({ ids, ready }: { ids: string[]; ready: boolean }) =>
        useNewArrivalHighlight(ids, ready),
      { initialProps: { ids: ["a"], ready: true } },
    );
    expect(result.current.has("a")).toBe(false);

    // 一時的に切断（ready=false）。既知の基準はそのまま保持される。
    rerender({ ids: ["a"], ready: false });
    rerender({ ids: ["a"], ready: true });
    // 再接続後も同じ "a" は既知のままなので新着扱いにならない。
    expect(result.current.has("a")).toBe(false);

    // 再接続後に本当に新しい id が届けば通常どおり新着扱いになる。
    rerender({ ids: ["a", "b"], ready: true });
    expect(result.current.has("b")).toBe(true);
  });
});
