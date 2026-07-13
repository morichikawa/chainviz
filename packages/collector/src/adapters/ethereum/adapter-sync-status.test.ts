import type { NodeEntity } from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type { DockerClient } from "../../docker/types.js";
import { EthereumAdapter } from "./index.js";
import type { HttpClient } from "./http-client.js";
import { beaconHttp } from "./test-helpers/beacon-http-fixtures.js";
import type { Fixture } from "./test-helpers/docker-fixtures.js";
import {
  beaconFixture,
  clientFrom,
  rethFixture,
  zeroStats,
} from "./test-helpers/docker-fixtures.js";
import {
  queuedRethMetricsClient,
  rethMetricsText,
  rethMetricsTextWithFinish,
} from "./test-helpers/reth-metrics-fixtures.js";

/** pollInfra の結果から指定 stableId の NodeEntity を取り出す。 */
function nodeById(
  entities: (NodeEntity | { kind: string })[],
  id: string,
): NodeEntity {
  const found = entities.find(
    (e): e is NodeEntity => e.kind === "node" && (e as NodeEntity).id === id,
  );
  if (!found) throw new Error(`node ${id} not found`);
  return found;
}

describe("EthereumAdapter syncStatus/blockHeight from D層 (Issue #187)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fills syncStatus/blockHeight from the Finish checkpoint once D層観測が届く (single node, no peer to compare against)", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [rethMetricsTextWithFinish(42)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    // pollInfra 単体では D層観測がまだ無いため既存のプレースホルダのまま。
    const before = await adapter.pollInfra();
    expect(nodeById(before.entities ?? [], "chainviz-ethereum/reth1")).toMatchObject(
      { syncStatus: "syncing", blockHeight: 0 },
    );

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const after = await adapter.pollInfra();
    expect(nodeById(after.entities ?? [], "chainviz-ethereum/reth1")).toMatchObject(
      { syncStatus: "synced", blockHeight: 42 },
    );
    adapter.dispose();
  });

  it("marks the lagging node as syncing and the caught-up node as synced (two EL peers)", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth3", "172.28.1.3"),
      ]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [rethMetricsTextWithFinish(3372)],
      "http://172.28.1.3:9001/metrics": [rethMetricsTextWithFinish(191)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    expect(nodeById(entities, "chainviz-ethereum/reth1")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 3372,
    });
    expect(nodeById(entities, "chainviz-ethereum/reth3")).toMatchObject({
      syncStatus: "syncing",
      blockHeight: 191,
    });
    adapter.dispose();
  });

  it("keeps the syncing/0 placeholder when the metrics response has no Finish checkpoint", async () => {
    const poller = new DockerPoller(
      clientFrom([rethFixture("reth1", "172.28.1.1")]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      // 既存の rethMetricsText は "Headers" のみで "Finish" を含まない。
      "http://172.28.1.1:9001/metrics": [rethMetricsText(21)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    expect(nodeById(partial.entities ?? [], "chainviz-ethereum/reth1")).toMatchObject(
      { syncStatus: "syncing", blockHeight: 0 },
    );
    adapter.dispose();
  });

  it("stops counting a removed node once its execution container disappears from observations", async () => {
    const reth1 = rethFixture("reth1", "172.28.1.1");
    const reth3 = rethFixture("reth3", "172.28.1.3");
    let fixtures: Fixture[] = [reth1, reth3];
    const byId = new Map([reth1, reth3].map((f) => [f.summary.Id, f] as const));
    const client: DockerClient = {
      listContainers: async () => fixtures.map((f) => f.summary),
      getContainer: (id: string) => ({
        top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
        stats: async () => zeroStats,
      }),
    };
    const poller = new DockerPoller(client);

    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [
        rethMetricsTextWithFinish(3372),
        rethMetricsTextWithFinish(3400),
      ],
      "http://172.28.1.3:9001/metrics": [rethMetricsTextWithFinish(191)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    let partial = await adapter.pollInfra();
    expect(nodeById(partial.entities ?? [], "chainviz-ethereum/reth3")).toMatchObject(
      { syncStatus: "syncing", blockHeight: 191 },
    );

    // reth3 が削除され観測から消える。
    fixtures = [rethFixture("reth1", "172.28.1.1")];
    await vi.advanceTimersByTimeAsync(3000);

    partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    expect(entities.some((e) => (e as NodeEntity).id === "chainviz-ethereum/reth3")).toBe(
      false,
    );
    // reth1 は唯一の観測ノードになったため synced（比較基準が無い既定の倒し方）。
    expect(nodeById(entities, "chainviz-ethereum/reth1")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 3400,
    });
    adapter.dispose();
  });

  it("keeps the CL(beacon) placeholder when the Beacon API syncing fetch fails (Issue #274)", async () => {
    // EL(reth)側は D層メトリクス（Finish checkpoint）で埋まる一方、CL(beacon)
    // 側は Beacon API の /eth/v1/node/syncing 取得が失敗した場合（ここでは
    // モック HttpClient が beacon1 のベース URL に応答を持たない）、
    // beaconSyncStatusCache が更新されず既存のプレースホルダ（syncing/0）の
    // まま残ることを固定する（成功時の値は下の describe ブロック（Issue #274）
    // で検証する）。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [rethMetricsTextWithFinish(1500)],
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      httpClient: beaconHttp({}),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    // EL(reth1)は D層観測から埋まる。
    expect(nodeById(entities, "chainviz-ethereum/reth1")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 1500,
    });
    // CL(beacon1)は同期状態の取得に失敗したためプレースホルダのまま。
    expect(nodeById(entities, "chainviz-ethereum/beacon1")).toMatchObject({
      syncStatus: "syncing",
      blockHeight: 0,
    });
    adapter.dispose();
  });
});

