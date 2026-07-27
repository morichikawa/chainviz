// 学習用砂場メニュー（Issue #414 →Issue #430 で3項目に統合）のキーボード操作。
// 既存テストは「入口が本物の <button> である＝理屈のうえでは Tab/Enter で
// 操作できる」ところまでしか見ていないため、実際に Tab でフォーカスを移し
// Enter/Space で起動できることをここで確かめる。ロングレンジ攻撃の入口は
// #430 で専用行からメニュー内へ移設されたので、移設後もキーボードだけで
// 到達・起動できることが回帰確認の要点。
//
// jsdom の制約（このファイルで確かめられないこと）:
//   - `<summary>` に Enter/Space を送っても jsdom は `<details>` を開閉しない
//     （ネイティブの activation behavior が未実装）。summary 自体の
//     キーボード開閉はブラウザ任せなので、ここでは「summary がフォーカス可能で
//     あること」と「開いた後の中身が操作できること」までを固定する。
//     `<details>`/`<summary>` を使っていること自体は
//     ChainRibbonCard.demoMenu.structure.test.tsx が固定している
//   - 閉じた `<details>` の中身は jsdom ではレイアウトが無いため隠れず、
//     Tab でも到達できてしまう。したがって「閉じている間は Tab で到達しない」
//     という確認はここでは書けない（実ブラウザ側の挙動）
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import { ChainRibbonCard } from "./ChainRibbonCard.js";
import type { ChainRibbonFlowNode } from "./chainRibbonNode.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";

afterEach(cleanup);

const ENTRIES = [
  { testId: "chain-ribbon-hash-demo-open", kind: "hashChainDemo" },
  {
    testId: "chain-ribbon-fifty-one-percent-demo-open",
    kind: "fiftyOnePercentAttackDemo",
  },
  { testId: "chain-ribbon-long-range-demo-open", kind: "longRangeAttackDemo" },
] as const;

function data(): ChainRibbonFlowNode["data"] {
  return {
    tiles: [],
    txCountByHash: new Map(),
    nodeLabelById: new Map(),
    landingHashes: new Set(),
    blocks: [],
  };
}

function props() {
  return { data: data() } as unknown as Parameters<typeof ChainRibbonCard>[0];
}

function SidePanelViewProbe() {
  const { view } = useSidePanel();
  return <span data-testid="side-panel-view-kind">{view?.kind ?? "none"}</span>;
}

function renderCard() {
  return render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <RibbonHoverProvider transactions={[]}>
              <ChainRibbonCard {...props()} />
            </RibbonHoverProvider>
            <SidePanelViewProbe />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

function summary(): HTMLElement {
  return screen.getByTestId("chain-ribbon-demo-menu-open");
}

function details(): HTMLDetailsElement {
  const element = summary().closest("details");
  if (!element) throw new Error("demo menu <details> not found");
  return element as HTMLDetailsElement;
}

function activeTestId(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset?.testid;
}

describe("ChainRibbonCard demo menu: keyboard reachability", () => {
  it("keeps the summary focusable (the keyboard entry point into the menu)", () => {
    renderCard();
    summary().focus();
    expect(document.activeElement).toBe(summary());
    // 明示的にタブ順から外されていないこと（negative tabindex / disabled 相当）。
    expect(summary().getAttribute("tabindex")).not.toBe("-1");
    expect(summary().getAttribute("aria-hidden")).toBeNull();
  });

  it("moves Tab focus through the three entries in the order they are listed", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(summary());
    screen.getByTestId(ENTRIES[0].testId).focus();
    expect(activeTestId()).toBe(ENTRIES[0].testId);
    for (const entry of ENTRIES.slice(1)) {
      await user.tab();
      expect(activeTestId()).toBe(entry.testId);
    }
  });

  it("lets Tab leave the menu after the last entry (no focus trap)", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(summary());
    screen.getByTestId(ENTRIES[ENTRIES.length - 1].testId).focus();
    await user.tab();
    expect(details().contains(document.activeElement)).toBe(false);
  });

  it.each(ENTRIES)("keeps $testId in the tab sequence (not disabled or hidden)", ({ testId }) => {
    renderCard();
    const entry = screen.getByTestId(testId) as HTMLButtonElement;
    expect(entry.disabled).toBe(false);
    expect(entry.getAttribute("tabindex")).not.toBe("-1");
    expect(entry.getAttribute("aria-hidden")).toBeNull();
    entry.focus();
    expect(document.activeElement).toBe(entry);
  });
});

describe("ChainRibbonCard demo menu: keyboard activation", () => {
  it.each(ENTRIES)(
    "opens $kind when Enter is pressed on the focused entry",
    async ({ testId, kind }) => {
      const user = userEvent.setup();
      renderCard();
      await user.click(summary());
      screen.getByTestId(testId).focus();
      await user.keyboard("{Enter}");
      expect(screen.getByTestId("side-panel-view-kind").textContent).toBe(kind);
      // マウス操作と同じく、起動後はメニューが閉じること（開いたパネルが
      // メニューの裏に隠れないための挙動。3項目とも同じでなければならない）。
      expect(details().open).toBe(false);
    },
  );

  it.each(ENTRIES)(
    "opens $kind when Space is pressed on the focused entry",
    async ({ testId, kind }) => {
      const user = userEvent.setup();
      renderCard();
      await user.click(summary());
      screen.getByTestId(testId).focus();
      await user.keyboard(" ");
      expect(screen.getByTestId("side-panel-view-kind").textContent).toBe(kind);
      expect(details().open).toBe(false);
    },
  );

  it("can drive the whole menu twice with the keyboard only (reopen → Enter)", async () => {
    // ref 経由の閉じ処理はキーボード起動でも同じ経路を通るが、2周目に
    // メニューを開き直せることまで確認しておく（`details.open = false` を
    // 直接いじっているため、React の再レンダーとずれると2周目が開かない）。
    const user = userEvent.setup();
    renderCard();
    await user.click(summary());
    screen.getByTestId("chain-ribbon-hash-demo-open").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("hashChainDemo");

    await user.click(summary());
    expect(details().open).toBe(true);
    screen.getByTestId("chain-ribbon-long-range-demo-open").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("longRangeAttackDemo");
    expect(details().open).toBe(false);
  });
});
