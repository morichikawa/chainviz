// 学習用砂場メニュー化（Issue #414）で、既存の「ハッシュのしくみを試す」
// 入口（Issue #401）の契約が本当に不変かを構造面から固定する回帰テスト。
// メニューの開閉そのものは ChainRibbonCard.demoMenu.test.tsx、各入口の
// クリック結果は .hashDemoEntry / .attack51DemoEntry のテストが扱う
// （CLAUDE.md の1ファイル1責務）。ここで見るのは:
//   - `<details>`/`<summary>` のネイティブな開閉セマンティクスが崩れていない
//     こと（summary が details の最初の子であること）
//   - 入口ボタンが React Flow のドラッグ抑制（`nodrag`）を保っていること
//     （メニュー化前の単一ボタンが持っていた性質。落とすとカードごと
//     ドラッグされてクリックできなくなる）
//   - 入口が今も subtitle-row 内にあり、testid・テキスト・並び順が変わって
//     いないこと（e2e シナリオと #415/#416 の追記が前提にする並び）
//   - メニューを閉じたままでも DOM 上には存在する（= 実ブラウザでは
//     非表示なので、e2e は必ず summary を先にクリックする必要がある）
//   - 同じメニューから2つの砂場を続けて開ける（ref 経由の閉じ処理が
//     2回目以降も効くこと）
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import { ChainRibbonCard } from "./ChainRibbonCard.js";
import type { ChainRibbonFlowNode } from "./chainRibbonNode.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";

afterEach(cleanup);

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

describe("ChainRibbonCard demo menu: native disclosure structure", () => {
  it("uses <details> with <summary> as its first child (native keyboard/AT behavior)", () => {
    renderCard();
    expect(details().tagName).toBe("DETAILS");
    expect(summary().tagName).toBe("SUMMARY");
    expect(details().firstElementChild).toBe(summary());
  });

  it("keeps both sandbox entries inside the same closed <details>", () => {
    renderCard();
    const hash = screen.getByTestId("chain-ribbon-hash-demo-open");
    const attack51 = screen.getByTestId("chain-ribbon-fifty-one-percent-demo-open");
    expect(details().open).toBe(false);
    // 閉じている間も DOM 上には存在する（jsdom では取得できてクリックも
    // 通るが、実ブラウザではレイアウト上非表示になる）。e2e が summary を
    // 先にクリックしなければならない理由がここ。
    expect(details().contains(hash)).toBe(true);
    expect(details().contains(attack51)).toBe(true);
    expect(hash.compareDocumentPosition(attack51) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("still lives in the subtitle row, next to the subtitle text", () => {
    renderCard();
    const subtitleRow = details().closest(".chain-ribbon-card__subtitle-row");
    expect(subtitleRow).toBeTruthy();
    expect(subtitleRow?.textContent).toContain("学習用の砂場");
  });
});

describe("ChainRibbonCard demo menu: canvas drag suppression is preserved", () => {
  it("covers the summary and every entry with a nodrag element (self or ancestor)", () => {
    // React Flow はドラッグ開始時に `nodrag` を「イベントの target から
    // 祖先へ遡って」探す（@xyflow/system の hasSelector）。したがって
    // `<details className="… nodrag">` があれば内側の summary/button も
    // 抑制対象になる。メニュー化前の単一ボタンが持っていた
    // 「入口をクリックしてもカードがドラッグされない」性質が保たれている
    // ことを、この探索と同じ `closest(".nodrag")` で確認する。
    renderCard();
    expect(details().className).toContain("nodrag");
    expect(summary().closest(".nodrag")).toBeTruthy();
    for (const testId of [
      "chain-ribbon-hash-demo-open",
      "chain-ribbon-fifty-one-percent-demo-open",
    ]) {
      expect(screen.getByTestId(testId).closest(".nodrag")).toBeTruthy();
    }
  });
});

describe("ChainRibbonCard demo menu: entry contract unchanged after the menu refactor", () => {
  it("keeps the hash demo entry's testid, label and button type", () => {
    renderCard();
    fireEvent.click(summary());
    const hash = screen.getByTestId("chain-ribbon-hash-demo-open");
    expect(hash.tagName).toBe("BUTTON");
    expect((hash as HTMLButtonElement).type).toBe("button");
    expect(hash.textContent).toBe("ハッシュのしくみを試す");
  });

  it("lists the hash demo entry first, so later sandboxes (#415/#416) append after it", () => {
    renderCard();
    fireEvent.click(summary());
    const items = [...details().querySelectorAll("button")].map((button) =>
      button.getAttribute("data-testid"),
    );
    expect(items[0]).toBe("chain-ribbon-hash-demo-open");
    expect(items).toContain("chain-ribbon-fifty-one-percent-demo-open");
  });
});

describe("ChainRibbonCard demo menu: repeated use", () => {
  it("can open the other sandbox from the menu a second time (ref-based close keeps working)", () => {
    renderCard();
    fireEvent.click(summary());
    fireEvent.click(screen.getByTestId("chain-ribbon-hash-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("hashChainDemo");
    expect(details().open).toBe(false);

    fireEvent.click(summary());
    expect(details().open).toBe(true);
    fireEvent.click(screen.getByTestId("chain-ribbon-fifty-one-percent-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe(
      "fiftyOnePercentAttackDemo",
    );
    expect(details().open).toBe(false);
  });

  it("tolerates a double click on an entry (same kind stays open, menu stays closed)", () => {
    renderCard();
    fireEvent.click(summary());
    const entry = screen.getByTestId("chain-ribbon-fifty-one-percent-demo-open");
    expect(() => {
      fireEvent.click(entry);
      fireEvent.click(entry);
    }).not.toThrow();
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe(
      "fiftyOnePercentAttackDemo",
    );
    expect(details().open).toBe(false);
  });
});
