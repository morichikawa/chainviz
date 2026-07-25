import { useState } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { withTermAnchor } from "../glossary/withTermAnchor.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { LongRangeChainRow, type LongRangeTileVariant } from "./LongRangeChainRow.js";
import {
  ATTACKER_CHAIN,
  CANONICAL_CHAIN,
  DIVERGE_AT,
  createInitialLongRangeAttackDemoState,
  isFinalized,
  pickByFinalityAwareRule,
  pickByNaiveLongestChainRule,
  resetLongRangeAttackDemoState,
  setCheckpoint,
  tileGridColumn,
  type LongRangeAttackDemoBlock,
  type LongRangeAttackDemoState,
} from "./longRangeAttackDemo.js";

/** 攻撃者チェーンの最後尾のブロック番号（`longRangeDemo.verdict.naiveResult`
 * の `{attackerMax}` に差し込む値）。固定データのためモジュールスコープで
 * 一度だけ求める。 */
const ATTACKER_MAX_NUMBER = ATTACKER_CHAIN[ATTACKER_CHAIN.length - 1]!.number;

/**
 * 「ロングレンジ攻撃」デモの中身（`kind: "longRangeAttackDemo"`。Issue #415。
 * `docs/worklog/issue-415.md` UX設計）。
 *
 * `HashChainDemoView`/`SignatureDemoView` と同じく、状態はこのコンポーネント
 * ローカルの `useState` で完結する（パネルを閉じて開き直すと必ず
 * `createInitialLongRangeAttackDemoState()` から始まる）。動かせるのは
 * finality checkpoint（`state.checkpointIndex`）だけで、ブロック本体
 * （`CANONICAL_CHAIN`/`ATTACKER_CHAIN`）はモジュール読み込み時に一度だけ
 * 導出済みの固定値（`longRangeAttackDemo.ts`）。
 */
