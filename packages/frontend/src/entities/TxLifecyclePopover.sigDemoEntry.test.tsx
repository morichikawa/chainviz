// txライフサイクルポップオーバー末尾の「署名と検証のしくみを試す」文脈導線
// (Issue #402)が SidePanel を開くこと・SidePanelProvider が無い単体レンダー
// でも壊れないことの確認。ポップオーバーの他の挙動(段階の表示等)は
// TxLifecyclePopover.test.tsx が扱う(CLAUDE.md の1ファイル1責務。#401 の
// ChainRibbonPopover.hashDemoEntry.test.tsx と同型)。
import type { TransactionEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import { TxLifecyclePopover } from "./TxLifecyclePopover.js";

afterEach(cleanup);

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0xdeadbeef00000000",
    from: "0xa",
    to: "0xb",
    status: "pending",
    ...overrides,
  };
}

function SidePanelViewProbe() {
  const { view } = useSidePanel();
  return <span data-testid="side-panel-view-kind">{view?.kind ?? "none"}</span>;
}

describe("TxLifecyclePopover: signature demo entry point (Issue #402)", () => {
  it("renders without a SidePanelProvider (no-op click)", () => {
    const t = tx();
    const anchorRef = { current: document.createElement("div") };
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <TxLifecyclePopover anchorRef={anchorRef} tx={t} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    const button = screen.getByTestId(`tx-lifecycle-sig-demo-open-${t.hash}`);
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("exposes the contextual entry as a real <button> with an accessible name (keyboard reachable)", () => {
    const t = tx();
    const anchorRef = { current: document.createElement("div") };
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <TxLifecyclePopover anchorRef={anchorRef} tx={t} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    const button = screen.getByRole("button", { name: "署名と検証のしくみを試す" });
    expect(button.tagName).toBe("BUTTON");
    expect((button as HTMLButtonElement).type).toBe("button");
  });

  it("opens the signatureDemo side panel view when clicked, without bubbling to ancestors", () => {
    const t = tx();
    const anchorRef = { current: document.createElement("div") };
    const parentClick = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <div onClick={parentClick}>
              <TxLifecyclePopover anchorRef={anchorRef} tx={t} />
            </div>
            <SidePanelViewProbe />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("none");
    fireEvent.click(screen.getByTestId(`tx-lifecycle-sig-demo-open-${t.hash}`));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("signatureDemo");
    expect(parentClick).not.toHaveBeenCalled();
  });
});
