import { describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import { EthereumAdapter } from "./index.js";
import type { HttpClient } from "./http-client.js";
import { beaconHttp } from "./test-helpers/beacon-http-fixtures.js";
import {
  beaconFixture,
  clientFrom,
  rethFixture,
} from "./test-helpers/docker-fixtures.js";
import { elRpcClient, enodeUrl } from "./test-helpers/el-rpc-fixtures.js";

describe("EthereumAdapter.pollPeersOnce", () => {
  it("polls beacon nodes and normalizes their connection into one edge", async () => {
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const http = beaconHttp({
      "http://172.28.2.1:5052": { peerId: "peer-1", connected: ["peer-2"] },
      "http://172.28.2.2:5052": { peerId: "peer-2", connected: ["peer-1"] },
    });
    const adapter = new EthereumAdapter(poller, { httpClient: http });

    const edges = await adapter.pollPeersOnce();
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/beacon1",
        toNodeId: "chainviz-ethereum/beacon2",
        networkId: "chainviz-ethereum-consensus",
      },
    ]);
  });

  it("excludes the validator from Beacon API polling but still polls the execution node via admin_*", async () => {
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("validator1", "172.28.0.3", "lighthouse vc"),
        rethFixture("reth1", "172.28.1.1"),
      ]),
    );
    const http = beaconHttp({
      "http://172.28.2.1:5052": { peerId: "peer-1", connected: [] },
    });
    const getJson = http.getJson as ReturnType<typeof vi.fn>;
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": {
        nodeInfo: { enode: enodeUrl("11", "172.28.1.1") },
        peers: [],
      },
    });
    const adapter = new EthereumAdapter(poller, { httpClient: http, ethRpcClient: rpc });

    await adapter.pollPeersOnce();
    // Beacon API は beacon1 の identity / peers の 2 回だけ。validator は
    // Beacon API を持たないため対象外（reth は EL 側の admin_* で別途扱う）。
    const urls = getJson.mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual([
      "http://172.28.2.1:5052/eth/v1/node/identity",
      "http://172.28.2.1:5052/eth/v1/node/peers?state=connected",
    ]);
  });

  it("keeps other beacon nodes when one fails to respond, and logs the failure (Issue #287)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
        beaconFixture("beacon3", "172.28.2.3"),
      ]),
    );
    const http: HttpClient = {
      getJson: (async (url: string) => {
        if (url.startsWith("http://172.28.2.2:5052")) {
          throw new Error("beacon2 down");
        }
        if (url.startsWith("http://172.28.2.1:5052")) {
          return url.includes("identity")
            ? { data: { peer_id: "peer-1" } }
            : { data: [{ peer_id: "peer-3", state: "connected" }] };
        }
        if (url.startsWith("http://172.28.2.3:5052")) {
          return url.includes("identity")
            ? { data: { peer_id: "peer-3" } }
            : { data: [{ peer_id: "peer-1", state: "connected" }] };
        }
        throw new Error(`unexpected ${url}`);
      }) as HttpClient["getJson"],
    };
    const adapter = new EthereumAdapter(poller, { httpClient: http });

    const edges = await adapter.pollPeersOnce();
    // beacon2 が落ちても beacon1<->beacon3 のエッジは得られる。
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/beacon1",
        toNodeId: "chainviz-ethereum/beacon3",
        networkId: "chainviz-ethereum-consensus",
      },
    ]);
    // Issue #287: 失敗ノード（stableId・実際のエラー）が EL 側
    // （fetchExecutionPeerNodes）と対称にログされる。以前は catch で
    // 無言除外していた。
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "[ethereum] consensus peer poll failed for chainviz-ethereum/beacon2",
      ),
      expect.any(Error),
    );
    vi.restoreAllMocks();
  });

  it("returns no edges when there are no beacon nodes and the lone execution node has no peers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(clientFrom([rethFixture("reth1", "1.1.1.1")]));
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({}),
      // 単独ノードなので admin_peers は空でよい。identity は必要。
      ethRpcClient: elRpcClient({
        "http://1.1.1.1:8545": {
          nodeInfo: { enode: enodeUrl("11", "1.1.1.1") },
          peers: [],
        },
      }),
    });
    expect(await adapter.pollPeersOnce()).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("EthereumAdapter.pollPeersOnce (EL / reth admin_peers)", () => {
  it("polls execution nodes and normalizes their admin_peers connection into one edge", async () => {
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
      ]),
    );
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": {
        nodeInfo: { enode: enodeUrl("11", "172.28.1.1") },
        peers: [{ enode: enodeUrl("22", "172.28.1.2") }],
      },
      "http://172.28.1.2:8545": {
        nodeInfo: { enode: enodeUrl("22", "172.28.1.2") },
        peers: [{ enode: enodeUrl("11", "172.28.1.1") }],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({}),
      ethRpcClient: rpc,
    });

    const edges = await adapter.pollPeersOnce();
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/reth1",
        toNodeId: "chainviz-ethereum/reth2",
        networkId: "chainviz-ethereum-execution",
      },
    ]);
  });

  it("keeps other execution nodes when one fails to respond", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        rethFixture("reth3", "172.28.1.3"),
      ]),
    );
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": {
        nodeInfo: { enode: enodeUrl("11", "172.28.1.1") },
        peers: [{ enode: enodeUrl("33", "172.28.1.3") }],
      },
      "http://172.28.1.3:8545": {
        nodeInfo: { enode: enodeUrl("33", "172.28.1.3") },
        peers: [{ enode: enodeUrl("11", "172.28.1.1") }],
      },
      // reth2 は admin API が無効化されているなどで失敗する想定。
      "http://172.28.1.2:8545": {
        nodeInfoError: new Error("admin API disabled"),
      },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({}),
      ethRpcClient: rpc,
    });

    const edges = await adapter.pollPeersOnce();
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/reth1",
        toNodeId: "chainviz-ethereum/reth3",
        networkId: "chainviz-ethereum-execution",
      },
    ]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "[ethereum] execution peer poll failed for chainviz-ethereum/reth2",
      ),
      expect.any(Error),
    );
    vi.restoreAllMocks();
  });

  it("combines CL and EL edges from a mixed reth+beacon topology without mixing identifier namespaces", async () => {
    // reth1/reth2 と beacon1/beacon2 は同じ論理ノード群だが、CL(libp2p)と
    // EL(devp2p)は別の P2P ネットワークなので、それぞれ独立にエッジが立つ
    // （peers.ts の toPeerEdges を CL/EL で別々に呼んで連結する設計の確認）。
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const http = beaconHttp({
      "http://172.28.2.1:5052": { peerId: "peer-1", connected: ["peer-2"] },
      "http://172.28.2.2:5052": { peerId: "peer-2", connected: ["peer-1"] },
    });
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": {
        nodeInfo: { enode: enodeUrl("11", "172.28.1.1") },
        peers: [{ enode: enodeUrl("22", "172.28.1.2") }],
      },
      "http://172.28.1.2:8545": {
        nodeInfo: { enode: enodeUrl("22", "172.28.1.2") },
        peers: [{ enode: enodeUrl("11", "172.28.1.1") }],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: http,
      ethRpcClient: rpc,
    });

    const edges = await adapter.pollPeersOnce();
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/beacon1",
        toNodeId: "chainviz-ethereum/beacon2",
        networkId: "chainviz-ethereum-consensus",
      },
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/reth1",
        toNodeId: "chainviz-ethereum/reth2",
        networkId: "chainviz-ethereum-execution",
      },
    ]);
  });

  it("still delivers CL edges when every EL admin_* call fails (layer isolation)", async () => {
    // EL 側が全ノード失敗（admin API 無効など）しても、CL 側の beacon エッジは
    // 影響を受けずに配信される（Promise.all の片方の失敗が全体を巻き込まない）。
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const http = beaconHttp({
      "http://172.28.2.1:5052": { peerId: "peer-1", connected: ["peer-2"] },
      "http://172.28.2.2:5052": { peerId: "peer-2", connected: ["peer-1"] },
    });
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": { nodeInfoError: new Error("admin disabled") },
      "http://172.28.1.2:8545": { nodeInfoError: new Error("admin disabled") },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: http,
      ethRpcClient: rpc,
    });

    const edges = await adapter.pollPeersOnce();
    // CL の 1 本だけが残り、EL エッジは 1 本も出ない。
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/beacon1",
        toNodeId: "chainviz-ethereum/beacon2",
        networkId: "chainviz-ethereum-consensus",
      },
    ]);
    vi.restoreAllMocks();
  });

  it("still delivers EL edges when every CL Beacon API call fails (layer isolation)", async () => {
    // 逆方向: CL 側が全滅しても EL 側の reth エッジは配信される。
    vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      clientFrom([
        rethFixture("reth1", "172.28.1.1"),
        rethFixture("reth2", "172.28.1.2"),
        beaconFixture("beacon1", "172.28.2.1"),
        beaconFixture("beacon2", "172.28.2.2"),
      ]),
    );
    const http: HttpClient = {
      getJson: (async (url: string) => {
        // すべての Beacon API 呼び出しを失敗させる。
        throw new Error(`beacon down ${url}`);
      }) as HttpClient["getJson"],
    };
    const rpc = elRpcClient({
      "http://172.28.1.1:8545": {
        nodeInfo: { enode: enodeUrl("11", "172.28.1.1") },
        peers: [{ enode: enodeUrl("22", "172.28.1.2") }],
      },
      "http://172.28.1.2:8545": {
        nodeInfo: { enode: enodeUrl("22", "172.28.1.2") },
        peers: [{ enode: enodeUrl("11", "172.28.1.1") }],
      },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: http,
      ethRpcClient: rpc,
    });

    const edges = await adapter.pollPeersOnce();
    expect(edges).toEqual([
      {
        kind: "peer",
        fromNodeId: "chainviz-ethereum/reth1",
        toNodeId: "chainviz-ethereum/reth2",
        networkId: "chainviz-ethereum-execution",
      },
    ]);
    vi.restoreAllMocks();
  });
});
