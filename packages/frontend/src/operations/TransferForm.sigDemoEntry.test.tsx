// 送金フォーム内の「署名と検証のしくみを試す」文脈導線(Issue #402)が
// SidePanel を開くこと・SidePanelProvider が無い単体レンダーでも壊れない
// ことの確認。フォーム自体の他の挙動(送信・バリデーション等)は
// TransferForm.test.tsx / TransferForm.addressValidation.test.tsx が扱う
// (CLAUDE.md の1ファイル1責務。#401 の *.hashDemoEntry.test.tsx と同型)。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import { TransferForm } from "./TransferForm.js";
import type { WalletCandidate } from "./walletCandidates.js";

afterEach(cleanup);

const candidates: WalletCandidate[] = [];

function SidePanelViewProbe() {
  const { view } = useSidePanel();
  return <span data-testid="side-panel-view-kind">{view?.kind ?? "none"}</span>;
}

describe("TransferForm: signature demo entry point (Issue #402)", () => {
  it("renders without a SidePanelProvider (no-op click)", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <TransferForm walletCandidates={candidates} onSubmit={() => {}} />
      </LanguageProvider>,
    );
    const button = screen.getByTestId("operation-transfer-sig-demo-open");
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("exposes the entry as a real, non-submitting <button> with an accessible name", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <TransferForm walletCandidates={candidates} onSubmit={() => {}} />
      </LanguageProvider>,
    );
    const button = screen.getByRole("button", { name: "署名と検証のしくみを試す" });
    expect(button.tagName).toBe("BUTTON");
    // type="button"（"submit" ではない）でなければ、クリックがフォーム送信を
    // 誤って引き起こしてしまう（Issue #402: 送信ボタンの直前に置くため要注意）。
    expect((button as HTMLButtonElement).type).toBe("button");
  });

  it("opens the signatureDemo side panel view when clicked, without submitting the form", () => {
    const onSubmit = vi.fn();
    render(
      <LanguageProvider initialLanguage="ja">
        <SidePanelProvider>
          <TransferForm walletCandidates={candidates} onSubmit={onSubmit} />
          <SidePanelViewProbe />
        </SidePanelProvider>
      </LanguageProvider>,
    );
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("none");
    fireEvent.click(screen.getByTestId("operation-transfer-sig-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("signatureDemo");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
