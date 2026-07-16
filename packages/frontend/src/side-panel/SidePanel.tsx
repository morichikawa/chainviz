import { type ReactNode, useEffect, useRef } from "react";
import { useLanguage } from "../i18n/LanguageProvider.js";

export interface SidePanelProps {
  /** ヘッダーに出すタイトル（表示用。ReactNode を許容し、GlossaryTerm 等も置ける）。 */
  title: ReactNode;
  /** スクリーンリーダー向けのダイアログ名（プレーンテキスト必須）。 */
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * キャンバス右ドックの汎用サイドパネルのシェル（Issue #321 で新設。
 * docs/worklog/issue-321.md §12.2）。ヘッダー（タイトル・閉じるボタン）・
 * Esc クローズ・本文スクロールだけを提供し、中身（`view.kind` ごとの
 * コンポーネント）については一切知らない。今回は contractSource のみだが、
 * Issue #313（用語集パネル）・#317（ノード間通信ログ）は中身の
 * コンポーネントを足すだけでこのシェルへ相乗りできる想定（1ファイル1責務。
 * `SidePanelHost.tsx` が kind ごとの振り分けを担う）。
 *
 * `OperationPanel`（ワークベンチの定型操作パネル）と同じ Esc クローズの
 * 仕組みを流用する。ただしこちらは常設ドックパネルであり、外側クリックでは
 * 閉じない（コントラクトのソースを読みながら他のカードを操作し続けられる
 * ようにするため。閉じる手段は × ボタンと Esc のみ）。
 */
export function SidePanel({ title, ariaLabel, onClose, children }: SidePanelProps) {
  const { t } = useLanguage();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      className="side-panel nodrag nowheel nopan"
      role="dialog"
      aria-label={ariaLabel}
      data-testid="side-panel"
    >
      <div className="side-panel__header">
        <span className="side-panel__title">{title}</span>
        <button
          type="button"
          className="side-panel__close"
          aria-label={t("sidePanel.close")}
          onClick={onClose}
          data-testid="side-panel-close"
        >
          {"✕"}
        </button>
      </div>
      <div className="side-panel__body">{children}</div>
    </div>
  );
}
