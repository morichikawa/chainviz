// 学習用砂場メニュー（Issue #414 →Issue #430 でロングレンジ攻撃デモも統合され
// 3項目になった）の「どの項目を押すとどのサイドパネルが開くか」の対応付けを、
// 3項目まとめて表で固定する。個々の入口の単体挙動（Provider 不在時など）は
// .hashDemoEntry / .attack51DemoEntry / .longRangeDemoEntry が、メニュー自体の
// 開閉は .demoMenu が、DOM 構造は .demoMenu.structure が扱う（CLAUDE.md の
// 1ファイル1責務）。ここで見るのは横並びになった3項目に固有の危険:
//   - 項目の取り違え（コピペで隣の kind を開いてしまう / ラベルと開くパネルが
//     食い違う）。#430 はボタンを別の場所から移設した変更なので、移設先で
//     onClick の中身がずれても testid だけでは気づけない
//   - 項目が増減・改名されたのにテストが追随していない（表の網羅性）
//   - 連続して別の砂場を開いたとき前の kind が残る（状態の持ち越し）
//   - 表示言語を切り替えたときにラベルだけ英語化され対応付けが崩れる
import type { BlockEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { Language } from "../i18n/i18n.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import { ChainRibbonCard } from "./ChainRibbonCard.js";
import type { ChainRibbonTile } from "./chainRibbon.js";
import type { ChainRibbonFlowNode } from "./chainRibbonNode.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";

afterEach(cleanup);

/**
 * メニューに並ぶ入口の期待値表。並び順も含めて実装と一致していることを
 * `lists exactly these entries…` で突き合わせるので、項目を増やすときは
 * ここに1行足すだけで全ケースが自動的に対象になる。
 */
const ENTRIES = [
  {
    testId: "chain-ribbon-hash-demo-open",
    kind: "hashChainDemo",
    ja: "ハッシュのしくみを試す",
    en: "Try how hashes work",
  },
  {
    testId: "chain-ribbon-fifty-one-percent-demo-open",
    kind: "fiftyOnePercentAttackDemo",
    ja: "51%攻撃のしくみを試す",
    en: "Try how a 51% attack works",
  },
  {
    testId: "chain-ribbon-long-range-demo-open",
    kind: "longRangeAttackDemo",
    ja: "ロングレンジ攻撃を体験する",
    en: "Try a long-range attack",
  },
] as const;

function block(hash: string, number: number): BlockEntity {
  return {
    kind: "block",
    number,
    parentHash: "0xparent",
    timestamp: 1_784_798_132,
    receivedAt: {},
    hash,
  };
}

function tiles(count: number): ChainRibbonTile[] {
  return Array.from({ length: count }, (_, index) => ({
    block: block(`0xblock-${index}`, index + 1),
    connectedToPrevious: index > 0,
  }));
}

function data(overrides: Partial<ChainRibbonFlowNode["data"]> = {}): ChainRibbonFlowNode["data"] {
  return {
    tiles: [],
    txCountByHash: new Map(),
    nodeLabelById: new Map(),
    landingHashes: new Set(),
    blocks: [],
    ...overrides,
  };
}

function SidePanelViewProbe() {
  const { view } = useSidePanel();
  return <span data-testid="side-panel-view-kind">{view?.kind ?? "none"}</span>;
}

function renderCard(options: { language?: Language; cardData?: ChainRibbonFlowNode["data"] } = {}) {
  const props = { data: options.cardData ?? data() } as unknown as Parameters<
    typeof ChainRibbonCard
  >[0];
  return render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage={options.language ?? "ja"}>
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <RibbonHoverProvider transactions={[]}>
              <ChainRibbonCard {...props} />
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

function openedKind(): string | null {
  return screen.getByTestId("side-panel-view-kind").textContent;
}

/** メニューを開いてから指定の入口を押す（実ブラウザでは閉じた状態では押せない）。 */
function openEntry(testId: string): void {
  fireEvent.click(summary());
  fireEvent.click(screen.getByTestId(testId));
}

describe("ChainRibbonCard demo menu: each entry routes to its own side panel (Issue #430)", () => {
  it("lists exactly these entries, in this order (guards against a silent add/rename)", () => {
    renderCard();
    fireEvent.click(summary());
    const rendered = [...details().querySelectorAll("button")].map((button) =>
      button.getAttribute("data-testid"),
    );
    expect(rendered).toEqual(ENTRIES.map((entry) => entry.testId));
  });

  it.each(ENTRIES)(
    "opens $kind (and nothing else) from the entry labelled $ja",
    ({ testId, kind, ja }) => {
      renderCard();
      expect(openedKind()).toBe("none");
      fireEvent.click(summary());
      // ラベルと開くパネルの対応そのものを固定する。testid だけを見ていると
      // 「ラベルはロングレンジ攻撃なのに 51%攻撃が開く」取り違えを見逃す。
      expect(screen.getByTestId(testId).textContent).toBe(ja);
      fireEvent.click(screen.getByTestId(testId));
      expect(openedKind()).toBe(kind);
      expect(details().open).toBe(false);
    },
  );

  it("maps the three entries to three distinct kinds when clicked in sequence", () => {
    // 1つのレンダーで順に押し、観測された kind の並びが期待どおりであること。
    // 「2項目が同じ kind を開く」コピペ事故は、個別ケースだけだと片方が
    // たまたま通ってしまうため、集合として distinct であることも見る。
    renderCard();
    const observed = ENTRIES.map((entry) => {
      openEntry(entry.testId);
      return openedKind();
    });
    expect(observed).toEqual(ENTRIES.map((entry) => entry.kind));
    expect(new Set(observed).size).toBe(ENTRIES.length);
  });
});

/** 順序対（from → to）。同じ項目同士は「二度押し」として別テストで扱う。 */
const SWITCHES = ENTRIES.flatMap((from) =>
  ENTRIES.filter((to) => to.kind !== from.kind).map((to) => ({ from, to })),
);

describe("ChainRibbonCard demo menu: switching between sandboxes leaves no stale view", () => {
  it.each(SWITCHES)("switches from $from.kind to $to.kind", ({ from, to }) => {
    renderCard();
    openEntry(from.testId);
    expect(openedKind()).toBe(from.kind);
    openEntry(to.testId);
    expect(openedKind()).toBe(to.kind);
    expect(details().open).toBe(false);
  });
});

describe("ChainRibbonCard demo menu: entries are independent of the ribbon's contents", () => {
  it.each([0, 1, 12])("routes correctly with %i block tile(s) rendered", (count) => {
    // 境界値: 空（empty state）・1件・複数件。タイル側もポップオーバー用の
    // 入口ボタンを持つため、カード側の入口が一意に取れることも確かめる
    // （旧専用行が復活して二重に出れば getByTestId 相当の一意性が崩れる）。
    renderCard({ cardData: data({ tiles: tiles(count) }) });
    fireEvent.click(summary());
    for (const entry of ENTRIES) {
      expect(screen.getAllByTestId(entry.testId)).toHaveLength(1);
    }
    fireEvent.click(screen.getByTestId("chain-ribbon-long-range-demo-open"));
    expect(openedKind()).toBe("longRangeAttackDemo");
  });
});

describe("ChainRibbonCard demo menu: degraded render without a SidePanelProvider", () => {
  function renderWithoutSidePanel() {
    const cardProps = { data: data() } as unknown as Parameters<typeof ChainRibbonCard>[0];
    return render(
      <ReactFlowProvider>
        <LanguageProvider initialLanguage="ja">
          <GlossaryProvider glossary={{}}>
            <RibbonHoverProvider transactions={[]}>
              <ChainRibbonCard {...cardProps} />
            </RibbonHoverProvider>
          </GlossaryProvider>
        </LanguageProvider>
      </ReactFlowProvider>,
    );
  }

  it.each(ENTRIES)("still closes the menu after clicking $testId (no throw)", ({ testId }) => {
    // `sidePanel?.open(...)` はオプショナル呼び出しなので何も起きないが、
    // その後の `closeDemoMenu()` まで到達しないと、開いたままのメニューが
    // 画面に残る。3項目とも同じ順序で書かれていることをここで固定する。
    renderWithoutSidePanel();
    fireEvent.click(summary());
    expect(() => fireEvent.click(screen.getByTestId(testId))).not.toThrow();
    expect(details().open).toBe(false);
  });
});

describe("ChainRibbonCard demo menu: label/kind pairing survives a language switch", () => {
  it.each(ENTRIES)("opens $kind from the English label of $kind", ({ testId, kind, en }) => {
    renderCard({ language: "en" });
    fireEvent.click(summary());
    expect(screen.getByTestId(testId).textContent).toBe(en);
    fireEvent.click(screen.getByRole("button", { name: en }));
    expect(openedKind()).toBe(kind);
    expect(details().open).toBe(false);
  });

  it("keeps the three English labels distinct (no copy-pasted label)", () => {
    const labels = ENTRIES.map((entry) => entry.en);
    expect(new Set(labels).size).toBe(ENTRIES.length);
  });
});
