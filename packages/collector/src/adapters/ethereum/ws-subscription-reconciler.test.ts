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

describe("WsSubscriptionReconciler edge cases (Issue #301)", () => {
  it("does nothing when reconciling an empty target list against an empty registry", () => {
    const { reconciler, open } = makeReconciler();

    reconciler.reconcile([]);

    expect(open).not.toHaveBeenCalled();
    expect(reconciler.size).toBe(0);
  });

  it("opens a subscription for every target when several appear at once from an empty registry", () => {
    const { reconciler, open } = makeReconciler();

    reconciler.reconcile([
      { id: "a", signature: "sig-a" },
      { id: "b", signature: "sig-b" },
      { id: "c", signature: "sig-c" },
    ]);

    expect(open).toHaveBeenCalledTimes(3);
    expect(reconciler.size).toBe(3);
  });

  it("closes every disappeared target when several vanish in the same tick", () => {
    const { reconciler, subs } = makeReconciler();

    reconciler.reconcile([
      { id: "a", signature: "sig-a" },
      { id: "b", signature: "sig-b" },
      { id: "c", signature: "sig-c" },
    ]);
    // 一気に b と c が消える tick。
    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);

    expect(subs.get("a")?.closed).toEqual([]);
    expect(subs.get("b")?.closed).toEqual([true]);
    expect(subs.get("c")?.closed).toEqual([true]);
    expect(reconciler.size).toBe(1);
  });

  it("applies add, remove, and signature-change together within a single reconcile tick", () => {
    const { reconciler, open, subs } = makeReconciler();

    // 初期: a(維持予定) / b(消滅予定) / c(signature 変化予定)。
    reconciler.reconcile([
      { id: "a", signature: "sig-a" },
      { id: "b", signature: "sig-b" },
      { id: "c", signature: "sig-c" },
    ]);
    const firstC = subs.get("c");
    expect(open).toHaveBeenCalledTimes(3);

    // 1 tick で同時に: a 維持 / b 消滅 / c signature 変化 / d 新規。
    reconciler.reconcile([
      { id: "a", signature: "sig-a" },
      { id: "c", signature: "sig-c2" },
      { id: "d", signature: "sig-d" },
    ]);

    // a は張り直されない。
    expect(subs.get("a")?.closed).toEqual([]);
    // b は close される。
    expect(subs.get("b")?.closed).toEqual([true]);
    // c は古い購読が close され、新しい購読へ張り直される。
    expect(firstC?.closed).toEqual([true]);
    expect(subs.get("c")?.closed).toEqual([]);
    // d は新規に開かれる。
    // open 回数: 初期 3 + c 張り直し 1 + d 新規 1 = 5。
    expect(open).toHaveBeenCalledTimes(5);
    // 登録キーは a / c / d の 3 つ。
    expect(reconciler.size).toBe(3);
  });

  it("treats a target that reappears after being removed as a brand-new subscription", () => {
    const { reconciler, open, subs } = makeReconciler();

    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);
    const firstA = subs.get("a");
    // 消滅。
    reconciler.reconcile([]);
    expect(firstA?.closed).toEqual([true]);
    expect(reconciler.size).toBe(0);

    // 同じ id が再出現（removeNode 後の re-addNode 相当）。古い購読は既に
    // close 済みなので、新しい購読として開き直される。
    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);
    expect(open).toHaveBeenCalledTimes(2);
    expect(reconciler.size).toBe(1);
    expect(subs.get("a")?.closed).toEqual([]);
  });

  it("reopens a target as new after closeAll (closeAll clears the registry, it does not permanently disable reconcile)", () => {
    const { reconciler, open } = makeReconciler();

    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);
    reconciler.closeAll();
    // closeAll 後でも、同じ対象が再度 reconcile されれば新規として開かれる
    // （closeAll はレジストリを空にするだけで、以後の reconcile を止めない）。
    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);

    expect(open).toHaveBeenCalledTimes(2);
    expect(reconciler.size).toBe(1);
  });

  it("reopens only once per signature change and stays stable while the new signature holds", () => {
    const { reconciler, open } = makeReconciler();

    reconciler.reconcile([{ id: "a", signature: "sig-a" }]);
    reconciler.reconcile([{ id: "a", signature: "sig-b" }]); // 張り直し 1 回。
    reconciler.reconcile([{ id: "a", signature: "sig-b" }]); // 変化なし。
    reconciler.reconcile([{ id: "a", signature: "sig-b" }]); // 変化なし。

    // 初回 open + signature 変化 1 回の張り直し = 2 回のみ。
    expect(open).toHaveBeenCalledTimes(2);
    expect(reconciler.size).toBe(1);
  });

  it("treats a reordered-but-equal key set as a different signature (documents the caller's contract to emit a stable signature string, e.g. deterministic receivedAtKeys order)", () => {
    // index.ts の signatureOf は `wsUrl + receivedAtKeys.join(",")`。
    // receivedAtKeys の並びが変わると（集合として同じでも）signature 文字列が
    // 変わり、リコンサイラは張り直してしまう。executionTargets は
    // receivedAtKeys を常に `[beacon, self]` / `[self]` の決定的な順序で組む
    // ため実際には起こらないが、その決定性が signature の安定性の前提である
    // ことをここで固定する（順序が非決定になった場合に毎 tick 張り直す
    // 回帰を検出できる）。
    const open = vi.fn<(t: { id: string; keys: string[] }) => Subscription>(
      () => ({ close: () => {} }),
    );
    const reconciler = new WsSubscriptionReconciler<{ id: string; keys: string[] }>({
      keyOf: (t) => t.id,
      signatureOf: (t) => t.keys.join(","),
      open,
    });

    reconciler.reconcile([{ id: "a", keys: ["beacon", "self"] }]);
    // 同じ集合だが順序違い。現状は「別 signature」として張り直す。
    reconciler.reconcile([{ id: "a", keys: ["self", "beacon"] }]);

    expect(open).toHaveBeenCalledTimes(2);
  });

  it("propagates an error thrown by open and keeps previously opened subscriptions registered (caller wraps reconcile in try/catch and retries next tick)", () => {
    // 実際の open（subscribeNewHeads）は接続を非同期に張るため同期例外を
    // 投げない前提だが、万一 open が投げた場合の現在の挙動を固定する。
    // reconcile は例外をそのまま伝播させる（index.ts の blockTick が
    // try/catch で受けてログし、次 tick で再試行することで自己修復する）。
    // 例外が起きても、それより前に open 済みの購読はレジストリに残る。
    const closedA: boolean[] = [];
    const open = vi.fn((t: FakeTarget): Subscription => {
      if (t.id === "b") throw new Error("connect failed for b");
      return {
        close: () => {
          closedA.push(true);
        },
      };
    });
    const reconciler = new WsSubscriptionReconciler<FakeTarget>({
      keyOf: (t) => t.id,
      signatureOf: (t) => t.signature,
      open,
    });

    expect(() =>
      reconciler.reconcile([
        { id: "a", signature: "sig-a" },
        { id: "b", signature: "sig-b" },
      ]),
    ).toThrow("connect failed for b");

    // a は open 成功済みでレジストリに残る（次 tick で b だけ再試行される）。
    expect(reconciler.size).toBe(1);
    expect(closedA).toEqual([]);

    // 次 tick で b が復旧すれば、a は維持・b だけ新規に開かれる。
    open.mockImplementation(() => ({ close: () => {} }));
    reconciler.reconcile([
      { id: "a", signature: "sig-a" },
      { id: "b", signature: "sig-b" },
    ]);
    expect(reconciler.size).toBe(2);
  });
});
