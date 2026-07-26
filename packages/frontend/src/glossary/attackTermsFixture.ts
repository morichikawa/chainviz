// テスト専用の支援モジュール（アプリ本体からは import しない）。攻撃手法解説の
// 土台（ARCHITECTURE.md §17.3、Issue #413）で新設した6語と、その期待される
// `layer` 値を1箇所に置く。用語データ側のテストが複数ファイルに分かれている
// （スキーマ・relatedTerms・文言・配置・検索到達性）ため、対象キーの一覧が
// ファイルごとに書き写されて片方だけ更新される状態を避ける。
import type { GlossaryFileName } from "./realGlossaryFixture.js";

/** Issue #413 で新設した用語キー（YAML の記載順）。 */
export const ATTACK_TERM_KEYS = [
  "fiftyOnePercentAttack",
  "longRangeAttack",
  "eclipseAttack",
  "reorg",
  "doubleSpend",
  "frontRunning",
] as const;

export type AttackTermKey = (typeof ATTACK_TERM_KEYS)[number];

/**
 * 各語の `layer` 値と、その語が定義されているべき YAML ファイル。
 * 用語データでは両者が一致している必要がある（`layer: b-network` の語が
 * `c-transaction.yaml` に紛れ込んでいると、用語集パネルの層グループと
 * ファイル分割の意味が食い違う）。
 */
export const EXPECTED_ATTACK_TERM_PLACEMENT: Record<
  AttackTermKey,
  { layer: string; file: GlossaryFileName }
> = {
  fiftyOnePercentAttack: { layer: "b-network", file: "b-network" },
  longRangeAttack: { layer: "b-network", file: "b-network" },
  eclipseAttack: { layer: "b-network", file: "b-network" },
  reorg: { layer: "b-network", file: "b-network" },
  doubleSpend: { layer: "c-transaction", file: "c-transaction" },
  frontRunning: { layer: "c-transaction", file: "c-transaction" },
};
