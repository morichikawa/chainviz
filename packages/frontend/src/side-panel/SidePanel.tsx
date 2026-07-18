import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { type KeyValueStorage, getBrowserStorage } from "../platform/storage.js";
import { useSidePanelFontScale } from "./useSidePanelFontScale.js";
import { useSidePanelResize } from "./useSidePanelResize.js";

export interface SidePanelProps {
  /** ヘッダーに出すタイトル（表示用。ReactNode を許容し、GlossaryTerm 等も置ける）。 */
  title: ReactNode;
  /** スクリーンリーダー向けのダイアログ名（プレーンテキスト必須）。 */
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * 幅の永続化ストレージ（Issue #362）。既定はブラウザ localStorage
   * （無ければメモリ代替。`LanguageProvider` と同じ注入パターン）。
   * テストで差し替え可能にするための optional prop。
   */
  storage?: KeyValueStorage;
}

/**
 * キャンバス右ドックの汎用サイドパネルのシェル（Issue #321 で新設。
 * docs/ARCHITECTURE.md §12.2）。ヘッダー（タイトル・閉じるボタン）・
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
 *
 * 幅は Issue #362 でユーザーがリサイズできるようにした（左端のハンドルを
 * ドラッグ、またはハンドルにフォーカスして←→キー）。幅の状態管理・
 * 永続化は `useSidePanelResize` に切り出し、このコンポーネントは
 * ハンドルの描画と `storage` の解決（既定 `getBrowserStorage()`）だけを持つ。
 *
 * 本文の文字サイズは Issue #377 でユーザーが変更できるようにした
 * （ヘッダーの A− / 現在値 / A+ ステッパー）。状態管理・永続化は
 * `useSidePanelFontScale` に切り出し、幅と同じ解決済み `storage` を
 * 共用する。倍率はルート要素の CSS カスタムプロパティ
 * `--side-panel-font-scale` として渡し、実際の拡大は `styles.css` の
 * `calc()` に寄せる（ヘッダー自体は拡大対象外。`side-panel__body` 配下
 * のみが対象）。
 */
export function SidePanel({
  title,
  ariaLabel,
  onClose,
  children,
  storage,
}: SidePanelProps) {
  const { t } = useLanguage();
  const [store] = useState<KeyValueStorage>(() => storage ?? getBrowserStorage());
  const { width, resizing, handleProps } = useSidePanelResize(store);
  const { scale, increase, decrease, reset, canIncrease, canDecrease } =
    useSidePanelFontScale(store);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const fontScalePercent = `${Math.round(scale * 100)}%`;
  // `--side-panel-font-scale` は React の `CSSProperties` に無いカスタム
  // プロパティなので、インラインスタイルの型を最小限だけ逃がす。
  const rootStyle = {
    width,
    "--side-panel-font-scale": scale,
  } as CSSProperties;

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
      style={rootStyle}
    >
      <div
        {...handleProps}
        className={
          resizing
            ? "side-panel__resize-handle side-panel__resize-handle--active"
            : "side-panel__resize-handle"
        }
        aria-label={t("sidePanel.resizeHandle")}
        data-testid="side-panel-resize-handle"
      />
      <div className="side-panel__header">
        <span className="side-panel__title">{title}</span>
        <div className="side-panel__font-controls" data-testid="side-panel-font-controls">
          <button
            type="button"
            className="side-panel__font-button"
            aria-label={t("sidePanel.fontSmaller")}
            onClick={decrease}
            disabled={!canDecrease}
            data-testid="side-panel-font-smaller"
          >
            {"A−"}
          </button>
          <button
            type="button"
            className="side-panel__font-value"
            aria-label={format(t("sidePanel.fontReset"), { value: fontScalePercent })}
            onClick={reset}
            data-testid="side-panel-font-reset"
          >
            {fontScalePercent}
          </button>
          <button
            type="button"
            className="side-panel__font-button"
            aria-label={t("sidePanel.fontLarger")}
            onClick={increase}
            disabled={!canIncrease}
            data-testid="side-panel-font-larger"
          >
            {"A+"}
          </button>
        </div>
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
