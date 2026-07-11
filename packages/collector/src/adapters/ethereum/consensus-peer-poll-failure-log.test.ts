// Issue #287: fetchConsensusPeerNodes（CL/Beacon API 側のピアポーリング）が
// 失敗ノードをログ無しで無言除外していた不具合の回帰テスト。ログ自体の
// 有無・内容は peer-block-adapter.test.ts の
// "keeps other beacon nodes when one fails to respond" で確認済みのため、
// このファイルでは連続失敗時のログ間引き（CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL）
// に関心を絞る（CLAUDE.md「テストは関心事ごとの分割を都度検討する」）。

import { describe, expect, it, vi } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import { BEACON_API_PORT } from "./beacon-api.js";
import type { HttpClient } from "./http-client.js";
import {
  CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL,
  EthereumAdapter,
} from "./index.js";

const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

function beaconSummary(service: string, ip: string): DockerContainerSummary {
  return {
    Id: `id-${service}`,
    Names: [`/chainviz-ethereum-${service}-1`],
    Image: "sigp/lighthouse:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": service,
    },
    NetworkSettings: { Networks: { chain: { IPAddress: ip } } },
  };
}

/** 単一の beacon ノードだけを observe する DockerClient。 */
function singleBeaconClient(service: string, ip: string): DockerClient {
  const summary = beaconSummary(service, ip);
  const top: DockerTopResult = { Titles: ["CMD"], Processes: [["lighthouse bn"]] };
  return {
    listContainers: async () => [summary],
    getContainer: () => ({ top: async () => top, stats: async () => zeroStats }),
  };
}

/** identity/peers/syncing すべてに対し常に失敗する HttpClient。 */
function alwaysFailingBeaconHttp(message: string): HttpClient {
  return {
    getJson: async () => {
      throw new Error(message);
    },
  };
}

/** 複数の beacon ノードを observe する DockerClient。 */
function multiBeaconClient(
  nodes: ReadonlyArray<{ service: string; ip: string }>,
): DockerClient {
  const summaries = nodes.map((n) => beaconSummary(n.service, n.ip));
  const top: DockerTopResult = { Titles: ["CMD"], Processes: [["lighthouse bn"]] };
  return {
    listContainers: async () => summaries,
    getContainer: () => ({ top: async () => top, stats: async () => zeroStats }),
  };
}

/** URL 中の IP を見て、`failing` が真を返す IP だけ失敗させる HttpClient。 */
function selectiveFailingBeaconHttp(
  failing: (ip: string) => boolean,
  message: string,
): HttpClient {
  return {
    getJson: (async (url: string) => {
      const ip = new URL(url).hostname;
      if (failing(ip)) throw new Error(message);
      if (url.endsWith("/eth/v1/node/identity")) {
        return { data: { peer_id: `peer-${ip}` } };
      }
      if (url.endsWith("/eth/v1/node/peers?state=connected")) {
        return { data: [] };
      }
      if (url.endsWith("/eth/v1/node/syncing")) {
        return {
          data: {
            is_syncing: false,
            is_optimistic: false,
            el_offline: false,
            head_slot: "0",
          },
        };
      }
      throw new Error(`unexpected url ${url}`);
    }) as HttpClient["getJson"],
  };
}

const baseUrl = `http://172.28.9.1:${BEACON_API_PORT}`;

const beacon1Log = expect.stringContaining(
  "[ethereum] consensus peer poll failed for chainviz-ethereum/beacon1",
);
const beacon2Log = expect.stringContaining(
  "[ethereum] consensus peer poll failed for chainviz-ethereum/beacon2",
);

