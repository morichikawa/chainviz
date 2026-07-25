// 攻撃手法解説の土台（ARCHITECTURE.md §17.4、Issue #413）: 「親ブロック」行
// 近傍の longRangeAttack 用語アンカーの表示確認。ポップオーバーの他の挙動
// （親ブロック行ホバー・ハッシュデモ導線等）は ChainRibbonPopover.test.tsx /
// ChainRibbonPopover.hashDemoEntry.test.tsx が別途扱う（CLAUDE.md
// 「1ファイル1責務」をテストファイルにも適用）。
import type { BlockEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ChainRibbonPopover } from "./ChainRibbonPopover.js";
import type { ChainRibbonTile } from "./chainRibbon.js";

afterEach(cleanup);

// GlossaryTerm は用語が glossary に見つからない場合 data-testid を出さない
// （GlossaryTerm.tsx の unknown 分岐）ため、テスト対象キーを実際に含む
// glossary を渡す。
const glossary: Glossary = {
  longRangeAttack: {
    key: "longRangeAttack",
    name: { ja: "ロングレンジ攻撃", en: "Long-range attack" },
    definition: { ja: "定義", en: "definition" },
    layer: "b-network",
    relatedTerms: [],
  },
};

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 7,
    parentHash: "0xparent-hash",
    timestamp: 1_784_798_132,
    receivedAt: {},
    ...overrides,
  };
}

// PopoverPortal の layout effect の順序上の要件は ChainRibbonPopover.test.tsx
// の Harness と同じ理由（同コメント参照）。
function Harness({ blockTile }: { blockTile: ChainRibbonTile }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div ref={anchorRef}>
      {mounted && (
        <ChainRibbonPopover
          anchorRef={anchorRef}
          tile={blockTile}
          txCount={undefined}
          receivedOrder={[]}
          onParentHover={() => {}}
        />
      )}
    </div>
  );
}

function renderPopover(
  hash: string,
  options: {
    lang?: "ja" | "en";
    glossaryOverride?: Glossary;
    blockOverrides?: Partial<BlockEntity>;
  } = {},
) {
  const blockTile: ChainRibbonTile = {
    block: block({ hash, ...options.blockOverrides }),
    connectedToPrevious: true,
  };
  return render(
    <LanguageProvider initialLanguage={options.lang ?? "ja"}>
      <GlossaryProvider glossary={options.glossaryOverride ?? glossary}>
        <Harness blockTile={blockTile} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

/** ポップオーバー内の `.infra-field` 行の並び（DOM順）。 */
function fieldRows(hash: string): HTMLElement[] {
  const popover = screen.getByTestId(`chain-ribbon-popover-${hash}`);
  return [...popover.querySelectorAll<HTMLElement>(".infra-field")];
}

describe("ChainRibbonPopover long-range attack anchor (Issue #413)", () => {
  it("shows a longRangeAttack anchor next to the parent block row", () => {
    renderPopover("0xchild");
    expect(
      screen.getByTestId("chain-ribbon-popover-long-range-hint-0xchild"),
    ).toBeTruthy();
    expect(screen.getByTestId("glossary-term-longRangeAttack")).toBeTruthy();
  });

  it("renders the hint for every tile (not conditional on parent hover state)", () => {
    renderPopover("0xother");
    expect(screen.getByTestId("glossary-term-longRangeAttack")).toBeTruthy();
  });

  it("places the hint between the parent-block row and the timestamp row", () => {
    // 「親ブロック」行の直後という位置そのものが設計意図（遡る先を示す行の
    // 近傍。ARCHITECTURE.md §17.4）。
    renderPopover("0xchild");
    const rows = fieldRows("0xchild");
    const parentIndex = rows.findIndex(
      (row) => row.dataset.testid === "chain-ribbon-popover-parent-0xchild",
    );
    const hintIndex = rows.findIndex(
      (row) => row.dataset.testid === "chain-ribbon-popover-long-range-hint-0xchild",
    );
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(hintIndex).toBe(parentIndex + 1);
    // 直後の行が「時刻」欄であること（間に別の欄が入り込んでいない）。
    expect(rows[hintIndex + 1]?.textContent ?? "").toContain("時刻");
  });

  it("still shows the hint for the genesis tile (block #0 with no real parent)", () => {
    // ロングレンジ攻撃はまさに genesis まで遡る攻撃なので、先頭タイル
    // （親を持たない・前のタイルと繋がっていない）でも導線を出す。
    renderPopover("0xgenesis", {
      blockOverrides: { number: 0, parentHash: `0x${"0".repeat(64)}` },
    });
    expect(
      screen.getByTestId("chain-ribbon-popover-long-range-hint-0xgenesis"),
    ).toBeTruthy();
    expect(screen.getByTestId("glossary-term-longRangeAttack")).toBeTruthy();
  });

  it("labels the hint row in English when the language is en", () => {
    renderPopover("0xchild", { lang: "en" });
    const row = screen.getByTestId("chain-ribbon-popover-long-range-hint-0xchild");
    expect(row.textContent ?? "").toContain("Related terms");
    expect(row.textContent ?? "").toContain("Long-range attack");
  });

  it("keeps the hint row (degraded to plain text) when the glossary lacks the term", () => {
    // 用語 YAML の該当エントリが読み飛ばされた場合の縮退。行は残り、
    // GlossaryTerm は下線もポップオーバーも持たない素テキストになる
    // （このアンカーは children を渡していないため生キーが出る）。
    renderPopover("0xchild", { glossaryOverride: {} });
    const row = screen.getByTestId("chain-ribbon-popover-long-range-hint-0xchild");
    expect(row.textContent ?? "").toContain("longRangeAttack");
    expect(screen.queryByTestId("glossary-term-longRangeAttack")).toBeNull();
  });
});
