import type { MessageKey } from "../i18n/messages.js";

/**
 * 「eclipse攻撃のしくみ」デモ（Issue #416。`docs/worklog/issue-416.md`
 * UX設計 §3）の状態・純粋関数。実チェーン・実P2P接続から完全に独立した
 * 学習用の疑似データ（砂場）で、`hashChainDemo.ts`/`signatureDemo.ts` と
 * 同じく `packages/shared` の型には一切依存しない。
 *
 * 概念モデル: 中央の「被害ノード」が固定 {@link ECLIPSE_DEMO_SLOT_COUNT} 個の
 * 接続スロットを持つ。初期状態は全スロットが正規ピアで占められており、
 * ユーザーが「攻撃者ピアを追加」を押すたびに、固定順（スロット 0 → 7、
 * `EclipseAttackPeerGraph.tsx` の時計位置に対応）で次の正規ピアスロットが
 * 1つ攻撃者ピアに置き換わる。
 */
export type PeerSlotState = "honest" | "attacker";

/** 被害ノードの固定接続スロット数（UX設計 §2「例8個をそのまま確定値として採用」）。 */
export const ECLIPSE_DEMO_SLOT_COUNT = 8;

export interface EclipseAttackDemoState {
  /** 固定 {@link ECLIPSE_DEMO_SLOT_COUNT} 要素。インデックス = スロット順
   * （`EclipseAttackPeerGraph.tsx` の時計位置と対応する固定の乗っ取り順）。 */
  slots: readonly PeerSlotState[];
}

/** 初期状態: 全スロットが正規ピア（UX設計 §3「初期状態は8/8スロットすべてが正規ピア」）。 */
export function createInitialEclipseAttackDemoState(): EclipseAttackDemoState {
  return { slots: Array.from({ length: ECLIPSE_DEMO_SLOT_COUNT }, () => "honest" as const) };
}

/**
 * 「リセット」操作。閉じたら破棄する設計のため実質
 * `createInitialEclipseAttackDemoState()` の呼び直しと同じだが、呼び出し側
 * （View）の意図を明確にするため別名で公開する（`hashChainDemo.ts` の
 * `resetHashChainDemoState` と同じ流儀）。
 */
export function resetEclipseAttackDemoState(): EclipseAttackDemoState {
  return createInitialEclipseAttackDemoState();
}

/** 先頭から見て最初の正規ピアスロットのインデックス。無ければ `null`
 * （全スロットが既に攻撃者に占められている）。`addAttackerPeer` の対象決定と
 * View 側のフラッシュ対象インデックスの算出の両方で使う共通ロジック。 */
export function nextHonestSlotIndex(state: EclipseAttackDemoState): number | null {
  const index = state.slots.findIndex((slot) => slot === "honest");
  return index === -1 ? null : index;
}

/**
 * 「攻撃者ピアを追加」操作（UX設計 §3操作フロー2・3）。固定順で最初の正規
 * ピアスロットを攻撃者に置き換えた新state を返す。全スロットが既に攻撃者
 * なら何もしない（元の state をそのまま返す冪等な no-op。呼び出し側は
 * ボタンを disabled にして通常は到達させない設計だが、念のため安全側に倒す）。
 */
export function addAttackerPeer(state: EclipseAttackDemoState): EclipseAttackDemoState {
  const index = nextHonestSlotIndex(state);
  if (index === null) return state;
  return {
    slots: state.slots.map((slot, i) => (i === index ? "attacker" : slot)),
  };
}

/** 攻撃者ピアの数（導出値。state には持たない）。 */
export function attackerCount(state: EclipseAttackDemoState): number {
  return state.slots.filter((slot) => slot === "attacker").length;
}

/** 占有率 = 攻撃者ピア数 / スロット数。0〜1。 */
export function occupancyRatio(state: EclipseAttackDemoState): number {
  return attackerCount(state) / state.slots.length;
}

/**
 * 完全包囲判定。占有率が1（全スロットが攻撃者）に達した瞬間だけ true になる
 * （UX設計 §3: 「7/8のように100%未満のときは…正規の見え方のまま」という
 * 境界値）。
 */
export function isFullyEclipsed(state: EclipseAttackDemoState): boolean {
  return occupancyRatio(state) === 1;
}

/**
 * 「被害ノードが見ているチェーン」のブロック疑似データ3件（UX設計 §3
 * レイアウト5）。ハッシュ計算までは行わない（`hashChainDemo.ts` と違い、
 * このデモの「本物の計算」は占有率の算出と閾値判定そのもの。UX設計 §3
 * 状態モデルの補足）。内容は i18n メッセージキーとして messages.ts に持つ。
 */
export const REAL_CHAIN_BLOCK_KEYS: readonly MessageKey[] = [
  "eclipseDemo.block.real.1",
  "eclipseDemo.block.real.2",
  "eclipseDemo.block.real.3",
];

export const FAKE_CHAIN_BLOCK_KEYS: readonly MessageKey[] = [
  "eclipseDemo.block.fake.1",
  "eclipseDemo.block.fake.2",
  "eclipseDemo.block.fake.3",
];

/**
 * 被害ノードが現在見ているチェーンのブロックキー列。完全包囲時のみ偽データへ
 * 切り替わる（演出ではなく `isFullyEclipsed` の実計算から導出。UX設計 §3）。
 */
export function visibleChainBlockKeys(state: EclipseAttackDemoState): readonly MessageKey[] {
  return isFullyEclipsed(state) ? FAKE_CHAIN_BLOCK_KEYS : REAL_CHAIN_BLOCK_KEYS;
}
