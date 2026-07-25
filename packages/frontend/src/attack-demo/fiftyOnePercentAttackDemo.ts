/**
 * 「51%攻撃のしくみ」デモ（Issue #414。`docs/worklog/issue-414.md` UX設計・
 * `docs/ARCHITECTURE.md` §17.5.1）の疑似データと判定ロジック。実チェーンの
 * バリデーター（`packages/shared` のワールドステート）とは無関係の、完全に
 * 独立した学習用データ（`crypto-demo/hashChainDemo.ts` と同型の砂場）。
 */

/**
 * バリデーター総数。7人固定（UX設計 §2）。
 *
 * この値は「実チェーンで観測されたバリデーター数」ではなく、学習用砂場の
 * 疑似データの人数を表す固定値であり、実行環境の状態（稼働時間・実際の
 * バリデーターセット等）に依存しないため、CLAUDE.md の「今この瞬間に
 * 観測できる状態に依存した固定値を埋め込まない」ルールの対象外（そもそも
 * 実データを参照していない）。奇数にすることで多数決に同数（引き分け）が
 * 発生せず、判定ロジックが単純になる（UX設計 §2）。
 */
export const TOTAL_VALIDATORS = 7;

/** バリデーターの識別子（1〜TOTAL_VALIDATORS）。表示順もこの並びに従う。 */
export const VALIDATOR_IDS: readonly number[] = Array.from(
  { length: TOTAL_VALIDATORS },
  (_, index) => index + 1,
);

/** 2つの候補ブランチ。枝A = もとの正しいチェーン、枝B = 攻撃者が押し通したいチェーン。 */
export type Branch = "a" | "b";

/**
 * デモの状態。パネルを開いた瞬間から閉じるまでのローカル state
 * （UX設計 §6。`SidePanelHost` 側には持たせない）。
 *
 * 「どのバリデーターか」という識別子を捨てて人数だけを持つ設計にはしない
 * （UX設計 §6「個体の同一性」要件。同じ V1〜V7 が両陣営間を移動する見た目を
 * 保つため）。
 */
export interface FiftyOnePercentAttackDemoState {
  /** 攻撃者が支配している（枝Bを支持している）バリデーターの id 集合。 */
  attackerValidatorIds: ReadonlySet<number>;
}

/** 初期状態: 全員誠実（枝Aを支持）、攻撃者0人（UX設計 §2）。 */
export function createInitialFiftyOnePercentAttackDemoState(): FiftyOnePercentAttackDemoState {
  return { attackerValidatorIds: new Set() };
}

/**
 * 「最初に戻す」操作。閉じたら破棄する設計のため実質
 * `createInitialFiftyOnePercentAttackDemoState()` の呼び直しと同じだが、
 * 呼び出し側（View）の意図を明確にするため別名で公開する
 * （`hashChainDemo.ts` の `resetHashChainDemoState` と同じ流儀）。
 */
export function resetFiftyOnePercentAttackDemoState(): FiftyOnePercentAttackDemoState {
  return createInitialFiftyOnePercentAttackDemoState();
}

/**
 * 指定バリデーターの支配者を反転する（誠実 ⇔ 攻撃者）。範囲外の id は
 * 防御的に no-op（元の state をそのまま返す。呼び出し側の境界ミスで意図しない
 * 変化を起こさないため）。
 */
export function toggleValidator(
  state: FiftyOnePercentAttackDemoState,
  id: number,
): FiftyOnePercentAttackDemoState {
  if (!VALIDATOR_IDS.includes(id)) return state;
  const next = new Set(state.attackerValidatorIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return { attackerValidatorIds: next };
}

/** 枝Bの重み（攻撃者が支配するバリデーター数）。 */
export function weightOfBranchB(state: FiftyOnePercentAttackDemoState): number {
  return state.attackerValidatorIds.size;
}

/** 枝Aの重み（誠実なバリデーター数）。 */
export function weightOfBranchA(state: FiftyOnePercentAttackDemoState): number {
  return TOTAL_VALIDATORS - weightOfBranchB(state);
}

/** 指定ブランチの重み。 */
export function weightOfBranch(state: FiftyOnePercentAttackDemoState, branch: Branch): number {
  return branch === "a" ? weightOfBranchA(state) : weightOfBranchB(state);
}

/**
 * 指定ブランチを現在支持しているバリデーター id を昇順で返す（UX設計 §3
 * 「トグルボタン自体がそのバリデーターの現在の投票先を表す配置」）。
 */
export function branchValidatorIds(
  state: FiftyOnePercentAttackDemoState,
  branch: Branch,
): number[] {
  return VALIDATOR_IDS.filter((id) =>
    branch === "b" ? state.attackerValidatorIds.has(id) : !state.attackerValidatorIds.has(id),
  );
}

/**
 * fork choice の簡略化ルール（本物の判定ロジック。UX設計 §3・
 * ARCHITECTURE.md §17.5.1）: 重みの合計が大きい枝が canonical になる。
 * 7人固定（奇数）のため同数は理論上発生しないが、念のため同数なら枝Aを
 * 優先する決定的な規則にしておく。
 */
export function canonicalBranch(state: FiftyOnePercentAttackDemoState): Branch {
  return weightOfBranchB(state) > weightOfBranchA(state) ? "b" : "a";
}

/** 枝Bが既に逆転済み（canonical）かどうかの判定結果。 */
export type MarginToFlip =
  | { flipped: true }
  | {
      flipped: false;
      /** 枝Bが逆転する（canonicalになる）までに、さらに攻撃者へ寝返る必要がある人数。 */
      count: number;
    };

/**
 * 枝Bが逆転するまでの必要人数（UX設計 §3「逆転ラインのヒント文」）。
 * 現在の攻撃者数を n とすると、枝Aの重みは (TOTAL_VALIDATORS - n)、枝Bの
 * 重みは n。あと k 人が寝返ると枝Aは (TOTAL_VALIDATORS - n - k)、枝Bは
 * (n + k) になり、(n + k) > (TOTAL_VALIDATORS - n - k) を満たす最小の
 * 正の整数 k を返す。
 */
export function marginToFlip(state: FiftyOnePercentAttackDemoState): MarginToFlip {
  if (canonicalBranch(state) === "b") return { flipped: true };
  const a = weightOfBranchA(state);
  const b = weightOfBranchB(state);
  const diff = a - b; // > 0（flipped でないため）
  const count = Math.floor(diff / 2) + 1;
  return { flipped: false, count };
}