describe("EthereumAdapter syncStatus/blockHeight for CL (beacon) via Beacon API (Issue #274)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fills syncStatus/blockHeight from the Beacon API self-report once D層観測が届く", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: 16587 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    // pollInfra 単体では D層観測がまだ無いため既存のプレースホルダのまま。
    const before = await adapter.pollInfra();
    expect(
      nodeById(before.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "syncing", blockHeight: 0 });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const after = await adapter.pollInfra();
    expect(
      nodeById(after.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "synced", blockHeight: 16587 });
    adapter.dispose();
  });

  it("uses head_slot as blockHeight, not the paired EL node's block number (units differ)", async () => {
    // 実測: head_slot 16587 に対し EL の eth_blockNumber は 16583（空スロット
    // の分だけスロットの方が大きい）。CL/EL で単位が異なる値をそのまま入れ、
    // 混同しないことを確認する。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    const rethMetricsClient = queuedRethMetricsClient({
      "http://172.28.1.1:9001/metrics": [rethMetricsTextWithFinish(16583)],
    });
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: 16587 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    expect(nodeById(entities, "chainviz-ethereum/reth1").blockHeight).toBe(
      16583,
    );
    expect(nodeById(entities, "chainviz-ethereum/beacon1").blockHeight).toBe(
      16587,
    );
    adapter.dispose();
  });

  it.each([
    ["is_syncing", { isSyncing: true }],
    ["el_offline", { elOffline: true }],
    ["is_optimistic", { isOptimistic: true }],
  ] as const)(
    "marks the beacon as syncing when %s is true even though the others are false",
    async (_label, flags) => {
      const poller = new DockerPoller(
        clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
      );
      const adapter = new EthereumAdapter(poller, {
        httpClient: beaconHttp({
          "http://172.28.2.1:5052": {
            peerId: "peer-beacon1",
            connected: [],
            syncing: { headSlot: 100, ...flags },
          },
        }),
        nodeInternalsPollIntervalMs: 3000,
      });

      await adapter.subscribeNodeInternals({
        onInternals: vi.fn(),
        onLinkActivity: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(0);

      const partial = await adapter.pollInfra();
      expect(
        nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
      ).toMatchObject({ syncStatus: "syncing", blockHeight: 100 });
      adapter.dispose();
    },
  );

  it("does not compare beacon nodes against each other (unlike the EL max-checkpoint comparison)", async () => {
    // beacon はノード自身の自己申告で判定済みのため、他 beacon との
    // head_slot の差では判定しない。1台が大きく遅れていても、それ自体の
    // 自己申告が synced なら synced のままである。
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: 9000 },
        },
        "http://172.28.2.2:5052": {
          peerId: "peer-beacon2",
          connected: [],
          syncing: { headSlot: 10 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    expect(nodeById(entities, "chainviz-ethereum/beacon1")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 9000,
    });
    expect(nodeById(entities, "chainviz-ethereum/beacon2")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 10,
    });
    adapter.dispose();
  });

  it("resolves the beacon sync status even when the EL metrics fetch fails in the same tick (independent caches)", async () => {
    // Issue #274 item 4: pollOneBeaconSync（CL）と pollOneNodeInternals（EL）は
    // 同じ D層 tick で並行に走るが、対象集合・キャッシュが互いに素で独立して
    // いる。片方（EL の /metrics 取得）が失敗しても、もう片方（beacon の
    // /eth/v1/node/syncing）は影響を受けずに解決される。逆向き（beacon 失敗時に
    // EL が埋まる）は上の "keeps the CL(beacon) placeholder ..." が既にカバー。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        beaconFixture("beacon1", "172.28.2.1"),
      ]),
    );
    // reth の /metrics キューを空にして getText を throw させる（EL 側失敗）。
    const rethMetricsClient = queuedRethMetricsClient({});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      rethMetricsClient,
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: 4242 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    // EL 側は取得に失敗したためプレースホルダのまま。
    expect(nodeById(entities, "chainviz-ethereum/reth1")).toMatchObject({
      syncStatus: "syncing",
      blockHeight: 0,
    });
    // CL 側は EL の失敗に巻き込まれず解決される。
    expect(nodeById(entities, "chainviz-ethereum/beacon1")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 4242,
    });
    adapter.dispose();
  });

  it("keeps the CL placeholder for a beacon whose head_slot is non-conforming while still resolving a sibling beacon (Issue #282)", async () => {
    // Issue #282: 片方の beacon が非準拠な head_slot（ここでは 16進表記の
    // 文字列 "0x10"。旧実装は Number() で静かに 16 として受理していた）を
    // 返すと fetchBeaconSyncing が throw するが、pollOneBeaconSync がノード
    // 単位で握って（ログのみ）返すため、D層ループ全体はクラッシュしない。
    // もう一方の健全な beacon2 の解決には影響しない（他ノードのポーリングと
    // キャッシュ更新が巻き添えにならない）。
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: "0x10" },
        },
        "http://172.28.2.2:5052": {
          peerId: "peer-beacon2",
          connected: [],
          syncing: { headSlot: 4242 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    const partial = await adapter.pollInfra();
    const entities = partial.entities ?? [];
    // 非準拠値を返した beacon1 は解決されずプレースホルダのまま。
    expect(nodeById(entities, "chainviz-ethereum/beacon1")).toMatchObject({
      syncStatus: "syncing",
      blockHeight: 0,
    });
    // 健全な beacon2 は巻き添えにならず解決される。
    expect(nodeById(entities, "chainviz-ethereum/beacon2")).toMatchObject({
      syncStatus: "synced",
      blockHeight: 4242,
    });
    // 失敗した beacon1 の stableId と head_slot がログに残る（握りつぶさない）。
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "beacon syncing poll failed for chainviz-ethereum/beacon1",
      ),
      expect.objectContaining({ message: expect.stringContaining("head_slot") }),
    );
    adapter.dispose();
  });

  it("recovers a beacon's sync status on a later tick once its head_slot becomes conforming again (Issue #282)", async () => {
    // 非準拠 head_slot は一時的な縮退として扱い、次周期で準拠値に戻れば
    // 回復する（transient。旧実装のように誤った値で埋めたまま固まらない）。
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const getJson = vi
      .fn()
      // 1 tick 目: 非準拠な head_slot（空文字列）→ fetchBeaconSyncing が throw。
      .mockResolvedValueOnce({
        data: {
          is_syncing: false,
          is_optimistic: false,
          el_offline: false,
          head_slot: "",
        },
      })
      // 2 tick 目: 準拠した 10進文字列に回復。
      .mockResolvedValueOnce({
        data: {
          is_syncing: false,
          is_optimistic: false,
          el_offline: false,
          head_slot: "512",
        },
      });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      httpClient: { getJson } as unknown as HttpClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    let partial = await adapter.pollInfra();
    // 1 tick 目は非準拠値のためプレースホルダのまま。
    expect(
      nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "syncing", blockHeight: 0 });

    await vi.advanceTimersByTimeAsync(3000);
    partial = await adapter.pollInfra();
    // 2 tick 目で準拠値に戻り、解決される。
    expect(
      nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "synced", blockHeight: 512 });
    adapter.dispose();
  });

  it("keeps the previous value when a later syncing fetch fails (transient degradation)", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const getJson = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          is_syncing: false,
          is_optimistic: false,
          el_offline: false,
          head_slot: "500",
        },
      })
      .mockRejectedValueOnce(new Error("beacon unreachable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = new EthereumAdapter(poller, {
      httpClient: { getJson } as unknown as HttpClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    let partial = await adapter.pollInfra();
    expect(
      nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "synced", blockHeight: 500 });

    // 次周期の取得が失敗しても、前回の観測値を保持する。
    await vi.advanceTimersByTimeAsync(3000);
    partial = await adapter.pollInfra();
    expect(
      nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "synced", blockHeight: 500 });
    adapter.dispose();
  });

  it("stops resolving a removed beacon once it disappears from observations (forgetNode)", async () => {
    const beacon1 = beaconFixture("beacon1", "172.28.2.1");
    let fixtures: Fixture[] = [beacon1];
    const byId = new Map([beacon1].map((f) => [f.summary.Id, f] as const));
    const client: DockerClient = {
      listContainers: async () => fixtures.map((f) => f.summary),
      getContainer: (id: string) => ({
        top: async () =>
          byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
        stats: async () => zeroStats,
      }),
    };
    const adapter = new EthereumAdapter(new DockerPoller(client), {
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": {
          peerId: "peer-beacon1",
          connected: [],
          syncing: { headSlot: 42 },
        },
      }),
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    let partial = await adapter.pollInfra();
    expect(
      nodeById(partial.entities ?? [], "chainviz-ethereum/beacon1"),
    ).toMatchObject({ syncStatus: "synced", blockHeight: 42 });

    // beacon1 が削除され観測から消える。
    fixtures = [];
    await vi.advanceTimersByTimeAsync(3000);
    partial = await adapter.pollInfra();
    expect(
      (partial.entities ?? []).some(
        (e) => (e as NodeEntity).id === "chainviz-ethereum/beacon1",
      ),
    ).toBe(false);
    adapter.dispose();
  });

  it("does not poll a validator's syncing endpoint (beaconTargets already excludes it)", async () => {
    // validator は lighthouse イメージだが compose サービス名に "beacon" を
    // 含まないため beaconTargets の対象外（既存の targets.ts の選別基準。
    // pollPeersOnce の「excludes the validator from Beacon API polling」と
    // 同じ前提）。pollOneBeaconSync が validator の Beacon API へ到達しようと
    // しないことを HttpClient への到達 URL から確認する。
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("validator1", "172.28.2.9", "lighthouse vc"),
      ]),
    );
    const getJson = vi.fn(async (url: string) => {
      if (url === "http://172.28.2.1:5052/eth/v1/node/syncing") {
        return {
          data: {
            is_syncing: false,
            is_optimistic: false,
            el_offline: false,
            head_slot: "1",
          },
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: { getJson } as unknown as HttpClient,
      nodeInternalsPollIntervalMs: 3000,
    });

    await adapter.subscribeNodeInternals({
      onInternals: vi.fn(),
      onLinkActivity: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(getJson).not.toHaveBeenCalledWith(
      "http://172.28.2.9:5052/eth/v1/node/syncing",
    );
    adapter.dispose();
  });
});
