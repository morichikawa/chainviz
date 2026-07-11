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
 * `head_slot` が Beacon API 仕様（10進文字列エンコードの uint64）または
 * それと等価な JSON 数値のいずれかに準拠しているときだけ数値化する
 * （Issue #282）。`Number(...)` の緩い変換規則（空文字列/nullを0に、
 * 16進表記・指数表記を受理する等）をそのまま通すと非準拠値を静かに
 * 受理してしまうため、受理する形を明示的に絞る。
 *
 * 受理する形:
 * 1. 10進整数文字列（`/^\d+$/`。前後の空白・符号・16進プレフィックス・
 *    指数表記を含まない、1桁以上の数字のみ）
 * 2. 非負整数の JSON 数値（Beacon API 仕様上は文字列だが、CL クライアント/
 *    バージョンによっては数値で返ることがある。Issue #274 のテストで
 *    「JSON数値の head_slot も受理する」挙動が既に固定されているため
 *    維持する）
 *
 * 上記のどちらでもない場合（空文字列・空白のみ・null・欠落
 * `undefined`・16進/指数表記の文字列・負数・小数・その他の型）は
 * `undefined` を返す。欠落も不正値も同じ経路で `undefined` になるため、
 * 呼び出し元でのエラー扱いが対称になる。
 */
function parseHeadSlot(value: unknown): number | undefined {
  if (typeof value === "string") {
    return /^\d+$/.test(value) ? Number(value) : undefined;
  }
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  return undefined;
}

/**
 * ビーコンノード自身の同期状態を取得する（Issue #274）。ピア取得
 * （`/eth/v1/node/identity` / `/eth/v1/node/peers`）と同じ Beacon API の
 * 別パスで、追加の観測経路は不要。
 *
 * `is_syncing` が boolean で読めない、または `head_slot` が
 * `parseHeadSlot` で受理できる形でない場合は throw する（呼び出し側で
 * ログさせ、キャッシュは前回値を保持する想定。`sync-status.ts` の
 * 欠落時の扱いと同じ方針）。`is_optimistic` / `el_offline` は欠落時に
 * false 扱いとする（欠落した補助フラグを理由に不調表示へ倒さない。
 * docs/worklog/issue-274.md 決定事項 3）。
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
  const headSlot = parseHeadSlot(data.head_slot);
  if (headSlot === undefined) {
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
