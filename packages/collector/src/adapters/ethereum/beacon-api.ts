// lighthouse などの Consensus Layer クライアントが公開する Beacon API
// （HTTP）を叩く部分。Beacon API 固有のパス・レスポンス形状といった
// Ethereum 固有の語彙はこのファイル（ChainAdapter 実装の内側）に閉じ込め、
// ワールドステートのスキーマや共通層には漏らさない（CLAUDE.md「ChainAdapter 境界」）。

import type { HttpClient } from "./http-client.js";

/** Beacon API のデフォルト待ち受けポート。 */
export const BEACON_API_PORT = 5052;

/** `GET /eth/v1/node/identity` のレスポンス（必要な部分のみ）。 */
interface NodeIdentityResponse {
  data: { peer_id: string };
}

/** `GET /eth/v1/node/peers` の 1 ピア分（必要な部分のみ）。 */
interface BeaconPeer {
  peer_id: string;
  state: string;
  direction?: string;
}

/** `GET /eth/v1/node/peers` のレスポンス（必要な部分のみ）。 */
interface NodePeersResponse {
  data: BeaconPeer[];
}

/** このノード自身の peer_id を取得する。 */
export async function fetchNodePeerId(
  http: HttpClient,
  baseUrl: string,
): Promise<string> {
  const res = await http.getJson<NodeIdentityResponse>(
    `${baseUrl}/eth/v1/node/identity`,
  );
  return res.data.peer_id;
}

/** 接続中（state=connected）のピアの peer_id 一覧を取得する。 */
export async function fetchConnectedPeerIds(
  http: HttpClient,
  baseUrl: string,
): Promise<string[]> {
  const res = await http.getJson<NodePeersResponse>(
    `${baseUrl}/eth/v1/node/peers?state=connected`,
  );
  return (res.data ?? [])
    .filter((p) => p.state === "connected")
    .map((p) => p.peer_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * `GET /eth/v1/node/syncing` のレスポンス（必要な部分のみ）。数値フィールド
 * （head_slot / sync_distance）は Beacon API 仕様上 10進の文字列で返る。
 * `is_optimistic` / `el_offline` は比較的新しいフィールドのため、CL
 * クライアントやバージョンによっては欠落しうる（Issue #274）。
 */
interface NodeSyncingResponse {
  data: {
    is_syncing?: unknown;
    is_optimistic?: unknown;
    el_offline?: unknown;
    head_slot?: unknown;
  };
}

/** `fetchBeaconSyncing` が返す、正規化済みのビーコンノード同期状態。 */
export interface BeaconSyncingSnapshot {
  isSyncing: boolean;
  isOptimistic: boolean;
  elOffline: boolean;
  headSlot: number;
}

/**
 * ビーコンノード自身の同期状態を取得する（Issue #274）。ピア取得
 * （`/eth/v1/node/identity` / `/eth/v1/node/peers`）と同じ Beacon API の
 * 別パスで、追加の観測経路は不要。
 *
 * `is_syncing` が boolean で読めない、または `head_slot` が数値として
 * パースできない場合は throw する（呼び出し側でログさせ、キャッシュは
 * 前回値を保持する想定。`sync-status.ts` の欠落時の扱いと同じ方針）。
 * `is_optimistic` / `el_offline` は欠落時に false 扱いとする（欠落した
 * 補助フラグを理由に不調表示へ倒さない。docs/worklog/issue-274.md
 * 決定事項 3）。
 */
export async function fetchBeaconSyncing(
  http: HttpClient,
  baseUrl: string,
): Promise<BeaconSyncingSnapshot> {
  const res = await http.getJson<NodeSyncingResponse>(
    `${baseUrl}/eth/v1/node/syncing`,
  );
  const data = res.data;
  if (typeof data?.is_syncing !== "boolean") {
    throw new Error(
      `unexpected is_syncing in /eth/v1/node/syncing response: ${JSON.stringify(
        data?.is_syncing,
      )}`,
    );
  }
  const headSlot = Number(data.head_slot);
  if (!Number.isFinite(headSlot)) {
    throw new Error(
      `unexpected head_slot in /eth/v1/node/syncing response: ${JSON.stringify(
        data.head_slot,
      )}`,
    );
  }
  return {
    isSyncing: data.is_syncing,
    isOptimistic: data.is_optimistic === true,
    elOffline: data.el_offline === true,
    headSlot,
  };
}
