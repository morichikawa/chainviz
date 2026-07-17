// ChainResetWatcher（Issue #357）の観測列に沿った遷移ケースを検証する。
// chain-reset-watcher.test.ts は「初回はキャッシュ埋めのみ」「変化で onReset」
// 「単発の観測失敗で誤検知しない」といった 1 段の判定を固定しているのに対し、
// こちらは複数 tick にまたがる時系列（欠測を挟んだ復帰・連続リセット・
// コールドスタート時の欠測先行）で誤検知・取りこぼしが起きないことを固定する。
// 「観測失敗をリセットの証拠として扱わない」原則が単発だけでなく列としても
// 守られているかが焦点（依頼の観点 1・4）。

import { describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import { ChainResetWatcher } from "./chain-reset-watcher.js";
import type { EthRpcClient } from "./eth-rpc-client.js";
import { clientFrom, rethFixture } from "./test-helpers/docker-fixtures.js";

/**
 * 現在の `current`（`null` は観測失敗＝ノード到達不能を表す）を返すスタブで
 * watcher を組み立てる。1 ステップ（後述の `step()`）の中で `current` を
 * 固定して進めるため、フェイクタイマーが 1 ステップで複数 tick を回しても
 * 観測値がぶれず、判定回数が安定する（既存 chain-reset-watcher.test.ts と
 * 同じ「値を明示的に切り替えてから 1 ステップ進める」流儀）。
 */
function mutableWatcher(pollIntervalMs = 1000) {
  let current: string | null = null;
  const rpc: EthRpcClient = {
    async call<T>(): Promise<T> {
      if (current === null) throw new Error("node unreachable");
      return { hash: current } as T;
    },
  };
  const poller = new DockerPoller(
    clientFrom([rethFixture("reth1", "172.28.1.1")]),
  );
  const watcher = new ChainResetWatcher(poller, { rpc, pollIntervalMs });

  // subscribe 直後の即時 tick を流す（キャッシュ埋め）。
  async function prime(value: string | null): Promise<void> {
    current = value;
    await vi.advanceTimersByTimeAsync(0);
    await vi.runOnlyPendingTimersAsync();
  }
  // 値を固定してから 1 ポーリング周期ぶん進める。
  async function step(value: string | null): Promise<void> {
    current = value;
    await vi.advanceTimersByTimeAsync(pollIntervalMs);
    await vi.runOnlyPendingTimersAsync();
  }
  return { watcher, prime, step };
}

describe("ChainResetWatcher time-series transitions (Issue #357)", () => {
  it("does not treat a transient RPC outage that recovers to the SAME genesis as a reset (依頼観点1)", async () => {
    vi.useFakeTimers();
    try {
      // A(prime) -> 欠測 -> 欠測 -> A(復帰)。RPC 接続断→復帰で genesis が一瞬
      // 観測できなくなっても、復帰後が同じ A なら down -v ではないので onReset
      // を呼んではならない。
      const { watcher, prime, step } = mutableWatcher();
      const onReset = vi.fn();
      watcher.subscribe(onReset);
      await prime("0xgenesis-a");
      await step(null);
      await step(null);
      await step("0xgenesis-a");

      expect(onReset).not.toHaveBeenCalled();
      expect(watcher.observedGenesisHash).toBe("0xgenesis-a");
      watcher.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still detects a reset when the genesis changes ACROSS an observation gap (取りこぼさない)", async () => {
    vi.useFakeTimers();
    try {
      // A(prime) -> 欠測(down -v 中) -> B(新チェーン up)。欠測を挟んでも復帰後に
      // 別ハッシュを観測できた時点で1回だけ onReset を呼ぶ。
      const { watcher, prime, step } = mutableWatcher();
      const onReset = vi.fn();
      watcher.subscribe(onReset);
      await prime("0xgenesis-a");

      await step(null);
      expect(onReset).not.toHaveBeenCalled();

      await step("0xgenesis-b");
      expect(onReset).toHaveBeenCalledTimes(1);
      expect(watcher.observedGenesisHash).toBe("0xgenesis-b");
      watcher.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires onReset once per distinct genesis change across several consecutive resets (依頼観点4: 短時間に down -v→up を繰り返す)", async () => {
    vi.useFakeTimers();
    try {
      // A(prime) -> B -> C -> C。down -v→up を立て続けに行うと genesis はその都度
      // 変わる。変化のたびに1回ずつ onReset を呼び、変化しない tick では呼ばない。
      const { watcher, prime, step } = mutableWatcher();
      const onReset = vi.fn();
      watcher.subscribe(onReset);
      await prime("0xgenesis-a");

      await step("0xgenesis-b");
      expect(onReset).toHaveBeenCalledTimes(1);
      await step("0xgenesis-c");
      expect(onReset).toHaveBeenCalledTimes(2);
      await step("0xgenesis-c");
      expect(onReset).toHaveBeenCalledTimes(2);
      expect(watcher.observedGenesisHash).toBe("0xgenesis-c");
      watcher.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("primes the cache on the FIRST successful observation even if earlier ticks all failed (cold start while chain is down)", async () => {
    vi.useFakeTimers();
    try {
      // コールドスタート時にまだチェーンが up していない（down -v 済み・up 前）
      // 状況: 最初の数 tick は欠測で、最初に観測できたハッシュはキャッシュ埋め
      // でしかない（比較対象が無いのでリセットではない）。この最初の成功を
      // 誤ってリセット扱いしないことを固定する。
      const { watcher, prime, step } = mutableWatcher();
      const onReset = vi.fn();
      watcher.subscribe(onReset);
      await prime(null);
      expect(watcher.observedGenesisHash).toBeUndefined();

      await step(null);
      expect(watcher.observedGenesisHash).toBeUndefined();

      await step("0xgenesis-a"); // 初めて観測（キャッシュ埋め）
      expect(onReset).not.toHaveBeenCalled();
      expect(watcher.observedGenesisHash).toBe("0xgenesis-a");

      await step("0xgenesis-a"); // 継続
      expect(onReset).not.toHaveBeenCalled();
      watcher.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
