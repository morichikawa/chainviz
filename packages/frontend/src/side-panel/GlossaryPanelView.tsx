import { useEffect, useMemo, useRef, useState } from "react";
import { ActionHint } from "../canvas/ActionHint.js";
import type { LayerFilter, VisualizationLayer } from "../entities/canvasLayers.js";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { useGlossary } from "../glossary/GlossaryProvider.js";
import {
  type GlossaryLayerGroupKey,
  filterGlossaryTerms,
  glossaryToOrderedTerms,
  groupGlossaryTermsByLayer,
  resolveGlossaryLayerGroupKey,
} from "../glossary/glossarySearch.js";
import type { Glossary, GlossaryTerm as GlossaryTermEntry } from "../glossary/types.js";
import { pickLocale } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { Language, MessageKey } from "../i18n/messages.js";
import { useSidePanel } from "./SidePanelContext.js";

export interface GlossaryPanelViewProps {
  /**
   * 開いた瞬間に展開・スクロール・一時ハイライトする用語キー
   * （`SidePanelView` の `{kind: "glossary", termKey}`）。省略時（ヘッダーの
   * 「用語集」ボタンから開いた場合）は検索欄にフォーカスする（UX設計 §3.3）。
   */
  termKey?: string;
  /** レイヤーレンズの現在の選択状態（層チップの active 表示・トグルに使う）。 */
  layerFilter: LayerFilter;
  onLayerFilterChange: (layer: LayerFilter) => void;
}

const GROUP_LABEL_KEY: Record<VisualizationLayer, MessageKey> = {
  a: "layerFilter.a",
  b: "layerFilter.b",
  c: "layerFilter.c",
  d: "layerFilter.d",
};

/**
 * 用語集パネルの中身（`kind: "glossary"`。Issue #313。
 * `docs/worklog/issue-313.md` §3.3〜§3.6）。検索欄 + A〜D層グループ +
 * 単一展開アコーディオンで、読み込み済みの glossary 全件を一覧・検索・
 * ジャンプできるようにする（用語一覧・検索という「学びを広げる導線」が
 * これまで存在しなかったことへの対応）。
 *
 * `termKey` は prop が変わるたび（初回マウントを含む）にその用語を展開・
 * スクロール・一時ハイライトする。関連用語チップ・レイヤーレンズ以外の
 * カード → 用語へのジャンプは今回のスコープ外（`docs/worklog/issue-313.md`
 * §3.5「個別のキャンバス要素へのパンは見送る」）。
 */
