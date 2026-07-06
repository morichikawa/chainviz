// EL（実行層）の admin_nodeInfo / admin_peers のレスポンスを、B 層のピア
// 正規化（peers.ts の toPeerEdges）へ渡せる形に変換する純粋関数群と、
// それを実際の reth ノードへ HTTP JSON-RPC で問い合わせる薄いヘルパー。
// enode / devp2p / admin_nodeInfo / admin_peers といった Ethereum 固有の
// 語彙はこのファイル（ChainAdapter 実装の内側）に閉じ込め、ワールドステート
// には漏らさない。
//
// ピアの正準識別子（canonical identity）は「enode URL から抽出した
// 64 バイト公開鍵（小文字 16 進、0x なし）」とする。admin_nodeInfo /
// admin_peers の `id` フィールドはクライアント実装によって形式が揺れる
// （reth は 64 バイト peer id、geth は discv5 系の別形式になり得る）ため、
// 双方のレスポンスに必ず載る enode の公開鍵部を優先する。enode が
// 取れない場合のみ `id` を同じ表記（小文字・0x なし）へ正規化して使う。
// 自ノード側と相手側で識別子の形式が食い違った場合は対応表で解決されず
// エッジが落ちるだけで、誤ったエッジは生まれない（安全側に倒れる）。

import type { EthRpcClient } from "./eth-rpc-client.js";

/** enode URL の公開鍵部（128 桁 16 進）を抽出する正規表現。 */
const ENODE_PATTERN = /^enode:\/\/([0-9a-fA-F]{128})@/;

/** admin_nodeInfo レスポンスのうち、この機能が読む最小限のフィールド。 */
interface RawAdminNodeInfo {
  id?: unknown;
  enode?: unknown;
}

/** admin_peers レスポンスの 1 エントリのうち、この機能が読む最小限のフィールド。 */
interface RawAdminPeer {
  id?: unknown;
  enode?: unknown;
}

/**
 * enode URL（enode://<128 桁 16 進の公開鍵>@host:port）から公開鍵部を
 * 取り出し、小文字へ正規化して返す。形式が合わなければ undefined。
 */
export function enodePublicKey(enode: string): string | undefined {
  const match = ENODE_PATTERN.exec(enode);
  return match ? match[1].toLowerCase() : undefined;
}

/** `id` フィールドを enode 公開鍵と同じ表記（小文字・0x なし）へ正規化する。 */
function normalizeIdField(id: unknown): string | undefined {
  if (typeof id !== "string") return undefined;
  const stripped = id.startsWith("0x") ? id.slice(2) : id;
  if (!/^[0-9a-fA-F]+$/.test(stripped)) return undefined;
  return stripped.toLowerCase();
}

/**
 * enode（優先）と id（フォールバック）からピアの正準識別子を決める。
 * どちらからも取れなければ undefined。
 */
function peerIdentity(enode: unknown, id: unknown): string | undefined {
  if (typeof enode === "string") {
    const key = enodePublicKey(enode);
    if (key) return key;
  }
  return normalizeIdField(id);
}

/**
 * admin_nodeInfo のレスポンス（JSON-RPC result）から、自ノードの
 * 正準識別子を取り出す。取れなければ undefined
 * （呼び出し側でそのノードの観測を落とす）。
 */
export function normalizeAdminNodeInfo(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const info = raw as RawAdminNodeInfo;
  return peerIdentity(info.enode, info.id);
}

/**
 * admin_peers のレスポンス（JSON-RPC result、ピアの配列）から、接続相手の
 * 正準識別子一覧を取り出す。識別子を決められないエントリは黙って落とす
 * （観測対象外ピアと同様、エッジにならないだけで害がないため）。
 */
export function normalizeAdminPeers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const identities: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const peer = entry as RawAdminPeer;
    const identity = peerIdentity(peer.enode, peer.id);
    if (identity) identities.push(identity);
  }
  return identities;
}

/**
 * admin_nodeInfo を叩き、自ノードの正準識別子（enode 公開鍵）を取得する。
 * 識別子が決められないレスポンス（`admin` API 無効化などで形が崩れている）
 * の場合は例外を投げる。呼び出し側（pollPeersOnce）でそのノードだけ落として
 * 継続する設計のため、ここでは黙って undefined を返さずエラーとして伝える。
 */
export async function fetchExecutionPeerIdentity(
  rpc: EthRpcClient,
  rpcUrl: string,
): Promise<string> {
  const raw = await rpc.call<unknown>(rpcUrl, "admin_nodeInfo", []);
  const identity = normalizeAdminNodeInfo(raw);
  if (!identity) {
    throw new Error(
      `admin_nodeInfo on ${rpcUrl} did not yield a usable enode/id`,
    );
  }
  return identity;
}

/**
 * admin_peers を叩き、現在接続中の相手の正準識別子一覧を取得する。
 * 識別子を決められない個々のピアは normalizeAdminPeers 側で黙って落ちる
 * （観測対象外ピアと同様に扱い、エッジが増えないだけで害はないため）。
 */
export async function fetchConnectedExecutionPeerIdentities(
  rpc: EthRpcClient,
  rpcUrl: string,
): Promise<string[]> {
  const raw = await rpc.call<unknown>(rpcUrl, "admin_peers", []);
  return normalizeAdminPeers(raw);
}
