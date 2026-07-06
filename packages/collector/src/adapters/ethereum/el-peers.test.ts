import { describe, expect, it } from "vitest";
import type { EthRpcClient } from "./eth-rpc-client.js";
import {
  enodePublicKey,
  fetchConnectedExecutionPeerIdentities,
  fetchExecutionPeerIdentity,
  normalizeAdminNodeInfo,
  normalizeAdminPeers,
} from "./el-peers.js";

// 128 桁 16 進の公開鍵サンプル（大文字混在で正規化を確認する）。
const PUBKEY_UPPER = "AB".repeat(64);
const PUBKEY_LOWER = "ab".repeat(64);
const ENODE = `enode://${PUBKEY_UPPER}@172.28.1.1:30303`;

describe("enodePublicKey", () => {
  it("extracts the 128-hex public key and lowercases it", () => {
    expect(enodePublicKey(ENODE)).toBe(PUBKEY_LOWER);
  });

  it("returns undefined for a URL that is not an enode", () => {
    expect(enodePublicKey("http://172.28.1.1:8545")).toBeUndefined();
  });

  it("returns undefined when the key part has the wrong length", () => {
    expect(enodePublicKey("enode://abcd@172.28.1.1:30303")).toBeUndefined();
  });

  it("returns undefined when the key part is not hex", () => {
    const bad = `enode://${"zz".repeat(64)}@172.28.1.1:30303`;
    expect(enodePublicKey(bad)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(enodePublicKey("")).toBeUndefined();
  });

  it("returns undefined when the key is one hex short of 128", () => {
    // 境界値: 127 桁は不足として弾く。
    const short = `enode://${"a".repeat(127)}@172.28.1.1:30303`;
    expect(enodePublicKey(short)).toBeUndefined();
  });

  it("returns undefined when the key is one hex over 128", () => {
    // 境界値: 129 桁は 128 桁目の直後が @ でないため一致しない。
    const long = `enode://${"a".repeat(129)}@172.28.1.1:30303`;
    expect(enodePublicKey(long)).toBeUndefined();
  });

  it("returns undefined when the @host separator is missing", () => {
    // 公開鍵長は正しくても host 区切りの @ が無ければ enode として扱わない。
    expect(enodePublicKey(`enode://${PUBKEY_LOWER}`)).toBeUndefined();
  });

  it("is case-sensitive on the enode scheme literal", () => {
    // スキーム部は小文字 enode のみ受け付ける（大文字は一致しない）。
    expect(enodePublicKey(`ENODE://${PUBKEY_LOWER}@172.28.1.1:30303`)).toBeUndefined();
  });

  it("returns undefined when there is leading whitespace", () => {
    // 先頭アンカー (^) のため前置の空白があると一致しない。
    expect(enodePublicKey(` enode://${PUBKEY_LOWER}@172.28.1.1:30303`)).toBeUndefined();
  });

  it("does not accept a 0x-prefixed public key in the enode URL", () => {
    // enode の公開鍵部に 0x を付けると 'x' が 16 進として不正で一致しない
    // （実際の enode URL は 0x を付けない表記なので安全側に落ちる）。
    expect(
      enodePublicKey(`enode://0x${PUBKEY_LOWER}@172.28.1.1:30303`),
    ).toBeUndefined();
  });
});

describe("normalizeAdminNodeInfo", () => {
  it("prefers the public key extracted from the enode URL", () => {
    // id と enode の公開鍵が食い違っても enode 側を採用する。
    const raw = { id: "ff".repeat(64), enode: ENODE };
    expect(normalizeAdminNodeInfo(raw)).toBe(PUBKEY_LOWER);
  });

  it("falls back to the id field when the enode is missing", () => {
    const raw = { id: `0x${PUBKEY_UPPER}` };
    expect(normalizeAdminNodeInfo(raw)).toBe(PUBKEY_LOWER);
  });

  it("falls back to the id field when the enode is malformed", () => {
    const raw = { id: PUBKEY_UPPER, enode: "enode://broken@host" };
    expect(normalizeAdminNodeInfo(raw)).toBe(PUBKEY_LOWER);
  });

  it("returns undefined when neither enode nor id is usable", () => {
    expect(normalizeAdminNodeInfo({ id: 42, enode: 1 })).toBeUndefined();
    expect(normalizeAdminNodeInfo({})).toBeUndefined();
  });

  it("returns undefined for non-object results", () => {
    expect(normalizeAdminNodeInfo(null)).toBeUndefined();
    expect(normalizeAdminNodeInfo("enode://...")).toBeUndefined();
  });

  it("rejects an id field that is not hex", () => {
    expect(normalizeAdminNodeInfo({ id: "not-hex" })).toBeUndefined();
  });

  it("rejects an id whose prefix is uppercase 0X (only lowercase 0x is stripped)", () => {
    // 0X（大文字）は接頭辞として剥がされず、残る 'X' が 16 進として不正になる。
    expect(normalizeAdminNodeInfo({ id: `0X${PUBKEY_UPPER}` })).toBeUndefined();
  });

  it("rejects an empty id string", () => {
    expect(normalizeAdminNodeInfo({ id: "" })).toBeUndefined();
  });

  it("rejects an id that is only the 0x prefix with no digits", () => {
    expect(normalizeAdminNodeInfo({ id: "0x" })).toBeUndefined();
  });

  it("ignores an empty-string enode and falls back to a usable id", () => {
    // enode が空文字でも例外にはせず、id 側で解決できればそれを使う。
    expect(normalizeAdminNodeInfo({ enode: "", id: PUBKEY_UPPER })).toBe(
      PUBKEY_LOWER,
    );
  });
});

describe("normalizeAdminPeers", () => {
  it("extracts identities from each peer's enode URL", () => {
    const other = "cd".repeat(64);
    const raw = [
      { id: "x", enode: ENODE },
      { id: "y", enode: `enode://${other}@172.28.1.2:30303` },
    ];
    expect(normalizeAdminPeers(raw)).toEqual([PUBKEY_LOWER, other]);
  });

  it("falls back to the id field for entries without a usable enode", () => {
    const raw = [{ id: `0x${PUBKEY_UPPER}` }];
    expect(normalizeAdminPeers(raw)).toEqual([PUBKEY_LOWER]);
  });

  it("silently drops entries whose identity cannot be determined", () => {
    const raw = [
      { name: "no-id" },
      null,
      "not-an-object",
      { id: "not-hex", enode: "enode://broken@host" },
      { id: "x", enode: ENODE },
    ];
    expect(normalizeAdminPeers(raw)).toEqual([PUBKEY_LOWER]);
  });

  it("returns an empty list when the result is not an array", () => {
    expect(normalizeAdminPeers(null)).toEqual([]);
    expect(normalizeAdminPeers({})).toEqual([]);
    expect(normalizeAdminPeers(undefined)).toEqual([]);
  });

  it("returns an empty list for an empty peers array", () => {
    expect(normalizeAdminPeers([])).toEqual([]);
  });

  it("preserves duplicate identities when the same peer appears twice", () => {
    // 重複排除は下流の toPeerEdges の責務なので、正規化段では重複を残す。
    const raw = [
      { enode: ENODE },
      { id: `0x${PUBKEY_UPPER}` }, // enode と同じ公開鍵を id 経由で再登場させる
    ];
    expect(normalizeAdminPeers(raw)).toEqual([PUBKEY_LOWER, PUBKEY_LOWER]);
  });

  it("includes the caller's own identity if the node reports itself as a peer", () => {
    // admin_peers に自分自身が混ざる異常系でも正規化段では落とさない
    // （自己ループの除去は toPeerEdges が担うため、ここでは素直に含める）。
    const self = "ee".repeat(64);
    const raw = [{ enode: `enode://${self.toUpperCase()}@172.28.1.1:30303` }];
    expect(normalizeAdminPeers(raw)).toEqual([self]);
  });

  it("mixes enode-derived and id-fallback identities across entries", () => {
    const other = "cd".repeat(64);
    const raw = [
      { enode: ENODE }, // enode 由来
      { id: `0x${other.toUpperCase()}` }, // id フォールバック
    ];
    expect(normalizeAdminPeers(raw)).toEqual([PUBKEY_LOWER, other]);
  });
});

/** call() を method ごとに固定レスポンス/例外へ差し込める最小の EthRpcClient。 */
function stubRpc(byMethod: Record<string, unknown>): EthRpcClient {
  return {
    async call<T>(_url: string, method: string): Promise<T> {
      if (!(method in byMethod)) {
        throw new Error(`unexpected method ${method}`);
      }
      const value = byMethod[method];
      if (value instanceof Error) throw value;
      return value as T;
    },
  };
}

describe("fetchExecutionPeerIdentity", () => {
  it("calls admin_nodeInfo and normalizes the result", async () => {
    const rpc = stubRpc({ admin_nodeInfo: { enode: ENODE } });
    await expect(
      fetchExecutionPeerIdentity(rpc, "http://172.28.1.1:8545"),
    ).resolves.toBe(PUBKEY_LOWER);
  });

  it("propagates a transport-level failure (e.g. admin API disabled)", async () => {
    const rpc = stubRpc({ admin_nodeInfo: new Error("method not found") });
    await expect(
      fetchExecutionPeerIdentity(rpc, "http://172.28.1.1:8545"),
    ).rejects.toThrow("method not found");
  });

  it("throws when admin_nodeInfo yields no usable enode/id", async () => {
    const rpc = stubRpc({ admin_nodeInfo: {} });
    await expect(
      fetchExecutionPeerIdentity(rpc, "http://172.28.1.1:8545"),
    ).rejects.toThrow(/did not yield a usable enode\/id/);
  });
});

describe("fetchConnectedExecutionPeerIdentities", () => {
  it("calls admin_peers and normalizes the resulting identities", async () => {
    const other = "cd".repeat(64);
    const rpc = stubRpc({
      admin_peers: [{ enode: `enode://${other}@172.28.1.2:30303` }],
    });
    await expect(
      fetchConnectedExecutionPeerIdentities(rpc, "http://172.28.1.1:8545"),
    ).resolves.toEqual([other]);
  });

  it("propagates a transport-level failure", async () => {
    const rpc = stubRpc({ admin_peers: new Error("timeout") });
    await expect(
      fetchConnectedExecutionPeerIdentities(rpc, "http://172.28.1.1:8545"),
    ).rejects.toThrow("timeout");
  });

  it("returns an empty list when there are no peers", async () => {
    const rpc = stubRpc({ admin_peers: [] });
    await expect(
      fetchConnectedExecutionPeerIdentities(rpc, "http://172.28.1.1:8545"),
    ).resolves.toEqual([]);
  });
});
