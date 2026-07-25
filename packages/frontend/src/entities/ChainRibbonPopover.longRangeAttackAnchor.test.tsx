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

function tile(hash: string): ChainRibbonTile {
  return { block: block({ hash }), connectedToPrevious: true };
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

function renderPopover(hash: string) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={glossary}>
        <Harness blockTile={tile(hash)} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
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
});