describe("EthereumAdapter consensus peer poll failure log throttling (Issue #287)", () => {
  it("logs the 1st consecutive failure, suppresses the following ones, and logs again at the interval-th failure", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      singleBeaconClient("beacon1", "172.28.9.1"),
    );
    const adapter = new EthereumAdapter(poller, {
      httpClient: alwaysFailingBeaconHttp("beacon hung"),
    });

    for (let i = 1; i <= CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL; i++) {
      errSpy.mockClear();
      await adapter.pollPeersOnce();
      if (i === 1 || i === CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL) {
        expect(errSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            "[ethereum] consensus peer poll failed for chainviz-ethereum/beacon1",
          ),
          expect.any(Error),
        );
      } else {
        expect(errSpy).not.toHaveBeenCalled();
      }
    }

    vi.restoreAllMocks();
  });

  it("resets the failure count after a success, so the next failure logs again as the 1st", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      singleBeaconClient("beacon1", "172.28.9.1"),
    );
    let failing = true;
    const http: HttpClient = {
      getJson: (async (url: string) => {
        if (failing) throw new Error("beacon hung");
        if (url === `${baseUrl}/eth/v1/node/identity`) {
          return { data: { peer_id: "peer-1" } };
        }
        if (url === `${baseUrl}/eth/v1/node/peers?state=connected`) {
          return { data: [] };
        }
        if (url === `${baseUrl}/eth/v1/node/syncing`) {
          return {
            data: {
              is_syncing: false,
              is_optimistic: false,
              el_offline: false,
              head_slot: "0",
            },
          };
        }
        throw new Error(`unexpected url ${url}`);
      }) as HttpClient["getJson"],
    };
    const adapter = new EthereumAdapter(poller, { httpClient: http });

    // 1 回目の失敗（1回目としてログされる）。
    await adapter.pollPeersOnce();
    expect(errSpy).toHaveBeenCalledTimes(1);

    // 2 回目は間引かれてログされない。
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).not.toHaveBeenCalled();

    // 成功を挟むとカウントがリセットされる。
    failing = false;
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).not.toHaveBeenCalled();

    // 成功後の次の失敗は再び「1回目」としてログされる。
    failing = true;
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it("forgets the failure count for a node that disappears from the target set", async () => {
    // 対象から外れた stableId のカウントが破棄されることを、同じ stableId の
    // ノードが再度現れたときに「1回目」としてログされる（間引かれない）ことで
    // 間接的に確認する（Map を直接覗けないため）。
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let observed = true;
    const summary = beaconSummary("beacon1", "172.28.9.1");
    const top: DockerTopResult = { Titles: ["CMD"], Processes: [["lighthouse bn"]] };
    const poller = new DockerPoller({
      listContainers: async () => (observed ? [summary] : []),
      getContainer: () => ({ top: async () => top, stats: async () => zeroStats }),
    });
    const adapter = new EthereumAdapter(poller, {
      httpClient: alwaysFailingBeaconHttp("beacon hung"),
    });

    // 1回目の失敗（ログされる）。
    await adapter.pollPeersOnce();
    expect(errSpy).toHaveBeenCalledTimes(1);

    // 2回目は間引かれる。
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).not.toHaveBeenCalled();

    // ノードが観測から消える（removeNode 相当）。
    observed = false;
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).not.toHaveBeenCalled();

    // 同じ stableId のノードが観測に戻ってきたら、カウントは破棄されている
    // ため再び「1回目」としてログされる。
    observed = true;
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  // 間引き境界値: 直前テストは 1〜INTERVAL 回目までしか回さないため、
  // 「INTERVAL の次の周期」を跨いだ挙動（INTERVAL+1 は出ない、2*INTERVAL で
  // 再び出る）を明示的に確認する。off-by-one で毎回ログ/永遠に沈黙する
  // 退行を検出するための境界テスト。
  it("logs only at the 1st and every interval-th failure across two full cycles", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(singleBeaconClient("beacon1", "172.28.9.1"));
    const adapter = new EthereumAdapter(poller, {
      httpClient: alwaysFailingBeaconHttp("beacon hung"),
    });

    const interval = CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL;
    const loggedAt: number[] = [];
    for (let i = 1; i <= 2 * interval; i++) {
      errSpy.mockClear();
      await adapter.pollPeersOnce();
      if (errSpy.mock.calls.length > 0) loggedAt.push(i);
    }

    // 1 回目・INTERVAL 回目・2*INTERVAL 回目のみログ。
    // 特に INTERVAL-1 と INTERVAL+1 は沈黙、2*INTERVAL で復活。
    expect(loggedAt).toEqual([1, interval, 2 * interval]);

    vi.restoreAllMocks();
  });

  it("suppresses the failure immediately after an interval-th log (start of the next cycle)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(singleBeaconClient("beacon1", "172.28.9.1"));
    const adapter = new EthereumAdapter(poller, {
      httpClient: alwaysFailingBeaconHttp("beacon hung"),
    });

    const interval = CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL;
    // INTERVAL 回目まで進める（この回はログされる）。
    for (let i = 1; i <= interval; i++) await adapter.pollPeersOnce();

    // INTERVAL+1 回目は次の周期の先頭であり、間引かれてログされない。
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("keeps per-node failure counts independent when multiple nodes fail at once", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(
      multiBeaconClient([
        { service: "beacon1", ip: "172.28.9.1" },
        { service: "beacon2", ip: "172.28.9.2" },
      ]),
    );
    const adapter = new EthereumAdapter(poller, {
      httpClient: selectiveFailingBeaconHttp(() => true, "beacon hung"),
    });

    // 1 回目: 両ノードとも「1回目」として独立にログされる。
    await adapter.pollPeersOnce();
    expect(errSpy).toHaveBeenCalledWith(beacon1Log, expect.any(Error));
    expect(errSpy).toHaveBeenCalledWith(beacon2Log, expect.any(Error));
    expect(errSpy).toHaveBeenCalledTimes(2);

    // 2 回目: 両ノードとも間引かれる（片方のカウントがもう片方を巻き込んで
    // ログを誘発しない）。
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("lets a newly-failing node log as its own 1st while another node is mid-streak", async () => {
    // beacon1 は最初から失敗し続け、beacon2 は途中から失敗し始める。beacon1 が
    // すでに複数回失敗（カウント > 1）していても、beacon2 は自分の「1回目」として
    // ログされるべき。カウントがノード間で共有されていると beacon2 が即座に
    // 間引かれてしまうため、その退行を検出する。
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let beacon2Failing = false;
    const poller = new DockerPoller(
      multiBeaconClient([
        { service: "beacon1", ip: "172.28.9.1" },
        { service: "beacon2", ip: "172.28.9.2" },
      ]),
    );
    const adapter = new EthereumAdapter(poller, {
      httpClient: selectiveFailingBeaconHttp(
        (ip) => ip === "172.28.9.1" || (beacon2Failing && ip === "172.28.9.2"),
        "beacon hung",
      ),
    });

    // poll 1: beacon1 のみ失敗 → beacon1 が 1 回目としてログ。
    await adapter.pollPeersOnce();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(beacon1Log, expect.any(Error));

    // poll 2,3: beacon1 は間引き（カウント 2,3）、beacon2 は健全 → 無ログ。
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    await adapter.pollPeersOnce();
    expect(errSpy).not.toHaveBeenCalled();

    // beacon2 が失敗し始める。poll 4: beacon1 はカウント 4 で間引かれるが、
    // beacon2 は自分の 1 回目としてログされる。
    beacon2Failing = true;
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(beacon2Log, expect.any(Error));

    vi.restoreAllMocks();
  });

  it("resets the count when a success lands right after the very 1st failure", async () => {
    // カウントリセットの境界: ちょうど 1 回失敗した直後（まだ間引き周期に
    // 入る前）に成功した場合でも、次の失敗が再び「1回目」になること。
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(singleBeaconClient("beacon1", "172.28.9.1"));
    let failing = true;
    const http: HttpClient = {
      getJson: (async (url: string) => {
        if (failing) throw new Error("beacon hung");
        if (url === `${baseUrl}/eth/v1/node/identity`) {
          return { data: { peer_id: "peer-1" } };
        }
        if (url === `${baseUrl}/eth/v1/node/peers?state=connected`) {
          return { data: [] };
        }
        if (url === `${baseUrl}/eth/v1/node/syncing`) {
          return {
            data: {
              is_syncing: false,
              is_optimistic: false,
              el_offline: false,
              head_slot: "0",
            },
          };
        }
        throw new Error(`unexpected url ${url}`);
      }) as HttpClient["getJson"],
    };
    const adapter = new EthereumAdapter(poller, { httpClient: http });

    // 1 回失敗（1 回目としてログ）。
    await adapter.pollPeersOnce();
    expect(errSpy).toHaveBeenCalledTimes(1);

    // すぐに成功（カウントを 1 のまま放置せず破棄する）。
    failing = false;
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).not.toHaveBeenCalled();

    // 次の失敗は再び 1 回目（サフィックス無し）としてログされる。
    failing = true;
    errSpy.mockClear();
    await adapter.pollPeersOnce();
    expect(errSpy).toHaveBeenCalledTimes(1);
    const [message] = errSpy.mock.calls[0] ?? [];
    expect(message).not.toContain("consecutive failures");

    vi.restoreAllMocks();
  });

  it("logs actionable detail: stableId, original error, and consecutive-failure count", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const poller = new DockerPoller(singleBeaconClient("beacon1", "172.28.9.1"));
    const adapter = new EthereumAdapter(poller, {
      httpClient: alwaysFailingBeaconHttp("ETIMEDOUT beacon 172.28.9.1"),
    });

    // 1 回目: stableId を含み、元のエラーオブジェクト（メッセージ保持）を
    // 第2引数に渡す。まだ 1 回目なので連続失敗回数のサフィックスは付かない。
    await adapter.pollPeersOnce();
    expect(errSpy).toHaveBeenCalledTimes(1);
    const [firstMsg, firstErr] = errSpy.mock.calls[0] ?? [];
    expect(firstMsg).toContain("chainviz-ethereum/beacon1");
    expect(firstMsg).not.toContain("consecutive failures");
    expect(firstErr).toBeInstanceOf(Error);
    expect((firstErr as Error).message).toBe("ETIMEDOUT beacon 172.28.9.1");

    // INTERVAL 回目まで進める。この回のログには連続失敗回数が付き、依然として
    // stableId と元のエラーを含む（何回失敗し続けているか運用者が追える）。
    const interval = CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL;
    let intervalCall: [unknown, unknown] | undefined;
    for (let i = 2; i <= interval; i++) {
      errSpy.mockClear();
      await adapter.pollPeersOnce();
      if (i === interval) intervalCall = errSpy.mock.calls[0] as [unknown, unknown];
    }
    expect(intervalCall).toBeDefined();
    const [intervalMsg, intervalErr] = intervalCall ?? [];
    expect(intervalMsg).toContain("chainviz-ethereum/beacon1");
    expect(intervalMsg).toContain(`(${interval} consecutive failures)`);
    expect((intervalErr as Error).message).toBe("ETIMEDOUT beacon 172.28.9.1");

    vi.restoreAllMocks();
  });
});
