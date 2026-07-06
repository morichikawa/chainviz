import { describe, expect, it } from "vitest";
import {
  enodePublicKey,
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
});
