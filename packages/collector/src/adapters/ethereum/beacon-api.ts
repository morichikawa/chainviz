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
