// EclipseAttackDemoView のアクセシビリティ観点の補強テスト（Issue #416）。
// 操作フローは EclipseAttackDemoView.test.tsx、文言は .i18n.test.tsx が扱う。
// ここは「キーボード/支援技術で操作・理解できるか」に絞る（CLAUDE.md の
// 1ファイル1責務）:
//   - 追加/リセットボタンが実 <button> でアクセシブル名を持つか
//   - 占有率・見ているチェーンの状態（正規/偽）が色だけでなくテキストで
//     伝わるか
//   - 各ピアスロットが色以外の手がかり（アクセシブル名）を持つか
//   - 占有率メーターが aria-live="polite" で変化を伝えるか
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ECLIPSE_DEMO_SLOT_COUNT } from "./eclipseAttackDemo.js";
import { EclipseAttackDemoView } from "./EclipseAttackDemoView.js";

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <EclipseAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

afterEach(cleanup);

describe("EclipseAttackDemoView accessibility", () => {
  it("exposes add-attacker and reset as real <button>s with accessible names", () => {
    renderView();
    const add = screen.getByRole("button", { name: "攻撃者ピアを追加" });
    expect(add.tagName).toBe("BUTTON");
    expect((add as HTMLButtonElement).type).toBe("button");

    const reset = screen.getByRole("button", { name: "リセット" });
    expect(reset.tagName).toBe("BUTTON");
    expect((reset as HTMLButtonElement).type).toBe("button");
  });

  it("gives each peer slot an accessible name distinguishing honest from attacker (not color alone)", () => {
    renderView();
    fireEvent.click(screen.getByTestId("eclipse-demo-add-attacker"));
    const attackerSlot = screen.getByTestId("eclipse-demo-slot-0");
    expect(attackerSlot.getAttribute("role")).toBe("img");
    expect(attackerSlot.getAttribute("aria-label")).toBe("攻撃者ピア");

    const honestSlot = screen.getByTestId("eclipse-demo-slot-1");
    expect(honestSlot.getAttribute("role")).toBe("img");
    expect(honestSlot.getAttribute("aria-label")).toBe("正規ピア");
  });

  it("conveys the real/fake chain state with text (not color alone) via the badge", () => {
    renderView();
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      fireEvent.click(screen.getByTestId("eclipse-demo-add-attacker"));
    }
    const badge = screen.getByTestId("eclipse-demo-badge");
    expect(badge.textContent).toContain("攻撃者だけが見せている内容です");
  });

  it("marks the occupancy meter text as aria-live=polite so screen readers hear updates", () => {
    renderView();
    const meterText = screen.getByTestId("eclipse-demo-meter").querySelector(
      ".eclipse-demo__meter-text",
    );
    expect(meterText?.getAttribute("aria-live")).toBe("polite");
  });

  it("marks decorative graph glyphs and connector lines as aria-hidden", () => {
    renderView();
    const slot = screen.getByTestId("eclipse-demo-slot-0");
    expect(slot.querySelector("line")?.getAttribute("aria-hidden")).toBe("true");
    expect(slot.querySelector("circle")?.getAttribute("aria-hidden")).toBe("true");
    expect(slot.querySelector("text")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("labels the peer graph as a whole via role=img and an accessible name", () => {
    renderView();
    const graph = screen.getByTestId("eclipse-demo-graph");
    expect(graph.getAttribute("role")).toBe("img");
    expect(graph.getAttribute("aria-label")).toBe("被害ノード");
  });
});
