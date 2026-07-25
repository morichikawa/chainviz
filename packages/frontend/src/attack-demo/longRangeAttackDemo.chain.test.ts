// 疑似データ（CANONICAL_CHAIN/ATTACKER_CHAIN）の形とハッシュの性質
// （Issue #415。`docs/worklog/issue-415.md` UX設計 §10「テスト観点」）。
// state・fork choice ルール・グリッド列計算は別ファイルが扱う
// （CLAUDE.md の1ファイル1責務）。
import { describe, expect, it } from "vitest";
import {
  ATTACKER_CHAIN,
  CANONICAL_CHAIN,
  DIVERGE_AT,
  GENESIS_PARENT_HASH,
} from "./longRangeAttackDemo.js";

describe("CANONICAL_CHAIN / ATTACKER_CHAIN: shape", () => {
  it("has 4 blocks (#0-#3) in the canonical chain", () => {
    expect(CANONICAL_CHAIN.map((b) => b.number)).toEqual([0, 1, 2, 3]);
  });

  it("has 5 blocks (#0-#4) in the attacker chain — always one longer than canonical", () => {
    expect(ATTACKER_CHAIN.map((b) => b.number)).toEqual([0, 1, 2, 3, 4]);
    expect(ATTACKER_CHAIN.length).toBe(CANONICAL_CHAIN.length + 1);
  });

  it("starts both chains from the same genesis parent hash", () => {
    expect(CANONICAL_CHAIN[0]!.parentHash).toBe(GENESIS_PARENT_HASH);
    expect(ATTACKER_CHAIN[0]!.parentHash).toBe(GENESIS_PARENT_HASH);
  });
});

describe("CANONICAL_CHAIN / ATTACKER_CHAIN: shared prefix hashes match", () => {
  it("produces an identical hash for #0 on both chains (same genesis)", () => {
    expect(ATTACKER_CHAIN[0]!.hash).toBe(CANONICAL_CHAIN[0]!.hash);
  });

  it("produces an identical hash for #1 on both chains (shared history before the divergence point)", () => {
    expect(ATTACKER_CHAIN[1]!.hash).toBe(CANONICAL_CHAIN[1]!.hash);
  });

  it("chains each block's parentHash to the previous block's hash", () => {
    for (const chain of [CANONICAL_CHAIN, ATTACKER_CHAIN]) {
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i]!.parentHash).toBe(chain[i - 1]!.hash);
      }
    }
  });
});

describe("CANONICAL_CHAIN / ATTACKER_CHAIN: diverge at DIVERGE_AT", () => {
  it("has DIVERGE_AT set to 2 (matches the UX design's fixed divergence point)", () => {
    expect(DIVERGE_AT).toBe(2);
  });

  it("produces a different hash for #2 onward on the two chains (different data)", () => {
    for (let number = DIVERGE_AT; number < CANONICAL_CHAIN.length; number++) {
      expect(ATTACKER_CHAIN[number]!.hash).not.toBe(CANONICAL_CHAIN[number]!.hash);
      expect(ATTACKER_CHAIN[number]!.data).not.toBe(CANONICAL_CHAIN[number]!.data);
    }
  });

  it("gives every block a well-formed 0x + 64 hex char hash", () => {
    for (const block of [...CANONICAL_CHAIN, ...ATTACKER_CHAIN]) {
      expect(block.hash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
