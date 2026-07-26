import { keccak256Hex } from "../crypto-demo/keccak256.js";

/**
 * 「ロングレンジ攻撃」デモ（Issue #415。`docs/worklog/issue-415.md` UX設計）の
 * 疑似ブロック1件。`hashChainDemo`（Issue #401）の `HashChainDemoBlock` と同型
 * だが、この砂場ではユーザーがブロックの中身を編集することはない（動かせるのは
 * finality checkpoint の位置だけ）ため、`hash` を都度再計算するのではなく生成
 * 時に一度だけ導出して固定値として持たせる。
 */
export interface LongRangeAttackDemoBlock {
  /** 0始まり（genesis = 0）。UX設計 §2「genesis から始める」。 */
  number: number;
  /** 直前ブロックの導出ハッシュ（genesis のみ全ゼロ）。 */
  parentHash: string;
  /** 物語風の固定テキスト。3言語で分ける必要のない固有名詞主体のため
   * i18n 化はしない（`hashChainDemo.ts` の `SEED_DATA` と同じ判断）。 */
  data: string;
  /** 生成時に一度だけ導出したハッシュ。 */
  hash: string;
}

/** 起点ブロック（#0 = genesis）の parentHash。「親はいない」印。 */
export const GENESIS_PARENT_HASH = `0x${"0".repeat(64)}`;

/**
 * 攻撃者の履歴が正規チェーンと最初に異なるブロック番号（固定値。ユーザーは
 * 動かせない。UX設計 §2）。genesis（0）ではなくあえて2にすることで、
 * finality checkpoint を動かす操作に複数段階の行き来を持たせている
 * （checkpoint が0/1のときは未防御、2/3で防御に切り替わる）。
 */
export const DIVERGE_AT = 2;

/**
 * 正規チェーンの物語（送金風の例文。Issue #401 と同じ「Alice → Bob」系統）。
 * `#0` は genesis、`#1`〜`#3` が実際の送金を表す。
 */
const CANONICAL_SEED: readonly string[] = [
  "Genesis",
  "Alice → Bob: 5 ETH",
  "Bob → Carol: 2 ETH",
  "Carol → Dave: 1 ETH",
];

/**
 * 攻撃者が作り直した履歴（UX設計 §2「物語性」）。`#0`・`#1` は正規チェーンと
 * 完全に同じ文字列にすることで、同じ入力から同じハッシュが出る（＝共有区間）
 * ことを疑似データの時点で保証する。`#2` から「自分に残高を付け替える →
 * 換金する」という動機が伝わる文言にする。
 */
const ATTACKER_SEED: readonly string[] = [
  "Genesis",
  "Alice → Bob: 5 ETH",
  "Attacker → Attacker: 1,000,000 ETH",
  "Attacker → Exchange: 1,000,000 ETH",
  "Exchange → Attacker: 999,000 ETH",
];

/**
 * ブロックのハッシュを導出する。`hashChainDemo.ts` の `deriveBlockHash` と
 * 同じ簡略レシピ（`番号|親ハッシュ|データ` を keccak256）。ここでは呼び出し側
 * が既に確定した `parentHash` を渡す点だけが異なる（このデモのブロックは
 * 生成後に編集されないため、都度チェーンを辿って再計算する必要が無い）。
 */
function deriveHash(number: number, parentHash: string, data: string): string {
  return keccak256Hex(`${number}|${parentHash}|${data}`);
}

/**
 * 種データ（物語のテキスト列）から1本のチェーンを構築する。`#0` の親は
 * `GENESIS_PARENT_HASH`、以降は直前ブロックの導出ハッシュを親として連結する。
 *
 * 重要な性質: `CANONICAL_SEED` と `ATTACKER_SEED` は `#0`・`#1` が同じ文字列
 * のため、この関数を独立に2回呼んでも `#0`・`#1` の導出ハッシュは完全に一致
 * する（純粋関数なので同じ入力からは同じ出力になる。オブジェクトを使い回す
 * 必要はない）。
 */
