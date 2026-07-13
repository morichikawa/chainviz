import type { PeerEdge } from "@chainviz/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import { EthereumAdapter } from "./index.js";
import { beaconHttp } from "./test-helpers/beacon-http-fixtures.js";
import { beaconFixture, clientFrom } from "./test-helpers/docker-fixtures.js";

describe("EthereumAdapter.subscribePeers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls immediately and then on the configured interval", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const http = beaconHttp({
      "http://172.28.2.1:5052": { peerId: "peer-1", connected: [] },
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: http,
      peerPollIntervalMs: 3000,
    });
    const onUpdate = vi.fn<(edges: PeerEdge[]) => void>();

    adapter.subscribePeers(onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(onUpdate).toHaveBeenCalledTimes(2);

    adapter.dispose();
    await vi.advanceTimersByTimeAsync(9000);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("keeps looping after a failed poll", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const failingPoller = {
      pollOnce: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("docker down");
        return [];
      }),
    } as unknown as DockerPoller;
    const adapter = new EthereumAdapter(failingPoller, {
      httpClient: beaconHttp({}),
      peerPollIntervalMs: 3000,
    });
    const onUpdate = vi.fn();

    adapter.subscribePeers(onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    // 1 回目は失敗するので onUpdate は呼ばれない
    expect(onUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);
    // 2 回目は成功して onUpdate が呼ばれる（ループは止まっていない）
    expect(onUpdate).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it("is idempotent: a second subscribe does not start a second loop", async () => {
    const poller = new DockerPoller(
      clientFrom([beaconFixture("beacon1", "172.28.2.1")]),
    );
    const pollSpy = vi.spyOn(poller, "pollOnce");
    const adapter = new EthereumAdapter(poller, {
      httpClient: beaconHttp({
        "http://172.28.2.1:5052": { peerId: "peer-1", connected: [] },
      }),
      peerPollIntervalMs: 3000,
    });

    adapter.subscribePeers(vi.fn());
    adapter.subscribePeers(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    // 二重購読でも 1 巡分のポーリングしか走らない
    expect(pollSpy).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });
});
