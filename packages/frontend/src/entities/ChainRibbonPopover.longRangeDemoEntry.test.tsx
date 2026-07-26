// チェーンリボンポップオーバー末尾の「ロングレンジ攻撃を体験する」文脈導線
// (Issue #415)が SidePanel を開くこと・SidePanelProvider が無い単体レンダー
// でも壊れないことの確認。ポップオーバーの他の挙動(親ブロック行ホバー等)は
// ChainRibbonPopover.test.tsx が扱う(CLAUDE.md の1ファイル1責務)。
import type { BlockEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import { ChainRibbonPopover } from "./ChainRibbonPopover.js";
import type { ChainRibbonTile } from "./chainRibbon.js";

afterEach(cleanup);

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

function SidePanelViewProbe() {
  const { view } = useSidePanel();
  return <span data-testid="side-panel-view-kind">{view?.kind ?? "none"}</span>;
}

describe("ChainRibbonPopover: long-range attack demo entry point (Issue #415)", () => {
  it("renders without a SidePanelProvider (no-op click)", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <Harness blockTile={tile("0xchild")} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    const button = screen.getByTestId("chain-ribbon-popover-long-range-demo-open-0xchild");
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("exposes the contextual entry as a real <button> with an accessible name (keyboard reachable)", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <Harness blockTile={tile("0xchild")} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    const button = screen.getByRole("button", { name: "ロングレンジ攻撃を体験する" });
    expect(button.tagName).toBe("BUTTON");
    expect((button as HTMLButtonElement).type).toBe("button");
  });

  it("opens the longRangeAttackDemo side panel view when clicked, without bubbling to ancestors", () => {
    const parentClick = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <div onClick={parentClick}>
              <Harness blockTile={tile("0xchild")} />
            </div>
            <SidePanelViewProbe />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("none");
    fireEvent.click(
      screen.getByTestId("chain-ribbon-popover-long-range-demo-open-0xchild"),
    );
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("longRangeAttackDemo");
    expect(parentClick).not.toHaveBeenCalled();
  });
});
