import type { BlockEntity } from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import { EthereumAdapter } from "./index.js";
import type { Fixture } from "./test-helpers/docker-fixtures.js";
import {
  beaconFixture,
  clientFrom,
  gethFixture,
  mutableClientFrom,
  rethFixture,
} from "./test-helpers/docker-fixtures.js";
import { controllableWsClient, header } from "./test-helpers/ws-fixtures.js";

describe("EthereumAdapter.subscribeBlocks", () => {
  it("subscribes to every execution node and keys receivedAt by both the matching beacon and itself", async () => {
    // 実 profile と同じ構成: reth1/beacon1、reth2/beacon2 が同じ論理ノード。
    // 同じ受信 1 回を beacon の stableId（CL エッジ用）と reth 自身の
    // stableId（EL エッジ用）の両方に、同一時刻で記録する（Issue #141）。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const ws = controllableWsClient();
    let clock = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      now: () => clock,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    // reth1/reth2 だけ購読、beacon は対象外。
    expect(ws.subscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
    ]);

    ws.emit("ws://172.28.1.1:8546", header());
    clock = 1200;
    ws.emit("ws://172.28.1.2:8546", header());

    expect(blocks).toHaveLength(2);
    // 2 回目には両ノードの受信時刻が、対応する beacon のキーと自身の
    // stableId のキーの両方にマージされている。
    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/beacon1": 1000,
      "chainviz-ethereum/reth1": 1000,
      "chainviz-ethereum/beacon2": 1200,
      "chainviz-ethereum/reth2": 1200,
    });
    expect(blocks[1].number).toBe(16);
    expect(blocks[1].hash).toBe("0xblock1");
    adapter.dispose();
  });

  it("falls back to the execution node's own stableId when it has no beacon", async () => {
    // beacon を持たない EL only 構成では reth 自身の stableId をキーにする。
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      now: () => 1000,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    ws.emit("ws://172.28.1.1:8546", header());

    expect(blocks[0].receivedAt).toEqual({
      "chainviz-ethereum/reth1": 1000,
    });
    adapter.dispose();
  });

  it("keys receivedAt by each execution node's own stableId when none have a beacon", async () => {
    // beacon が一切無い EL only 構成では、両ノードとも自身の stableId をキーに
    // する。同一ブロックを両ノードが受信すると 2 つの独立したキーで束ねられる。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    let clock = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      now: () => clock,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    ws.emit("ws://172.28.1.1:8546", header());
    clock = 1300;
    ws.emit("ws://172.28.1.2:8546", header());

    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/reth1": 1000,
      "chainviz-ethereum/reth2": 1300,
    });
    adapter.dispose();
  });

  it("mixes beacon-keyed and self-keyed receivedAt within one block", async () => {
    // reth1 は beacon1 に対応するが reth2 は対応 beacon が無い。同一ブロックの
    // receivedAt には reth1 分（beacon1 キーと reth1 自身のキー）と reth2
    // 自身のキーが混在する。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const ws = controllableWsClient();
    let clock = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      now: () => clock,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    ws.emit("ws://172.28.1.1:8546", header());
    clock = 1400;
    ws.emit("ws://172.28.1.2:8546", header());

    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/beacon1": 1000,
      "chainviz-ethereum/reth1": 1000,
      "chainviz-ethereum/reth2": 1400,
    });
    adapter.dispose();
  });

  it("shares a beacon key across execution nodes while still keying each node's own EL edge separately", async () => {
    // reth1 と geth1 はノード群キーがともに "1" なので、両方が beacon1 に
    // 対応付く。beacon1 キーは CL エッジ用の共有キーなので初回受信優先で
    // 1000 のまま畳まれる一方、reth1・geth1 自身のキー（EL エッジ用）は
    // それぞれ独立して実受信時刻を保持する（Issue #141 が解決した挙動）。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        gethFixture("geth1", "172.28.1.9"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const ws = controllableWsClient();
    let clock = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      now: () => clock,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    ws.emit("ws://172.28.1.1:8546", header());
    clock = 1500;
    ws.emit("ws://172.28.1.9:8546", header());

    // beacon1 は共有キーなので初回の 1000 のまま。reth1・geth1 は自身の
    // stableId キーにそれぞれの実受信時刻（1000 / 1500）を保持する。
    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/beacon1": 1000,
      "chainviz-ethereum/reth1": 1000,
      "chainviz-ethereum/geth1": 1500,
    });
    adapter.dispose();
  });

  it("closes all subscriptions on dispose", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, { ethWsClient: ws.client });

    await adapter.subscribeBlocks(() => {});
    adapter.dispose();
    expect(ws.closed).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
    ]);
  });

  it("does not subscribe when there are no execution nodes", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, { ethWsClient: ws.client });
    await adapter.subscribeBlocks(() => {});
    expect(ws.subscribedUrls).toEqual([]);
    adapter.dispose();
  });
});