function buildChain(seed: readonly string[]): LongRangeAttackDemoBlock[] {
  const blocks: LongRangeAttackDemoBlock[] = [];
  seed.forEach((data, number) => {
    const previous = blocks[number - 1];
    const parentHash = previous ? previous.hash : GENESIS_PARENT_HASH;
    blocks.push({ number, parentHash, data, hash: deriveHash(number, parentHash, data) });
  });
  return blocks;
}

/** 正規のチェーン（`#0`〜`#3`、4ブロック固定）。 */
export const CANONICAL_CHAIN: readonly LongRangeAttackDemoBlock[] = buildChain(CANONICAL_SEED);

/** 攻撃者が作り直した履歴（`#0`〜`#4`、5ブロック固定。常に正規より1つ長い）。 */
export const ATTACKER_CHAIN: readonly LongRangeAttackDemoBlock[] = buildChain(ATTACKER_SEED);

/** デモの状態。動かせるのは finality checkpoint（正規チェーンのどのブロック
 * まで確定しているか）だけ。ブロック本体（`CANONICAL_CHAIN`/`ATTACKER_CHAIN`）
 * はモジュール読み込み時に一度だけ導出済みの固定値で、state には含めない。 */
export interface LongRangeAttackDemoState {
  /** `CANONICAL_CHAIN` の中で「ここまで確定済み」とみなすブロック番号。
   * 初期値は0（genesis のみ確定済み）。 */
  checkpointIndex: number;
}

/** 初期状態（UX設計 §4 操作フロー1: 「まず既に危険な状態」から始める）。 */
export function createInitialLongRangeAttackDemoState(): LongRangeAttackDemoState {
  return { checkpointIndex: 0 };
}

/** 「最初に戻す」操作（UX設計 §3 の5番目）。checkpoint を初期値へ戻すだけで、
 * ブロック本体はそもそも state に含まれないため触らない。 */
export function resetLongRangeAttackDemoState(): LongRangeAttackDemoState {
  return createInitialLongRangeAttackDemoState();
}

/** finality checkpoint を動かす（UX設計 §4 操作フロー2）。 */
export function setCheckpoint(
  state: LongRangeAttackDemoState,
  checkpointIndex: number,
): LongRangeAttackDemoState {
  return { checkpointIndex };
}

/** 指定ブロック番号が checkpoint によって確定済みとみなされるか。 */
export function isFinalized(blockNumber: number, checkpointIndex: number): boolean {
  return blockNumber <= checkpointIndex;
}

/**
 * 素朴な「長い方を正しいとする」だけの fork choice ルール（UX設計 §5）。
 * 固定テキストの演出ではなく、実際に両チェーンの長さを比較する関数として
 * 実装する（将来ブロック数を変えても壊れないように、"attacker" を決め打ち
 * で返さない）。
 */
export function pickByNaiveLongestChainRule(
  canonicalLength: number,
  attackerLength: number,
): "canonical" | "attacker" {
  return attackerLength >= canonicalLength ? "attacker" : "canonical";
}

/**
 * finality を考慮した fork choice ルール（UX設計 §5）。checkpoint が分岐点
 * 以上まで進んでいれば、分岐点より前を書き換える攻撃者の履歴は拒否される。
 */
export function pickByFinalityAwareRule(
  checkpointIndex: number,
  divergeAtIndex: number,
): "canonical" | "attacker" {
  return checkpointIndex >= divergeAtIndex ? "canonical" : "attacker";
}

/**
 * ブロック番号Nの共有グリッド上でのタイル列（1始まり。CSS Grid の
 * `grid-column`）。列1はラベル列に予約するため、ブロック1つにつき
 * タイル列+コネクタ列の2列を消費する（UX設計 §3「3段は同じ列位置に揃える」）。
 * 正規/checkpoint/攻撃者の3段すべてがこの同じ関数で列を決めるため、同じ
 * ブロック番号は必ず同じ列に並ぶ。
 */
export function tileGridColumn(blockNumber: number): number {
  return 2 + blockNumber * 2;
}

/** ブロック番号Nのタイルから、その次のブロックへ向かう連結線の列。 */
export function connectorGridColumnAfter(blockNumber: number): number {
  return tileGridColumn(blockNumber) + 1;
}
