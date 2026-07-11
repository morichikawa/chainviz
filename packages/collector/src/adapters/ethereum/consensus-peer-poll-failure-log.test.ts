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

const baseUrl = `http://172.28.9.1:${BEACON_API_PORT}`;

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
});