export function LongRangeAttackDemoView() {
  const { t, lang } = useLanguage();
  const [state, setState] = useState<LongRangeAttackDemoState>(
    createInitialLongRangeAttackDemoState,
  );

  // 素朴な最長チェーンルールは checkpoint に関わらず常に一定（攻撃者の履歴が
  // 常に1ブロック長い疑似データのため）。演出の固定文言ではなく、実際に
  // 両チェーンの長さを比較する関数の戻り値をそのまま表示に使う。
  const naiveVerdict = pickByNaiveLongestChainRule(CANONICAL_CHAIN.length, ATTACKER_CHAIN.length);
  const finalityVerdict = pickByFinalityAwareRule(state.checkpointIndex, DIVERGE_AT);
  const protectedByFinality = finalityVerdict === "canonical";

  function canonicalVariant(block: LongRangeAttackDemoBlock): LongRangeTileVariant {
    return isFinalized(block.number, state.checkpointIndex) ? "finalized" : "plain";
  }

  function attackerVariant(block: LongRangeAttackDemoBlock): LongRangeTileVariant {
    return block.number >= DIVERGE_AT ? "fork" : "plain";
  }

  function handleCheckpointChange(checkpointIndex: number) {
    setState((prev) => setCheckpoint(prev, checkpointIndex));
  }

  function handleReset() {
    setState(resetLongRangeAttackDemoState());
  }

  return (
    <div className="long-range-demo" data-testid="long-range-demo">
      {/* naiveVerdict は常に "attacker"（疑似データの前提上）。演出ではなく
          実計算の結果であることを示すため、値をそのまま使う（決め打ち文言に
          しない）。将来ブロック数の前提が変わっても、この行は再計算に追従する。 */}
      <p className="long-range-demo__intro" data-naive-verdict={naiveVerdict}>
        {t("longRangeDemo.intro")}
      </p>
      <div className="long-range-demo__diagram">
        <div className="long-range-demo__scroll" data-testid="long-range-demo-scroll">
          <div className="long-range-demo__grid" data-testid="long-range-demo-grid">
            <LongRangeChainRow
              rowLabel={t("longRangeDemo.canonicalLabel")}
              gridRow={1}
              blocks={CANONICAL_CHAIN}
              variantFor={canonicalVariant}
              finalizedBadgeLabel={
                <GlossaryTerm termKey="longRangeAttack">
                  {t("longRangeDemo.finalizedBadge")}
                </GlossaryTerm>
              }
              testIdPrefix="long-range-demo-canonical"
            />
            <div
              className="long-range-demo__checkpoint-heading"
              style={{ gridRow: 2, gridColumn: "1 / -1" }}
            >
              {/* UX設計 §7: 独立の `finality` glossary エントリを新設しない場合の
                  代替として、「確定(finality)」の説明を `longRangeAttack` へ
                  フォールバックしてアンカーする。ja/en で一致する部分文字列が
                  異なる（ja「確定(finality)」・en「finality」）ため言語ごとに
                  切り替える。 */}
              {withTermAnchor(
                t("longRangeDemo.checkpointHeading"),
                lang === "ja" ? "確定(finality)" : "finality",
                "longRangeAttack",
              )}
            </div>
            {CANONICAL_CHAIN.map((block) => (
              <div
                key={block.number}
                className="long-range-demo__checkpoint-cell"
                style={{ gridRow: 3, gridColumn: tileGridColumn(block.number) }}
              >
                <button
                  type="button"
                  className={
                    state.checkpointIndex === block.number
                      ? "long-range-demo__checkpoint-chip long-range-demo__checkpoint-chip--active"
                      : "long-range-demo__checkpoint-chip"
                  }
                  aria-pressed={state.checkpointIndex === block.number}
                  onClick={() => handleCheckpointChange(block.number)}
                  data-testid={`long-range-demo-checkpoint-${block.number}`}
                >
                  {format(t("longRangeDemo.checkpointOption"), {
                    number: String(block.number),
                  })}
                </button>
              </div>
            ))}
            <LongRangeChainRow
              rowLabel={t("longRangeDemo.attackerLabel")}
              gridRow={4}
              blocks={ATTACKER_CHAIN}
              variantFor={attackerVariant}
              brokenLinkAfterNumber={DIVERGE_AT - 1}
              note={{
                blockNumber: DIVERGE_AT,
                text: t("longRangeDemo.rivalNote"),
                testId: "long-range-demo-rival-note",
              }}
              testIdPrefix="long-range-demo-attacker"
            />
          </div>
        </div>
      </div>
      <div className="long-range-demo__verdict" data-testid="long-range-demo-verdict">
        <p className="long-range-demo__verdict-line">
          <span className="long-range-demo__verdict-heading">
            {t("longRangeDemo.verdict.naiveHeading")}
          </span>
          <span
            className="long-range-demo__verdict-badge long-range-demo__verdict-badge--warning"
            data-testid="long-range-demo-verdict-naive"
          >
            {format(t("longRangeDemo.verdict.naiveResult"), {
              attackerMax: String(ATTACKER_MAX_NUMBER),
            })}
          </span>
        </p>
        <p className="long-range-demo__verdict-line">
          <span className="long-range-demo__verdict-heading">
            {t("longRangeDemo.verdict.finalityHeading")}
          </span>
          <span
            className={
              protectedByFinality
                ? "long-range-demo__verdict-badge long-range-demo__verdict-badge--safe"
                : "long-range-demo__verdict-badge long-range-demo__verdict-badge--danger"
            }
            data-testid="long-range-demo-verdict-finality"
          >
            {format(
              t(
                protectedByFinality
                  ? "longRangeDemo.verdict.protected"
                  : "longRangeDemo.verdict.vulnerable",
              ),
              { divergeAt: String(DIVERGE_AT) },
            )}
          </span>
        </p>
      </div>
      <button
        type="button"
        className="long-range-demo__reset nodrag"
        onClick={handleReset}
        data-testid="long-range-demo-reset"
      >
        {t("longRangeDemo.reset")}
      </button>
      <p className="long-range-demo__footer-note">
        {withTermAnchor(t("longRangeDemo.whoDecides"), "attestation", "attestation")}
      </p>
      <p className="long-range-demo__footer-note">{t("longRangeDemo.simplifiedNote")}</p>
    </div>
  );
}
