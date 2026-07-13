import { vi } from "vitest";
import { BEACON_API_PORT } from "../beacon-api.js";
import type { HttpClient } from "../http-client.js";

/**
 * Issue #309: peer-block-adapter.test.ts から切り出した共有fixture。
 * Beacon API（identity/peers/syncing）向けの HttpClient モック。
 */

/**
 * baseUrl 単位に identity / peers / syncing レスポンスを差し込める
 * HttpClient。`syncing` を省略したベースは `/eth/v1/node/syncing` に既定で
 * 健全な同期済みレスポンス（is_syncing/is_optimistic/el_offline すべて
 * false、head_slot 0）を返す（D層ループ（subscribeNodeInternals、
 * Issue #274）が beacon ノードの同期状態も毎 tick 取得するため、identity/
 * peers しか使わない既存のテストが実ネットワークへフォールバックしない
 * ようにする既定値）。特定の同期状態を検証したいテストは `syncing` で
 * 上書きする。
 */
export function beaconHttp(
  byBase: Record<
    string,
    {
      peerId: string;
      connected: string[];
      syncing?: {
        isSyncing?: boolean;
        isOptimistic?: boolean;
        elOffline?: boolean;
        headSlot?: number | string;
      };
    }
  >,
): HttpClient {
  return {
    getJson: vi.fn(async (url: string) => {
      for (const [base, data] of Object.entries(byBase)) {
        if (url === `${base}/eth/v1/node/identity`) {
          return { data: { peer_id: data.peerId } };
        }
        if (url === `${base}/eth/v1/node/peers?state=connected`) {
          return {
            data: data.connected.map((id) => ({
              peer_id: id,
              state: "connected",
            })),
          };
        }
        if (url === `${base}/eth/v1/node/syncing`) {
          const s = data.syncing ?? {};
          return {
            data: {
              is_syncing: s.isSyncing ?? false,
              is_optimistic: s.isOptimistic ?? false,
              el_offline: s.elOffline ?? false,
              head_slot: String(s.headSlot ?? 0),
            },
          };
        }
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as HttpClient["getJson"],
  };
}

/**
 * subscribeNodeInternals（D層、Issue #186/#274）のテストで、beacon の同期
 * 状態取得（`/eth/v1/node/syncing`）を実ネットワークにフォールバックさせない
 * ための既定 HttpClient。identity/peers は使わない前提（peerId はダミー値）
 * で、同期状態は `beaconHttp` の既定（健全・synced/head_slot 0）を返す。
 */
export function defaultBeaconSyncHttp(...ips: string[]): HttpClient {
  return beaconHttp(
    Object.fromEntries(
      ips.map((ip) => [`http://${ip}:${BEACON_API_PORT}`, { peerId: "peer", connected: [] }]),
    ),
  );
}
