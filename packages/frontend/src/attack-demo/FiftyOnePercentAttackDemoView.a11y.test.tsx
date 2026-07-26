// FiftyOnePercentAttackDemoView のアクセシビリティ観点の補強テスト
// (Issue #414)。操作フローは FiftyOnePercentAttackDemoView.test.tsx、
// 文言は .i18n.test.tsx、glossary アンカーは .glossaryAnchor.test.tsx が
// 扱う(CLAUDE.md の1ファイル1責務)。ここは「キーボード/支援技術で操作・
// 理解できるか」に絞る:
//   - バリデーターボタンが aria-pressed を正しく持つか
//   - 正準/非正準が色だけでなくバッジ文言でも伝わるか
//   - 逆転ラインのヒント文が aria-live="polite" を持つか
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { FiftyOnePercentAttackDemoView } from "./FiftyOnePercentAttackDemoView.js";

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <FiftyOnePercentAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

afterEach(cleanup);

describe("FiftyOnePercentAttackDemoView accessibility", () => {
  it("exposes every validator as a named, keyboard-operable <button> with aria-pressed", () => {
    renderView();
    for (let id = 1; id <= 7; id++) {
      const button = screen.getByTestId(`attack51-demo-validator-${id}`);
      expect(button.tagName).toBe("BUTTON");
      expect((button as HTMLButtonElement).type).toBe("button");
      // 初期状態は全員誠実(枝A) → aria-pressed=false。
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.getAttribute("aria-label")).toBe(
        `バリデーター${id}: 誠実（クリックで攻撃者が支配する状態に切り替え）`,
      );
    }
  });

  it("flips aria-pressed and the aria-label to the attacker-controlled description when toggled", () => {
    renderView();
    fireEvent.click(screen.getByTestId("attack51-demo-validator-1"));
    const button = screen.getByTestId("attack51-demo-validator-1");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe(
      "バリデーター1: 攻撃者が支配（クリックで誠実な状態に戻す）",
    );
  });

  it("conveys canonical/non-canonical status with text (not color alone)", () => {
    renderView();
    expect(screen.getByTestId("attack51-demo-branch-a-badge").textContent).toBe("正準");
    expect(screen.getByTestId("attack51-demo-branch-b-badge").textContent).toBe(
      "非正準（捨てられる枝）",
    );
  });

  it("marks the margin-to-flip hint as a live region so state changes are announced", () => {
    renderView();
    const hint = screen.getByTestId("attack51-demo-margin-hint");
    expect(hint.getAttribute("aria-live")).toBe("polite");
  });

  it("exposes reset as a real <button> with an accessible name", () => {
    renderView();
    const reset = screen.getByRole("button", { name: "最初に戻す" });
    expect(reset.tagName).toBe("BUTTON");
    expect((reset as HTMLButtonElement).type).toBe("button");
  });

  it("marks the connector lines between the common parent and the branches as decorative", () => {
    const { container } = renderView();
    const connectors = container.querySelectorAll(".attack51-demo__connector");
    expect(connectors.length).toBe(2);
    const connectorsContainer = container.querySelector(".attack51-demo__connectors");
    expect(connectorsContainer?.getAttribute("aria-hidden")).toBe("true");
  });
});
