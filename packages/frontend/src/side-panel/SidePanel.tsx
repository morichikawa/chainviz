import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { type KeyValueStorage, getBrowserStorage } from "../platform/storage.js";
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
 * ドラッグ中（`resizing`）はルート要素に `side-panel--resizing` 修飾
 * クラスを足し、`styles.css` 側でパネル配下のテキスト選択を止める
 * （Issue #391。左ボタン以外でのドラッグ開始も同 Issue で防ぐ）。
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
      className={
        resizing
          ? "side-panel nodrag nowheel nopan side-panel--resizing"
          : "side-panel nodrag nowheel nopan"
      }
      role="dialog"
      aria-label={ariaLabel}
      data-testid="side-panel"
      style={{ width }}
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
