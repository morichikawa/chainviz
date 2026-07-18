import type { BlockEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ChainRibbonPopover } from "./ChainRibbonPopover.js";
import type { ChainRibbonTile } from "./chainRibbon.js";

/**
 * `ChainRibbonPopover` 単体の「親ブロック行ホバー → `onParentHover`」契約の
 * テスト（Issue #351 の固着バグ修正 `parentRowHoveredRef` の単位検証）。
 *
 * `ChainRibbonPopoverHoverBridge.test.tsx` は `ChainRibbonCard` を丸ごと
 * 描いてタイル→ポップオーバーの統合挙動を見るのに対し、こちらは
 * 「強調の寿命はポップオーバーの寿命を超えない」という不変条件を、行の
 * `mouseleave` を経ない unmount（＝コンポーネントそのものの削除。ワールド
 * ステート更新でチェーンリボンが再構築されるケースなど）でも保証している
 * ことを、`onParentHover` の呼び出しだけに絞って直接確認する（1ファイル
 * 1責務）。
 */

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

function tile(hash: string, overrides: Partial<BlockEntity> = {}): ChainRibbonTile {
  return { block: block({ hash, ...overrides }), connectedToPrevious: true };
}

/**
 * `ChainRibbonPopover` は body 直下へ portal 描画するため位置合わせの
 * `anchorRef` を要求する。実 DOM 要素への ref を与える薄いラッパー。
 *
 * ポップオーバーは初回描画時ではなく1フレーム後（`useEffect`）に mount する。
 * `PopoverPortal` は `useLayoutEffect` 内で `anchorRef.current` の矩形を測って
 * 初めて表示するが、アンカー div とポップオーバーを同一の初回コミットで
 * 描くと、子（ポップオーバー）の layout effect が親 div の ref 付与より前に
 * 走り `anchorRef.current` が null になる。実アプリではポップオーバーはタイルに
 * ホバーした後の再描画で mount されるため（アンカーは既に存在する）、この
 * ラッパーもその順序を再現する。
 */
function Harness({
  onParentHover,
  blockTile,
}: {
  onParentHover: (parentHash: string | null) => void;
  blockTile: ChainRibbonTile;
}) {
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
          onParentHover={onParentHover}
        />
      )}
    </div>
  );
}

function renderPopover(
  onParentHover: (parentHash: string | null) => void,
  blockTile: ChainRibbonTile = tile("0xchild", { parentHash: "0xparent-hash" }),
) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <Harness onParentHover={onParentHover} blockTile={blockTile} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("ChainRibbonPopover parent-row hover contract (Issue #351)", () => {
  it("does not call onParentHover on mount (no highlight until the row is hovered)", () => {
    const onParentHover = vi.fn();
    renderPopover(onParentHover);
    expect(onParentHover).not.toHaveBeenCalled();
  });

  it("reports the parent hash on row enter and null on row leave", () => {
    const onParentHover = vi.fn();
    renderPopover(onParentHover);
    const row = screen.getByTestId("chain-ribbon-popover-parent-0xchild");

    fireEvent.mouseEnter(row);
    expect(onParentHover).toHaveBeenLastCalledWith("0xparent-hash");

    fireEvent.mouseLeave(row);
    expect(onParentHover).toHaveBeenLastCalledWith(null);
  });

  it("clears the highlight on unmount when the row was still hovered (row's own mouseleave never fired)", () => {
    // 固着バグの核心: 行の mouseleave が一度も発火しないまま、ポップオーバー
    // コンポーネント自体が削除される経路（通常の遅延クローズだけでなく、
    // ワールドステート更新でチェーンリボンが作り直される等の unmount でも
    // 同じ）。この場合でも onParentHover(null) が呼ばれ強調が残らないこと。
    const onParentHover = vi.fn();
    const { unmount } = renderPopover(onParentHover);

    fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-popover-parent-0xchild"));
    onParentHover.mockClear();

    unmount();
    expect(onParentHover).toHaveBeenCalledTimes(1);
    expect(onParentHover).toHaveBeenCalledWith(null);
  });

  it("does not call onParentHover again on unmount when the row was already left", () => {
    // enter → leave で既に null を通知済みなら、unmount 時に重複して
    // onParentHover(null) を呼ばない（親の state セッターへの余分な呼び出しを
    // 避ける）。
    const onParentHover = vi.fn();
    const { unmount } = renderPopover(onParentHover);
    const row = screen.getByTestId("chain-ribbon-popover-parent-0xchild");

    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    onParentHover.mockClear();

    unmount();
    expect(onParentHover).not.toHaveBeenCalled();
  });

  it("does not call onParentHover on unmount when the row was never hovered", () => {
    const onParentHover = vi.fn();
    const { unmount } = renderPopover(onParentHover);
    unmount();
    expect(onParentHover).not.toHaveBeenCalled();
  });

  it("clears the highlight on unmount after a re-hover (ref is re-armed on each enter)", () => {
    // enter → leave → 再 enter の後に unmount。最後の enter で
    // parentRowHoveredRef が再び true になっているため、unmount 時に確実に
    // 解除される。
    const onParentHover = vi.fn();
    const { unmount } = renderPopover(onParentHover);
    const row = screen.getByTestId("chain-ribbon-popover-parent-0xchild");

    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    fireEvent.mouseEnter(row);
    onParentHover.mockClear();

    unmount();
    expect(onParentHover).toHaveBeenCalledTimes(1);
    expect(onParentHover).toHaveBeenCalledWith(null);
  });
});
