import type { BlockEntity } from "@chainviz/shared";
import { type FormEvent, useEffect, useState } from "react";
import { resolveBlockJump } from "../entities/blockDetail.js";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";

export interface BlockJumpFormProps {
  /** 現在パネルに表示中のブロック（入力欄の初期値・同期先）。 */
  block: BlockEntity;
  /** 保持窓内の全ブロックの hash 索引（`SidePanelHost` から渡ってくる）。 */
  blocksByHash: ReadonlyMap<string, BlockEntity>;
  /** 前後ナビゲーションと同じ、指定 hash のブロックへ表示を切り替える関数。 */
  onNavigate: (hash: string) => void;
}

/**
 * ブロック詳細パネルのブロック番号ジャンプ欄（Issue #428。
 * ARCHITECTURE.md §18.3.1）。前後ナビゲーションのボタン列のすぐ上に置く、
 * 保持窓内を移動する第3の手段。`BlockDetailView.tsx` が既に約240行のため
 * 分離した新規ファイル（1ファイル1責務）。
 *
 * 入力欄は `type="text"` + `inputMode="numeric"`（`operations/TransferForm.tsx`
 * の金額欄と同じ流儀）。バリデーション・見つからない場合の範囲提示は
 * `resolveBlockJump`（`entities/blockDetail.ts`）に委ね、このコンポーネントは
 * 入力値の保持と結果に応じた表示の出し分けのみを行う（`TransferForm` の
 * 「入力のたびに導出し、非空かつ無効なときだけエラー文を出す」流儀を踏襲）。
 */
export function BlockJumpForm({ block, blocksByHash, onNavigate }: BlockJumpFormProps) {
  const { t } = useLanguage();
  const [input, setInput] = useState(String(block.number));

  // 表示中のブロックが変わるたび（前後ボタン・ジャンプいずれの移動でも）
  // 入力欄の値を表示中のブロック番号に同期する（アドレスバーのように「今
  // どこにいるか」を表す。`GlossaryPanelView.tsx` が `termKey` prop の変化に
  // 応じて展開し直す既存パターンと同種）。
  useEffect(() => {
    setInput(String(block.number));
  }, [block.hash]);

  const trimmed = input.trim();
  const result = trimmed === "" ? undefined : resolveBlockJump(trimmed, blocksByHash);
  const canSubmit = result?.kind === "found";

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (result?.kind === "found") onNavigate(result.block.hash);
  };

  return (
    <form className="block-jump-form" onSubmit={handleSubmit}>
      <label className="operation-field block-jump-form__field">
        <span className="operation-field__label">{t("blockDetail.jump.label")}</span>
        <div className="block-jump-form__row">
          <input
            type="text"
            inputMode="numeric"
            className="operation-field__input block-jump-form__input nodrag"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            data-testid="block-jump-input"
          />
          <button
            type="submit"
            className="block-jump-form__submit nodrag"
            disabled={!canSubmit}
            data-testid="block-jump-submit"
          >
            {t("blockDetail.jump.submit")}
          </button>
        </div>
      </label>
      {trimmed !== "" && result?.kind === "invalid" && (
        <p className="operation-form__error" data-testid="block-jump-error-invalid">
          {t("blockDetail.jump.invalid")}
        </p>
      )}
      {trimmed !== "" && result?.kind === "notFound" && (
        <p className="operation-form__error" data-testid="block-jump-error-notFound">
          {format(t("blockDetail.jump.notFound"), {
            min: String(result.range.min),
            max: String(result.range.max),
          })}
        </p>
      )}
    </form>
  );
}