export function GlossaryPanelView({
  termKey,
  layerFilter,
  onLayerFilterChange,
}: GlossaryPanelViewProps) {
  const { glossary } = useGlossary();
  const { lang, t } = useLanguage();
  const { open } = useSidePanel();

  const [query, setQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 開いた瞬間の初期フォーカス（UX設計 §3.3）: termKey 無し（ヘッダーの
  // 「用語集」ボタン起動）のときだけ検索欄にフォーカスする。マウント時の
  // 状態だけで判定すればよく（プロジェクトに react-hooks/exhaustive-deps は
  // 導入していない）、以降 termKey が変わっても検索欄のフォーカスは奪わない。
  useEffect(() => {
    if (termKey === undefined) searchInputRef.current?.focus();
  }, []);

  // termKey が（初回マウント含め）指定されるたびに、その用語を展開し、行まで
  // スクロールし、一時ハイライトする（UX設計 §3.3・§3.4「関連用語チップは
  // open() を呼び直すだけでこの経路に合流する」）。検索クエリが残っていると
  // 対象行が絞り込みで隠れている場合があるため、ジャンプ時は検索をクリアして
  // 必ず見えるようにする。ハイライト時間は実カード新着発光（Issue #123）と
  // 同じ演出時間を再利用する（「ここだよ」の合図という役割が同じため）。
  useEffect(() => {
    if (termKey === undefined) return;
    setQuery("");
    setExpandedKey(termKey);
    setHighlightKey(termKey);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightKey((current) => (current === termKey ? null : current));
    }, NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    rowRefs.current.get(termKey)?.scrollIntoView?.({ block: "center" });
  }, [termKey]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  const orderedTerms = useMemo(() => glossaryToOrderedTerms(glossary), [glossary]);
  const filteredTerms = useMemo(
    () => filterGlossaryTerms(orderedTerms, query, lang),
    [orderedTerms, query, lang],
  );
  const groups = useMemo(() => groupGlossaryTermsByLayer(filteredTerms), [filteredTerms]);

  function handleToggleRow(key: string) {
    setExpandedKey((current) => (current === key ? null : key));
  }

  function handleJumpToRelated(key: string) {
    // 関連用語チップのクリックは、ヘッダーボタン/インライン用語クリックと
    // 同じ経路（open()）に合流させるだけでよい（UX設計 §3.4）。この呼び出し
    // 自体は同じ "glossary" kind の view を新しい termKey で置き換えるため、
    // パネルは開いたまま、上の useEffect が展開・スクロールを担う。
    open({ kind: "glossary", termKey: key });
  }

  function handleLayerChipClick(layer: VisualizationLayer) {
    // LayerFilterBar のチップと同じトグル挙動（同じ層をもう一度押すと解除）。
    onLayerFilterChange(layerFilter === layer ? "all" : layer);
  }

  return (
    <div data-testid="glossary-panel">
      <input
        ref={searchInputRef}
        type="search"
        className="glossary-panel__search"
        placeholder={t("glossary.panel.searchPlaceholder")}
        aria-label={t("glossary.panel.searchPlaceholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        data-testid="glossary-panel-search"
      />
      {groups.length === 0 ? (
        <p className="glossary-panel__empty" data-testid="glossary-panel-empty">
          {t("glossary.panel.searchEmpty")}
        </p>
      ) : (
        groups.map((group) => (
          <div
            key={group.layer}
            className="glossary-panel__group"
            data-testid={`glossary-panel-group-${group.layer}`}
          >
            <div className="glossary-panel__group-heading">
              {group.layer === "other" ? t("glossary.panel.otherLayer") : t(GROUP_LABEL_KEY[group.layer])}
            </div>
            {group.terms.map((term) => (
              <GlossaryPanelRow
                key={term.key}
                term={term}
                lang={lang}
                t={t}
                expanded={expandedKey === term.key}
                highlighted={highlightKey === term.key}
                layerFilter={layerFilter}
                glossary={glossary}
                onToggle={() => handleToggleRow(term.key)}
                onJumpToRelated={handleJumpToRelated}
                onLayerChipClick={handleLayerChipClick}
                registerRef={(el) => {
                  if (el) rowRefs.current.set(term.key, el);
                  else rowRefs.current.delete(term.key);
                }}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

interface GlossaryPanelRowProps {
  term: GlossaryTermEntry;
  lang: Language;
  t: (key: MessageKey) => string;
  expanded: boolean;
  /** ジャンプ直後の一時ハイライト中かどうか（新着発光と同じ演出）。 */
  highlighted: boolean;
  layerFilter: LayerFilter;
  glossary: Glossary;
  onToggle: () => void;
  onJumpToRelated: (key: string) => void;
  onLayerChipClick: (layer: VisualizationLayer) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}

/** 用語集パネルの1行（アコーディオン）。 */
function GlossaryPanelRow({
  term,
  lang,
  t,
  expanded,
  highlighted,
  layerFilter,
  glossary,
  onToggle,
  onJumpToRelated,
  onLayerChipClick,
  registerRef,
}: GlossaryPanelRowProps) {
  // 行 = 用語名（現在の言語）+ もう一方の言語の用語名を副次表示（UX設計 §3.3）。
  const secondaryLang: Language = lang === "ja" ? "en" : "ja";
  const primaryName = pickLocale(term.name, lang);
  const secondaryName = term.name[secondaryLang];
  const layerKey: GlossaryLayerGroupKey = resolveGlossaryLayerGroupKey(term.layer);

  const rowClassName = [
    "glossary-panel__row",
    highlighted ? "glossary-panel__row--highlight" : null,
  ]
    .filter((token): token is string => token !== null)
    .join(" ");

  return (
    <div
      ref={registerRef}
      className={rowClassName}
      data-testid={`glossary-panel-term-${term.key}`}
    >
      <button
        type="button"
        className="glossary-panel__row-header"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="glossary-panel__row-name">{primaryName}</span>
        {secondaryName !== "" && secondaryName !== primaryName && (
          <span className="glossary-panel__row-secondary">{secondaryName}</span>
        )}
      </button>
      {expanded && (
        <div className="glossary-panel__row-body">
          <p className="glossary-panel__row-definition">{pickLocale(term.definition, lang)}</p>
          {/* "other" グループ（対応するレイヤーが無い用語）にはレイヤー
              レンズへ繋ぐ先が無いためチップを出さない（UX設計 §3.5）。 */}
          {layerKey !== "other" && (
            <ActionHint hint={t("glossary.panel.layerLens.hint")}>
              <button
                type="button"
                className={
                  layerFilter === layerKey
                    ? "glossary-panel__layer-chip glossary-panel__layer-chip--active"
                    : "glossary-panel__layer-chip"
                }
                aria-pressed={layerFilter === layerKey}
                onClick={() => onLayerChipClick(layerKey)}
                data-testid="glossary-panel-layer-chip"
              >
                {t(GROUP_LABEL_KEY[layerKey])}
              </button>
            </ActionHint>
          )}
          {term.relatedTerms.length > 0 && (
            <div className="glossary-panel__related">
              <span className="glossary-panel__related-label">
                {t("glossary.panel.relatedTerms")}
              </span>
              {term.relatedTerms.map((key) => {
                // 未登録キー（参照切れ）はクリック不可のプレーン表示にする
                // （UX設計 §3.4。GlossaryTerm 本体の unknown 扱いと同じ流儀）。
                const related = Object.hasOwn(glossary, key) ? glossary[key] : undefined;
                if (!related) {
                  return (
                    <span
                      key={key}
                      className="glossary-panel__related-chip glossary-panel__related-chip--unknown"
                      data-testid={`glossary-panel-related-${key}`}
                    >
                      {key}
                    </span>
                  );
                }
                return (
                  <button
                    key={key}
                    type="button"
                    className="glossary-panel__related-chip"
                    onClick={() => onJumpToRelated(key)}
                    data-testid={`glossary-panel-related-${key}`}
                  >
                    {pickLocale(related.name, lang)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
