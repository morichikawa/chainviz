import { type ReactNode, useId, useRef } from "react";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { pickLocale } from "../i18n/i18n.js";
import { useHoverPopover } from "../interaction/useHoverPopover.js";
import { PopoverPortal } from "../interaction/PopoverPortal.js";
import { useGlossary } from "./GlossaryProvider.js";

export interface GlossaryTermProps {
  /** 用語キー（glossary の YAML マッピングキー）。 */
  termKey: string;
  /** 表示テキスト。省略時は用語名（現在の言語）を表示する。 */
  children?: ReactNode;
}

/**
 * インライン用語解説。用語には点線の下線を付け、ホバー/フォーカスで定義を
 * ポップオーバー表示する（CONCEPT.md「インライン解説」）。用語が glossary に
 * 無い場合は下線を付けずそのまま表示する。
 */
export function GlossaryTerm({ termKey, children }: GlossaryTermProps) {
  const { lookup } = useGlossary();
  const { lang } = useLanguage();
  // Issue #221: 隙間を通過する一瞬の mouseleave で消えないよう遅延クローズ。
  const { isOpen: open, onMouseEnter, onMouseLeave, onFocus, onBlur } =
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
          <span className="glossary-popover__definition">
            {pickLocale(term.definition, lang)}
          </span>
          {term.relatedTerms.length > 0 && (
            <span className="glossary-popover__related">
              {term.relatedTerms.join(", ")}
            </span>
          )}
        </PopoverPortal>
      )}
    </span>
  );
}
