// EthereumAdapter.pollInfra() が NodeEntity.headBlockHash を
// headTipCache（subscribeBlocks の newHeads 経由）から実際に埋める
// エンドツーエンドの配線を確認する（Issue #296）。head-tip-cache.test.ts
// はキャッシュ単体のロジックを、こちらは subscribeBlocks -> pollInfra の
// 実際の配線（受信 -> キャッシュ更新 -> 次回ポーリングでの読み出し）を
// 検証する（1 ファイル 1 責務）。

import type { NodeEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import type { EthWsClient, NewHeadHeader, Subscription } from "./eth-ws-client.js";
import { EthereumAdapter } from "./index.js";

const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

interface Fixture {
  summary: DockerContainerSummary;
  top: DockerTopResult;
}

/**
 * `containers` を毎回参照で読み直す DockerClient。配列の中身を書き換える
 * ことで、次の `pollOnce()` 以降にノードが消えた（removeNode 相当）状況を
 * シミュレートできる。
 */
function mutableClientFrom(containers: Fixture[]): DockerClient {
  return {
    listContainers: async () => containers.map((f) => f.summary),
    getContainer: (id: string) => ({
      top: async () =>
        containers.find((f) => f.summary.Id === id)?.top ?? {
          Titles: ["CMD"],
          Processes: [],
        },
      stats: async () => zeroStats,
    }),
  };
}

function rethFixture(service: string, ip: string): Fixture {
  return {
    summary: {
      Id: `id-${service}`,
      Names: [`/chainviz-ethereum-${service}-1`],
      Image: "ghcr.io/paradigmxyz/reth:latest",
      State: "running",
      Labels: {
        "com.docker.compose.project": "chainviz-ethereum",
        "com.docker.compose.service": service,
      },
      NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
    },
    top: { Titles: ["CMD"], Processes: [["reth node"]] },
  };
}

function beaconFixture(service: string, ip: string): Fixture {
  return {
    summary: {
      Id: `id-${service}`,
      Names: [`/chainviz-ethereum-${service}-1`],
      Image: "sigp/lighthouse:latest",
      State: "running",
      Labels: {
        "com.docker.compose.project": "chainviz-ethereum",
        "com.docker.compose.service": service,
      },
      NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
    },
    top: { Titles: ["CMD"], Processes: [["lighthouse bn"]] },
  };
}

/** 手動でヘッダを発火できる制御可能な EthWsClient（newHeads のみ）。 */
function controllableWsClient(): {
  client: EthWsClient;
  emit: (wsUrl: string, header: NewHeadHeader) => void;
} {
  const headHandlers = new Map<string, (h: NewHeadHeader) => void>();
  const client: EthWsClient = {
    subscribeNewHeads(wsUrl, onHeader): Subscription {
      headHandlers.set(wsUrl, onHeader);
      return { close(): void {} };
    },
    subscribePendingTransactions(): Subscription {
      return { close(): void {} };
    },
  };
  return {
    client,
    emit: (wsUrl, header) => headHandlers.get(wsUrl)?.(header),
  };
}

function header(overrides: Partial<NewHeadHeader> = {}): NewHeadHeader {
  return {
    hash: "0xblock1",
    number: "0x10",
    parentHash: "0xparent",
    timestamp: "0x64",
    ...overrides,
  };
}

async function headBlockHashOf(
  adapter: EthereumAdapter,
  stableId: string,
): Promise<string | undefined> {
  const partial = await adapter.pollInfra();
  const node = partial.entities?.find(
    (e): e is NodeEntity => e.kind === "node" && e.id === stableId,
  );
  return node?.headBlockHash;
}

describe("EthereumAdapter: headBlockHash wiring (subscribeBlocks -> pollInfra, Issue #296)", () => {
  it("stays the empty-string placeholder before any newHeads has been received", async () => {
    const containers = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, { ethWsClient: ws.client });

    await adapter.subscribeBlocks(() => {});
    expect(await headBlockHashOf(adapter, "chainviz-ethereum/reth1")).toBe("");
  });

  it("fills headBlockHash with the tip hash from the next newHeads receipt", async () => {
    const containers = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, { ethWsClient: ws.client });

    await adapter.subscribeBlocks(() => {});
    ws.emit("ws://172.28.1.1:8546", header({ hash: "0xtip1" }));

    expect(await headBlockHashOf(adapter, "chainviz-ethereum/reth1")).toBe(
      "0xtip1",
    );
  });

  it("also fills the paired beacon node's headBlockHash as an alias of the execution node's tip (Issue #141 aliasing)", async () => {
    const containers = [
      rethFixture("reth1", "172.28.1.1"),
      beaconFixture("beacon1", "172.28.2.1"),
    ];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, { ethWsClient: ws.client });

    await adapter.subscribeBlocks(() => {});
    ws.emit("ws://172.28.1.1:8546", header({ hash: "0xtip1" }));

    expect(await headBlockHashOf(adapter, "chainviz-ethereum/reth1")).toBe(
      "0xtip1",
    );
    expect(await headBlockHashOf(adapter, "chainviz-ethereum/beacon1")).toBe(
      "0xtip1",
    );
  });

  it("overwrites headBlockHash on a later newHeads (normal progression / reorg)", async () => {
    const containers = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, { ethWsClient: ws.client });

    await adapter.subscribeBlocks(() => {});
    ws.emit("ws://172.28.1.1:8546", header({ hash: "0xtip1" }));
    expect(await headBlockHashOf(adapter, "chainviz-ethereum/reth1")).toBe(
      "0xtip1",
    );

    ws.emit("ws://172.28.1.1:8546", header({ hash: "0xtip2" }));
    expect(await headBlockHashOf(adapter, "chainviz-ethereum/reth1")).toBe(
      "0xtip2",
    );
  });

  it("keeps each node's headBlockHash independent", async () => {
    const containers = [
      rethFixture("reth1", "172.28.1.1"),
      rethFixture("reth2", "172.28.1.2"),
    ];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, { ethWsClient: ws.client });

    await adapter.subscribeBlocks(() => {});
    ws.emit("ws://172.28.1.1:8546", header({ hash: "0xtip-a" }));
    ws.emit("ws://172.28.1.2:8546", header({ hash: "0xtip-b" }));

    expect(await headBlockHashOf(adapter, "chainviz-ethereum/reth1")).toBe(
      "0xtip-a",
    );
    expect(await headBlockHashOf(adapter, "chainviz-ethereum/reth2")).toBe(
      "0xtip-b",
    );
  });

  it("discards a removed node's headBlockHash so a later re-add with the same stableId starts fresh (removeNode -> addNode)", async () => {
    // pollInfra が毎回 headTipCache.prune() を呼ぶため、observation から
    // 消えたノードの tip は次回ポーリングまでに破棄される。addNode が同じ
    // stableId で再作成した場合でも、古い tip が亡霊のように残らない。
    const containers = [rethFixture("reth1", "172.28.1.1")];
    const poller = new DockerPoller(mutableClientFrom(containers));
    const ws = controllableWsClient();
    const adapter = new EthereumAdapter(poller, { ethWsClient: ws.client });

    await adapter.subscribeBlocks(() => {});
    ws.emit("ws://172.28.1.1:8546", header({ hash: "0xstale" }));
    expect(await headBlockHashOf(adapter, "chainviz-ethereum/reth1")).toBe(
      "0xstale",
    );

    // removeNode 相当: 観測から消える。
    containers.length = 0;
    await adapter.pollInfra();

    // addNode 相当: 同じ stableId のコンテナが再び観測に現れる。まだ
    // newHeads を受け直していないので headBlockHash は既定のプレースホルダ
    // （空文字列）に戻っている。
    containers.push(rethFixture("reth1", "172.28.1.1"));
    expect(await headBlockHashOf(adapter, "chainviz-ethereum/reth1")).toBe("");
  });
});