describe("EthereumAdapter.subscribeBlocks dynamic node tracking (Issue #301)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens a newHeads subscription for an execution node that first appears on a later reconcile tick (addNode)", async () => {
    const containers: Fixture[] = [];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    expect(ws.subscribedUrls).toEqual([]);

    // addNode 相当: reth1 が observation に現れる。
    containers.push(rethFixture("reth1", "172.28.1.1"));
    await vi.advanceTimersByTimeAsync(3000);

    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);
    adapter.dispose();
  });

  it("closes an execution node's subscription once it disappears from a later reconcile tick (removeNode) instead of leaving it open until dispose", async () => {
    const containers: Fixture[] = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);

    // removeNode 相当: observation から消える。
    containers.length = 0;
    await vi.advanceTimersByTimeAsync(3000);

    // dispose() を呼ぶ前の時点で、既に close されている（旧実装では
    // dispose() まで close されず、死んだコンテナへの再接続タイマーが
    // 無期限に残る潜在リークがあった。Issue #301 の副次的な解消点）。
    expect(ws.closed).toEqual(["ws://172.28.1.1:8546"]);
    adapter.dispose();
  });

  it("does not close and reopen the subscription across ticks when the target set is unchanged (idempotent reconcile)", async () => {
    const containers: Fixture[] = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);

    // signature（wsUrl + receivedAtKeys）が変わらない限り、同一ノードへの
    // 購読は最初の1回だけで維持される（毎 tick 張り直さない）。
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);
    expect(ws.closed).toEqual([]);
    adapter.dispose();
  });

  it("closes and reopens the subscription when a paired beacon appears on a later tick and receivedAtKeys change (addNode: reth observed before its beacon)", async () => {
    // addNode は reth/beacon を同時作成するが、Docker 観測への反映タイミング
    // 次第で reth のみ先に観測されることがある（設計メモ参照）。
    const containers: Fixture[] = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    let clock = 1000;
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
      now: () => clock,
    });
    const blocks: BlockEntity[] = [];

    await adapter.subscribeBlocks((b) => blocks.push(b));
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);

    ws.emit("ws://172.28.1.1:8546", header());
    expect(blocks[0].receivedAt).toEqual({ "chainviz-ethereum/reth1": 1000 });

    // 次 tick で beacon1 が観測に現れ、reth1 の receivedAtKeys が
    // [self] -> [beacon1, self] へ変わる（signature 変化）。
    containers.push(beaconFixture("beacon1", "172.28.2.1"));
    await vi.advanceTimersByTimeAsync(3000);

    // 同じ wsUrl へ張り直す（close されてから再度 open される）。
    expect(ws.closed).toEqual(["ws://172.28.1.1:8546"]);
    expect(ws.subscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.1:8546",
    ]);

    clock = 2000;
    // 同じブロックハッシュ（header() の既定値）を再送する想定なので、
    // BlockPropagationTracker は既に記録済みの reth1（1000）はそのまま
    // 保持し、まだ記録の無い beacon1 だけを新しい時刻（2000）で追加する
    // （blocks.ts の「同一キーは初回の時刻を保持する」仕様どおり）。
    ws.emit("ws://172.28.1.1:8546", header());
    expect(blocks[1].receivedAt).toEqual({
      "chainviz-ethereum/beacon1": 2000,
      "chainviz-ethereum/reth1": 1000,
    });
    adapter.dispose();
  });

  it("is idempotent: a second subscribeBlocks call does not start a second reconcile loop", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const pollSpy = vi.spyOn(poller, "pollOnce");
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(vi.fn());
    await adapter.subscribeBlocks(vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    // 二重に subscribeBlocks を呼んでも、1 巡分のポーリング（初回 tick）しか
    // 走っていない（2 回目の呼び出しは即座に return する）。
    expect(pollSpy).toHaveBeenCalledTimes(1);
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);
    adapter.dispose();
  });

  it("awaits only the first tick: a node added later is not subscribed until a reconcile timer fires, not merely on a microtask flush (fire-and-forget after the initial await)", async () => {
    // 後方互換仕様（設計メモの唯一の逸脱点）の境界確認: subscribeBlocks() は
    // 初回 tick の完了だけを await し、2 回目以降は setTimeout 経由の
    // fire-and-forget。よって「関数解決後に現れたノード」は、マイクロタスクを
    // 流すだけ（advanceTimersByTimeAsync(0)）では拾われず、リコンサイル間隔
    // 経過後にのみ購読される。
    const containers: Fixture[] = [];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    // 初回 tick 時点では対象ゼロ。
    expect(ws.subscribedUrls).toEqual([]);

    // 関数解決後に addNode 相当でノードが現れる。
    containers.push(rethFixture("reth1", "172.28.1.1"));
    // マイクロタスクを流すだけでは次 tick は走らない（fire-and-forget なので
    // 次 tick は setTimeout に積まれており、タイマーを進めないと発火しない）。
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.subscribedUrls).toEqual([]);

    // リコンサイル間隔ぶんタイマーを進めて初めて購読される。
    await vi.advanceTimersByTimeAsync(3000);
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);
    adapter.dispose();
  });

  it("opens subscriptions for multiple execution nodes that appear together in the same reconcile tick", async () => {
    const containers: Fixture[] = [];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    // 1 tick の間に 2 ノードが同時に現れる。
    containers.push(rethFixture("reth1", "172.28.1.1"));
    containers.push(rethFixture("reth2", "172.28.1.2"));
    await vi.advanceTimersByTimeAsync(3000);

    expect(ws.subscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
    ]);
    expect(ws.closed).toEqual([]);
    adapter.dispose();
  });

  it("closes the departed node and opens the arriving node when one is removed and another added within the same tick", async () => {
    const containers: Fixture[] = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);

    // 同一 tick で reth1 が消え、reth2 が現れる（入れ替え）。
    containers.length = 0;
    containers.push(rethFixture("reth2", "172.28.1.2"));
    await vi.advanceTimersByTimeAsync(3000);

    expect(ws.closed).toEqual(["ws://172.28.1.1:8546"]);
    expect(ws.subscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
    ]);
    adapter.dispose();
  });

  it("does not re-subscribe a removed node on subsequent ticks (regression: no rogue reconnect churn after removeNode)", async () => {
    // removeNode 後の潜在リーク解消の回帰テスト。一度 close したノードは、
    // 以降の tick で観測に現れない限り二度と subscribe されない
    // （レジストリから削除されているため、毎 tick 開き直す挙動が無いこと）。
    const containers: Fixture[] = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    containers.length = 0;
    await vi.advanceTimersByTimeAsync(3000);
    expect(ws.closed).toEqual(["ws://172.28.1.1:8546"]);

    // 何 tick 経過しても、消えたノードへの再 subscribe も追加の close も
    // 発生しない（close は 1 回きり、subscribe は最初の 1 回きり）。
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);
    expect(ws.closed).toEqual(["ws://172.28.1.1:8546"]);
    adapter.dispose();
  });

  it("reopens a fresh subscription when a removed node reappears on a later tick (removeNode then re-addNode of the same stableId)", async () => {
    const containers: Fixture[] = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    // 消滅。
    containers.length = 0;
    await vi.advanceTimersByTimeAsync(3000);
    expect(ws.closed).toEqual(["ws://172.28.1.1:8546"]);

    // 同じ stableId で再出現。古い購読は既に close 済みなので、新しい購読が
    // 開かれる（購読が 2 本目として張られる）。
    containers.push(rethFixture("reth1", "172.28.1.1"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(ws.subscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.1:8546",
    ]);
    adapter.dispose();
  });

  it("keeps subscribing the rest of the nodes even if one node's reconcile poll observation is partial across ticks", async () => {
    // 複数ノードが順に増える通常の増設シナリオでも、既存ノードの購読を
    // 張り直さずに新規ノードだけを追加で開く（既存購読への非干渉）。
    const containers: Fixture[] = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, {
      ethWsClient: ws.client,
      blockSubscriptionReconcileIntervalMs: 3000,
    });

    await adapter.subscribeBlocks(() => {});
    expect(ws.subscribedUrls).toEqual(["ws://172.28.1.1:8546"]);

    containers.push(rethFixture("reth2", "172.28.1.2"));
    await vi.advanceTimersByTimeAsync(3000);
    containers.push(rethFixture("reth3", "172.28.1.3"));
    await vi.advanceTimersByTimeAsync(3000);

    // 追加のたびに新規ノードだけが開かれ、既存ノードは close されていない。
    expect(ws.subscribedUrls).toEqual([
      "ws://172.28.1.1:8546",
      "ws://172.28.1.2:8546",
      "ws://172.28.1.3:8546",
    ]);
    expect(ws.closed).toEqual([]);
    adapter.dispose();
  });
});
