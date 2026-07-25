// EclipseAttackDemoView の文言・i18n観点(ja/en 両方で主要な文言キーが表示
// されること)。操作フロー自体は EclipseAttackDemoView.test.tsx が扱う
// (CLAUDE.md の1ファイル1責務)。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ECLIPSE_DEMO_SLOT_COUNT } from "./eclipseAttackDemo.js";
import { EclipseAttackDemoView } from "./EclipseAttackDemoView.js";

afterEach(cleanup);

function renderView(lang: "ja" | "en") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={{}}>
        <EclipseAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("EclipseAttackDemoView: ja", () => {
  it("renders the Japanese labels for the pristine state", () => {
    renderView("ja");
    expect(
      screen.getByText(
        "ここは学習用の砂場です。実際のピア接続には影響しません。中央の「被害ノード」は8個の接続スロットを持ち、はじめは全スロットが正規ピアで満たされています。下の「攻撃者ピアを追加」を押すと、攻撃者が1つずつスロットを奪っていきます。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("被害ノード")).toBeTruthy();
    expect(screen.getByText("攻撃者ピアを追加")).toBeTruthy();
    expect(screen.getByText("リセット")).toBeTruthy();
    expect(screen.getByText("被害ノードが見ているチェーン")).toBeTruthy();
    expect(
      screen.getByText(
        "実際のeclipse攻撃では、攻撃者は多数の異なる身元（Sybil）を用意し、ノード発見の仕組み自体を操作して接続を乗っ取ります。この砂場では「スロットが1つずつ攻撃者に置き換わる」という部分だけに絞って簡略化しています。",
      ),
    ).toBeTruthy();
  });

  it("renders the Japanese eclipsed-state labels at 8/8", () => {
    renderView("ja");
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      fireEvent.click(screen.getByTestId("eclipse-demo-add-attacker"));
    }
    expect(
      screen.getByText(
        "被害ノードの接続スロットがすべて攻撃者に占められました。今、この被害ノードは攻撃者だけが作る偽のネットワークの中にいます。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("すべてのスロットが攻撃者に占められました")).toBeTruthy();
  });
});

describe("EclipseAttackDemoView: en", () => {
  it("renders the English labels for the pristine state", () => {
    renderView("en");
    expect(
      screen.getByText(
        'This is a learning sandbox. It doesn\'t affect real peer connections. The "victim node" in the center has 8 connection slots, all initially filled with honest peers. Press "Add attacker peer" below to watch the attacker take over slots one by one.',
      ),
    ).toBeTruthy();
    expect(screen.getByText("Victim node")).toBeTruthy();
    expect(screen.getByText("Add attacker peer")).toBeTruthy();
    expect(screen.getByText("Reset")).toBeTruthy();
    expect(screen.getByText("What the victim node sees")).toBeTruthy();
  });

  it("renders the English eclipsed-state labels at 8/8", () => {
    renderView("en");
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      fireEvent.click(screen.getByTestId("eclipse-demo-add-attacker"));
    }
    expect(
      screen.getByText(
        "All of the victim node's connection slots are now occupied by the attacker. This node is currently trapped inside a fake network made entirely by the attacker.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("All slots are occupied by the attacker")).toBeTruthy();
    expect(screen.getByText("#1 Alice → Attacker: 50 ETH")).toBeTruthy();
  });
});
