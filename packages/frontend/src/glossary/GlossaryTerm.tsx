import { type KeyboardEvent, type MouseEvent, type ReactNode, useId, useRef } from "react";
import type { Language } from "../i18n/messages.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { pickLocale } from "../i18n/i18n.js";
import { useHoverPopover } from "../interaction/useHoverPopover.js";
import { PopoverPortal } from "../interaction/PopoverPortal.js";
import { useOptionalSidePanel } from "../side-panel/SidePanelContext.js";
import { useGlossary } from "./GlossaryProvider.js";
import type { Glossary } from "./types.js";

export interface GlossaryTermProps {
  /** 用語キー（glossary の YAML マッピングキー）。 */
  termKey: string;
  /** 表示テキスト。省略時は用語名（現在の言語）を表示する。 */
  children?: ReactNode;
}

/**
 * 関連用語キーの表示ラベルを解決する（Issue #313 UX設計 §3.7-3）。glossary に
 * 登録済みなら現在言語の用語名、未登録（参照切れ）なら生キーをそのまま返す
 * （既存の `GlossaryTerm` 本体の unknown 扱いと同じ流儀）。
 */
function resolveRelatedTermLabel(key: string, glossary: Glossary, lang: Language): string {
  const related = Object.hasOwn(glossary, key) ? glossary[key] : undefined;
  return related ? pickLocale(related.name, lang) : key;
}

/**
 * インライン用語解説。用語には点線の下線を付け、ホバー/フォーカスで定義を
 * ポップオーバー表示する（CONCEPT.md「インライン解説」）。用語が glossary に
 * 無い場合は下線を付けずそのまま表示する。
 *
 * クリック・Enter・Space で用語集パネル（`side-panel/GlossaryPanelView.tsx`）
 * をその用語を選択した状態で開く（Issue #313 UX設計 §3.2-2: 「ホバー = さっと
 * 覗く、クリック = じっくり読む」の使い分け）。`SidePanelProvider` の外
 * （単体テストなど）でレンダーされた場合は `useOptionalSidePanel()` が
 * `null` を返すため、クリック連携は no-op にフォールバックする（例外を
 * 投げない）。
 */
export function GlossaryTerm({ termKey, children }: GlossaryTermProps) {
  const { glossary, lookup } = useGlossary();
  const { lang, t } = useLanguage();
  const sidePanel = useOptionalSidePanel();
  // Issue #221: 隙間を通過する一瞬の mouseleave で消えないよう遅延クローズ。
  const { isOpen: open, onMouseEnter, onMouseLeave, onFocus, onBlur, close } =
    useHoverPopover();
  const popoverId = useId();
  // Issue #245: React Flow のノードはそれぞれ独立したスタッキングコンテキスト
  // を持つため、隣接カードの下に隠れないよう body 直下へ portal 描画する
  // （PopoverPortal 参照）。位置合わせの基準はこの用語自体（アンカー）。
  const anchorRef = useRef<HTMLSpanElement>(null);

  const term = lookup(termKey);
  const label = children ?? (term ? pickLocale(term.name, lang) : termKey);

  if (!term) {
    return <span className="glossary-term glossary-term--unknown">{label}</span>;
  }

  // クリック/Enter/Space 共通の処理。React Flow のノード選択などへの波及を
  // 防ぐため、親（カード）へのイベント伝播は止める（UX設計 §3.2-2）。開いた
  // ままのホバーポップオーバーはパネルと二重表示しないよう閉じる。
  function openPanel(event: MouseEvent | KeyboardEvent) {
    event.stopPropagation();
    close();
    sidePanel?.open({ kind: "glossary", termKey });
  }

  return (
    <span
      ref={anchorRef}
      className="glossary-term"
      tabIndex={0}
      role="button"
      aria-describedby={open ? popoverId : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={openPanel}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // Issue #353: role="button" の <span> はネイティブ <button> と違い、
        // Space キー押下時のページスクロールをブラウザが自動では抑止しない。
        // クリックにはデフォルト動作が無いため openPanel 本体ではなく
        // ここで明示的に preventDefault する。
        event.preventDefault();
        openPanel(event);
      }}
      data-testid={`glossary-term-${termKey}`}
    >
      <span className="glossary-term__label">{label}</span>
      {open && (
        <PopoverPortal
          anchorRef={anchorRef}
          gapPx={6}
          className="glossary-popover"
          id={popoverId}
          role="tooltip"
          data-testid={`glossary-popover-${termKey}`}
        >
          <span className="glossary-popover__name">
            {pickLocale(term.name, lang)}
          </span>
          {/* UX設計 §3.7-1: CSS の line-clamp で6行までに制限する（styles.css
              `.glossary-popover__definition`）。全文はパネルで読む。 */}
          <span className="glossary-popover__definition">
            {pickLocale(term.definition, lang)}
          </span>
          {term.relatedTerms.length > 0 && (
            // UX設計 §3.7-3: 生キーではなく現在言語の用語名を表示する。
            // ポップオーバー内はクリック不可のまま（Issue #298 の残課題どおり
            // ホバー維持が構造的に壊れやすいため。§1-2 参照）。
            <span className="glossary-popover__related">
              {term.relatedTerms
                .map((key) => resolveRelatedTermLabel(key, glossary, lang))
                .join(", ")}
            </span>
          )}
          {/* UX設計 §3.7-2: クリックできることのディスカバリー手段を兼ねる
              固定フッター。クランプの有無に関わらず常に出す。 */}
          <span className="glossary-popover__footer">
            {t("glossary.popover.openPanel")}
          </span>
        </PopoverPortal>
      )}
    </span>
  );
}
