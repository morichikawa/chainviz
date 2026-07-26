// LongRangeAttackDemoView のアクセシビリティ観点の補強テスト(Issue #415
// UX設計 §10「a11y: checkpoint チップに aria-pressed、キーボード操作」)。
// 操作フロー・文言は他のテストファイルが扱う(CLAUDE.md の1ファイル1責務)。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { LongRangeAttackDemoView } from "./LongRangeAttackDemoView.js";

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <LongRangeAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

afterEach(cleanup);

describe("LongRangeAttackDemoView accessibility", () => {
  it("exposes each checkpoint chip as a real <button> with aria-pressed", () => {
    renderView();
    for (const number of [0, 1, 2, 3]) {
      const chip = screen.getByTestId(`long-range-demo-checkpoint-${number}`);
      expect(chip.tagName).toBe("BUTTON");
      expect((chip as HTMLButtonElement).type).toBe("button");
      expect(chip.hasAttribute("aria-pressed")).toBe(true);
    }
  });

  it("toggles aria-pressed to reflect the selected checkpoint (keyboard/AT-observable state)", () => {
    renderView();
    const chipZero = screen.getByTestId("long-range-demo-checkpoint-0");
    const chipTwo = screen.getByTestId("long-range-demo-checkpoint-2");
    expect(chipZero.getAttribute("aria-pressed")).toBe("true");
    expect(chipTwo.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(chipTwo);
    expect(chipZero.getAttribute("aria-pressed")).toBe("false");
    expect(chipTwo.getAttribute("aria-pressed")).toBe("true");
  });

  it("exposes reset as a real <button> with an accessible name (Enter/Space operable)", () => {
    renderView();
    const reset = screen.getByRole("button", { name: "最初に戻す" });
    expect(reset.tagName).toBe("BUTTON");
    expect((reset as HTMLButtonElement).type).toBe("button");
  });

  it("marks decorative connectors as aria-hidden (state is conveyed by tile styling/text, not the connector alone)", () => {
    renderView();
    expect(
      screen.getByTestId("long-range-demo-attacker-link-0").getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("conveys the vulnerable/protected finality verdict with text, not color alone", () => {
    renderView();
    const finalityVerdict = screen.getByTestId("long-range-demo-verdict-finality");
    expect(finalityVerdict.textContent).toContain("防げません");

    fireEvent.click(screen.getByTestId("long-range-demo-checkpoint-2"));
    expect(finalityVerdict.textContent).toContain("維持できます");
  });
});
