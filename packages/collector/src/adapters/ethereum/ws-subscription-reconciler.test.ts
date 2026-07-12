// WsSubscriptionReconciler 単体のテスト（Issue #301）。実 WebSocket は使わず、
// フェイクの Subscription（open が呼ばれた回数・close が呼ばれたか）だけを
// 検証する。EthereumAdapter.subscribeBlocks 経由の結合的な確認は
// peer-block-adapter.test.ts 側で行う（1 ファイル 1 責務）。

import { describe, expect, it, vi } from "vitest";
import type { Subscription } from "./eth-ws-client.js";
import { WsSubscriptionReconciler } from "./ws-subscription-reconciler.js";

interface FakeTarget {
  id: string;
  signature: string;
}

/** close() が呼ばれたかを記録できるフェイク Subscription を作る。 */
function fakeSubscription(): { subscription: Subscription; closed: boolean[] } {
  const closed: boolean[] = [];
  return {
    subscription: { close: () => closed.push(true) },
    closed,
  };
}

function makeReconciler(): {
  reconciler: WsSubscriptionReconciler<FakeTarget>;
  open: ReturnType<typeof vi.fn>;
  subs: Map<string, { subscription: Subscription; closed: boolean[] }>;
} {
  const subs = new Map<string, { subscription: Subscription; closed: boolean[] }>();
  const open = vi.fn((target: FakeTarget) => {
    const fake = fakeSubscription();
    subs.set(target.id, fake);
    return fake.subscription;
  });
  const reconciler = new WsSubscriptionReconciler<FakeTarget>({
    keyOf: (t) => t.id,
    signatureOf: (t) => t.signature,
    open,
  });
  return { reconciler, open, subs };
}

describe("WsSubscriptionReconciler", () => {
  it("opens a subscription for a newly seen target", () => {
    const { reconciler, open } = makeReconciler();

    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);

    expect(open).toHaveBeenCalledTimes(1);
    expect(reconciler.size).toBe(1);
  });

  it("does not open a second subscription for an already-registered key with an unchanged signature (addNode / no-op tick)", () => {
    const { reconciler, open } = makeReconciler();

    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);
    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);
    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);

    expect(open).toHaveBeenCalledTimes(1);
    expect(reconciler.size).toBe(1);
  });

  it("opens a subscription for a node that newly appears alongside an already-tracked one (addNode)", () => {
    const { reconciler, open } = makeReconciler();

    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);
    reconciler.reconcile([
      { id: "a", signature: "sig-a" },
      { id: "b", signature: "sig-b" },
    ]);

    expect(open).toHaveBeenCalledTimes(2);
    expect(reconciler.size).toBe(2);
  });

  it("closes the subscription for a target that disappears from the current tick (removeNode)", () => {
    const { reconciler, subs } = makeReconciler();

    reconciler.reconcile([
      { id: "a", signature: "sig-a" },
      { id: "b", signature: "sig-b" },
    ]);
    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);

    expect(subs.get("b")?.closed).toEqual([true]);
    expect(subs.get("a")?.closed).toEqual([]);
    expect(reconciler.size).toBe(1);
  });

  it("closes and reopens a subscription when the signature changes for the same key (e.g. beacon pairing appears on a later tick)", () => {
    const { reconciler, open, subs } = makeReconciler();

    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);
    // subs.get("a") は次の reconcile で新しい fake に上書きされるため、
    // 古い購読（張り直し前の1本目）への参照を先に確保しておく。
    const firstSubscription = subs.get("a");

    reconciler.reconcile([{ id: "a", signature: "sig-a-with-beacon" }]);

    expect(firstSubscription?.closed).toEqual([true]);
    // 張り直し後の新しい購読は close されていない。
    expect(subs.get("a")?.closed).toEqual([]);
    expect(open).toHaveBeenCalledTimes(2);
    expect(reconciler.size).toBe(1);
  });

  it("closes all registered subscriptions on closeAll (dispose)", () => {
    const { reconciler, subs } = makeReconciler();

    reconciler.reconcile([
      { id: "a", signature: "sig-a" },
      { id: "b", signature: "sig-b" },
    ]);
    reconciler.closeAll();

    expect(subs.get("a")?.closed).toEqual([true]);
    expect(subs.get("b")?.closed).toEqual([true]);
    expect(reconciler.size).toBe(0);
  });

  it("does not reopen anything on a reconcile after closeAll with an empty target list", () => {
    const { reconciler, open } = makeReconciler();

    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);
    reconciler.closeAll();
    reconciler.reconcile([]);

    expect(open).toHaveBeenCalledTimes(1);
    expect(reconciler.size).toBe(0);
  });
});
