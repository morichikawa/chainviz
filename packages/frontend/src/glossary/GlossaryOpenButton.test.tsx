// GlossaryOpenButton（Issue #313: ヘッダーの用語集トグルボタン）のテスト。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import { GlossaryOpenButton } from "./GlossaryOpenButton.js";

afterEach(cleanup);

/** テストから現在の SidePanelView を覗き見るための薄いプローブ。 */
function ViewProbe() {
  const { view } = useSidePanel();
  return <span data-testid="view-probe">{view ? JSON.stringify(view) : "null"}</span>;
}

/** テストから他 kind のパネルを開くための薄いプローブ。 */
function OpenContractSource() {
  const { open } = useSidePanel();
  return (
    <button
      type="button"
      data-testid="open-contract-source"
      onClick={() => open({ kind: "contractSource", address: "0xabc" })}
    >
      open contractSource
    </button>
  );
}

function renderButton() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <SidePanelProvider>
        <ViewProbe />
        <OpenContractSource />
        <GlossaryOpenButton />
      </SidePanelProvider>
    </LanguageProvider>,
  );
}

describe("GlossaryOpenButton", () => {
  it("renders the localized label and starts unpressed", () => {
    renderButton();
    const button = screen.getByTestId("glossary-open-button");
    expect(button.textContent).toBe("用語集");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens the glossary panel (no termKey) on click", () => {
    renderButton();
    fireEvent.click(screen.getByTestId("glossary-open-button"));
    expect(screen.getByTestId("view-probe").textContent).toBe(
      JSON.stringify({ kind: "glossary" }),
    );
    expect(screen.getByTestId("glossary-open-button").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("closes the glossary panel on a second click (toggle)", () => {
    renderButton();
    const button = screen.getByTestId("glossary-open-button");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByTestId("view-probe").textContent).toBe("null");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("replaces (does not just toggle closed) another open panel kind", () => {
    renderButton();
    fireEvent.click(screen.getByTestId("open-contract-source"));
    expect(screen.getByTestId("glossary-open-button").getAttribute("aria-pressed")).toBe(
      "false",
    );

    fireEvent.click(screen.getByTestId("glossary-open-button"));
    expect(screen.getByTestId("view-probe").textContent).toBe(
      JSON.stringify({ kind: "glossary" }),
    );
    expect(screen.getByTestId("glossary-open-button").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
