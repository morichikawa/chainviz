// 疑似データ（CANONICAL_CHAIN/ATTACKER_CHAIN）の構造的な整合性の補強テスト
// （Issue #415 テスト強化）。形と共有ハッシュの基本ケースは
// longRangeAttackDemo.chain.test.ts が扱う。ここは以下を固定する:
//   - ハッシュの導出レシピ（`番号|親ハッシュ|データ` の keccak256）そのもの
//   - 分岐が共有区間の末尾（#1）に正しくぶら下がっていること
//   - 分岐が以降のブロックへ伝播していること（親ハッシュまで違う）
//   - 攻撃者チェーンが正規チェーンの先端を追い越していること（0件境界）
//   - 重複するハッシュの数が共有区間の長さ（DIVERGE_AT）とちょうど一致すること
//   - 公開関数を呼んでも固定データが書き換わらないこと
// （CLAUDE.md の1ファイル1責務。基本テストの肥大化を避けるため分割）。
import { describe, expect, it } from "vitest";
import { keccak256Hex } from "../crypto-demo/keccak256.js";
import {
  ATTACKER_CHAIN,
  CANONICAL_CHAIN,
  DIVERGE_AT,
  GENESIS_PARENT_HASH,
  connectorGridColumnAfter,
  createInitialLongRangeAttackDemoState,
  isFinalized,
  pickByFinalityAwareRule,
  pickByNaiveLongestChainRule,
  resetLongRangeAttackDemoState,
  setCheckpoint,
  tileGridColumn,
} from "./longRangeAttackDemo.js";

const BOTH_CHAINS = [
  { name: "canonical", chain: CANONICAL_CHAIN },
  { name: "attacker", chain: ATTACKER_CHAIN },
] as const;

describe("hash derivation recipe", () => {
  // 「簡略レシピ（`番号|親ハッシュ|データ` を keccak256）」という説明が
  // 実装と食い違ったら、砂場の説明そのものが嘘になる。両チェーンの全
  // ブロックで実際に再計算して一致を確認する。
  it.each(BOTH_CHAINS)("derives every $name block hash from number|parentHash|data", ({ chain }) => {
    for (const block of chain) {
      expect(block.hash).toBe(keccak256Hex(`${block.number}|${block.parentHash}|${block.data}`));
    }
  });

  it("gives every block a non-empty story text", () => {
    for (const { chain } of BOTH_CHAINS) {
      for (const block of chain) {
        expect(block.data.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("genesis anchor", () => {
  it("uses 0x + 64 zeros as the 'no parent' marker", () => {
    expect(GENESIS_PARENT_HASH).toBe(`0x${"0".repeat(64)}`);
  });

  it("uses the genesis marker as a parent only for #0 on each chain", () => {
    for (const { chain } of BOTH_CHAINS) {
      const usingGenesisMarker = chain
        .filter((block) => block.parentHash === GENESIS_PARENT_HASH)
        .map((block) => block.number);
      expect(usingGenesisMarker).toEqual([0]);
    }
  });

  it("never derives a block hash that collides with the genesis marker", () => {
    for (const { chain } of BOTH_CHAINS) {
      for (const block of chain) {
        expect(block.hash).not.toBe(GENESIS_PARENT_HASH);
      }
    }
  });
});

describe("fork point structure", () => {
  it("makes the shared prefix blocks identical field by field (#0 .. DIVERGE_AT - 1)", () => {
    for (let number = 0; number < DIVERGE_AT; number++) {
      expect(ATTACKER_CHAIN[number]).toEqual(CANONICAL_CHAIN[number]);
    }
  });

  it("attaches the attacker's first rewritten block to the last shared block", () => {
    // 分岐後のブロックの親は「共有区間の末尾（#1）」であること。ここが
    // 崩れると「同じ genesis から始まった別の履歴」という前提が壊れる。
    // なお表示上この位置の連結線は破線にしてあるが（分岐点の目印）、
    // 親子のハッシュ連結そのものは正しく繋がっている。
    expect(ATTACKER_CHAIN[DIVERGE_AT]!.parentHash).toBe(CANONICAL_CHAIN[DIVERGE_AT - 1]!.hash);
    expect(ATTACKER_CHAIN[DIVERGE_AT]!.parentHash).toBe(ATTACKER_CHAIN[DIVERGE_AT - 1]!.hash);
  });

  it("propagates the divergence to every later block's parentHash, not just its own hash", () => {
    // ハッシュチェーンの性質: 1箇所違えば以降すべて違う。#2 の hash だけ
    // でなく #3 の parentHash まで食い違うことを確認する。
    for (let number = DIVERGE_AT + 1; number < CANONICAL_CHAIN.length; number++) {
      expect(ATTACKER_CHAIN[number]!.parentHash).not.toBe(CANONICAL_CHAIN[number]!.parentHash);
    }
  });

  it("keeps exactly DIVERGE_AT hashes shared between the two chains and all others distinct", () => {
    // 「共有区間だけが重複、それ以外は全部別」を件数で固定する。分岐点を
    // 動かしたり物語文言を書き換えたときに、意図せず共有区間が伸び縮み
    // していれば落ちる。
    const allHashes = [...CANONICAL_CHAIN, ...ATTACKER_CHAIN].map((block) => block.hash);
    const uniqueHashes = new Set(allHashes);
    expect(allHashes.length - uniqueHashes.size).toBe(DIVERGE_AT);
  });
});

describe("chain length relationship (the naive rule's premise)", () => {
  it("extends the attacker's history exactly one block past the canonical tip", () => {
    const canonicalTip = CANONICAL_CHAIN[CANONICAL_CHAIN.length - 1]!;
    const attackerTip = ATTACKER_CHAIN[ATTACKER_CHAIN.length - 1]!;
    expect(attackerTip.number).toBe(canonicalTip.number + 1);
  });

  it("has no canonical counterpart for the attacker's tip block (0件境界)", () => {
    // 「同じ番号のライバル」が存在しない領域。UI 側でこの番号の正規タイル・
    // checkpoint チップを描こうとすると undefined 参照になるため、
    // 前提として固定する。
    expect(CANONICAL_CHAIN[ATTACKER_CHAIN.length - 1]).toBeUndefined();
    expect(
      CANONICAL_CHAIN.some((block) => block.number === ATTACKER_CHAIN.length - 1),
    ).toBe(false);
  });
});

describe("fixed data is never rewritten by the exported functions", () => {
  it("leaves both chains byte-identical after exercising every exported function", () => {
    // ブロック本体は state に含めず「モジュール読み込み時に一度だけ導出した
    // 固定値」という設計。将来どれかの関数がうっかりチェーンへ書き込んだら
    // 気付けるように、全関数を通した前後で丸ごと比較する。
    const before = JSON.stringify({ canonical: CANONICAL_CHAIN, attacker: ATTACKER_CHAIN });

    let state = createInitialLongRangeAttackDemoState();
    for (let index = -1; index <= ATTACKER_CHAIN.length; index++) {
      state = setCheckpoint(state, index);
      isFinalized(index, state.checkpointIndex);
      pickByNaiveLongestChainRule(CANONICAL_CHAIN.length, ATTACKER_CHAIN.length);
      pickByFinalityAwareRule(state.checkpointIndex, DIVERGE_AT);
      tileGridColumn(index);
      connectorGridColumnAfter(index);
    }
    resetLongRangeAttackDemoState();

    expect(JSON.stringify({ canonical: CANONICAL_CHAIN, attacker: ATTACKER_CHAIN })).toBe(before);
  });
});
