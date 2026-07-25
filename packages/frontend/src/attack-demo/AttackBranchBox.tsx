import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { Branch } from "./fiftyOnePercentAttackDemo.js";

export interface AttackBranchBoxProps {
  branch: Branch;
  /** この枝を現在支持しているバリデーター id（昇順）。 */
  validatorIds: readonly number[];
  /** この枝の重み（`validatorIds.length` と一致する。呼び出し側の
   * `weightOfBranch` の結果をそのまま渡す想定）。 */
  weight: number;
  /** この枝が現在 canonical か。 */
  canonical: boolean;
  /** 直前の操作でトグルされ、短時間フラッシュ中のバリデーター id 集合。 */
  flashingValidatorIds: ReadonlySet<number>;
  /** 直前の操作で canonical 判定が変わり、バッジを短時間フラッシュ中か。 */
  badgeFlashing: boolean;
  onToggleValidator: (id: number) => void;
}

/**
 * 「51%攻撃のしくみ」デモの枝1つぶんの表示（Issue #414。
 * `docs/worklog/issue-414.md` UX設計 §3・§6）。`HashChainBlockRow` が
 * ブロック1件の表示を担うのと同じ粒度で、枝1つの表示をここに切り出す
 * （CLAUDE.md の1ファイル1責務）。
 *
 * バリデーターのトグルボタン自体が「そのバリデーターが現在この枝を支持
 * している」ことを表す配置になっている（コントロールと可視化が同一の
 * 要素。UX設計 §3）。色は既存フォークパレット（`--fork-color-a`/
 * `--fork-color-b`）を `styles.css` 側で流用し、正準/非正準は色だけでなく
 * バッジの文言でも伝える（a11y。UX設計 §3）。
 */
export function AttackBranchBox({
  branch,
  validatorIds,
  weight,
  canonical,
  flashingValidatorIds,
  badgeFlashing,
  onToggleValidator,
}: AttackBranchBoxProps) {
  const { t } = useLanguage();
  const headingKey = branch === "a" ? "attack51Demo.branchA" : "attack51Demo.branchB";
  const validatorLabelKey =
    branch === "a" ? "attack51Demo.validator.honest" : "attack51Demo.validator.attacker";

  return (
    <div
      className={[
        "attack51-demo__branch",
        `attack51-demo__branch--${branch}`,
        canonical ? "attack51-demo__branch--canonical" : "attack51-demo__branch--not-canonical",
      ].join(" ")}
      data-testid={`attack51-demo-branch-${branch}`}
    >
      <div className="attack51-demo__branch-heading">{t(headingKey)}</div>
      <div
        className="attack51-demo__branch-validators"
        data-testid={`attack51-demo-branch-${branch}-validators`}
      >
        {validatorIds.length === 0 ? (
          <p className="attack51-demo__branch-empty">{t("attack51Demo.branchEmpty")}</p>
        ) : (
          validatorIds.map((id) => (
            <button
              key={id}
              type="button"
              className={
                flashingValidatorIds.has(id)
                  ? "attack51-demo__validator attack51-demo__validator--flash"
                  : "attack51-demo__validator"
              }
              aria-pressed={branch === "b"}
              aria-label={format(t(validatorLabelKey), { n: String(id) })}
              onClick={() => onToggleValidator(id)}
              data-testid={`attack51-demo-validator-${id}`}
            >
              {`V${id}`}
            </button>
          ))
        )}
      </div>
      <div className="attack51-demo__branch-weight">
        <span className="attack51-demo__branch-weight-label">{t("attack51Demo.weight")}</span>
        <span
          className="attack51-demo__branch-weight-value"
          data-testid={`attack51-demo-branch-${branch}-weight`}
        >
          {weight}
        </span>
      </div>
      <div
        className={
          badgeFlashing
            ? "attack51-demo__branch-badge attack51-demo__branch-badge--flash"
            : "attack51-demo__branch-badge"
        }
        data-testid={`attack51-demo-branch-${branch}-badge`}
      >
        {canonical ? t("attack51Demo.badge.canonical") : t("attack51Demo.badge.notCanonical")}
      </div>
    </div>
  );
}
