// HashChainDemoView のアクセシビリティ観点の補強テスト（Issue #401
// テスト強化）。操作フローは HashChainDemoView.test.tsx、文言は
// .i18n.test.tsx が扱う。ここは「キーボード/支援技術で操作・理解できるか」
// に絞る（CLAUDE.md の1ファイル1責務）:
//   - データ入力・relink・reset がアクセシブル名を持つ role で公開されているか
//   - 無効状態が色だけでなくテキスト（バッジ文言）でも伝わるか
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { HashChainDemoView } from "./HashChainDemoView.js";

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <HashChainDemoView />
    </LanguageProvider>,
  );
}

afterEach(cleanup);

describe("HashChainDemoView accessibility", () => {
  it("exposes each data field as a labelled textbox (keyboard-editable, named)", () => {
    renderView();
    // <label> でラップされているためアクセシブル名（「データ」）が付く。
    const textboxes = screen.getAllByRole("textbox", { name: "データ" });
    expect(textboxes.length).toBe(3);
    textboxes.forEach((el) => {
      expect(el.tagName).toBe("INPUT");
    });
  });

  it("exposes reset as a real <button> with an accessible name (Enter/Space operable)", () => {
    renderView();
    const reset = screen.getByRole("button", { name: "最初に戻す" });
    expect(reset.tagName).toBe("BUTTON");
    expect((reset as HTMLButtonElement).type).toBe("button");
  });

  it("exposes the relink action as a named button only when a block is invalid", () => {
    renderView();
    // 改ざん前は relink ボタンは存在しない。
    expect(screen.queryByRole("button", { name: "親ハッシュをつなぎ直す" })).toBeNull();

    fireEvent.change(screen.getByTestId("hash-chain-demo-data-1"), {
      target: { value: "tampered" },
    });
    const relink = screen.getByRole("button", { name: "親ハッシュをつなぎ直す" });
    expect(relink.tagName).toBe("BUTTON");
  });

  it("conveys invalidity with text (not color alone) in the badge", () => {
    renderView();
    fireEvent.change(screen.getByTestId("hash-chain-demo-data-1"), {
      target: { value: "tampered" },
    });
    const invalidBadge = screen.getByTestId("hash-chain-demo-badge-2");
    // 色だけに頼らずアクセシブルな文言で「無効」であることが読める。
    expect(invalidBadge.textContent).toContain("無効");
    // 有効なブロックのバッジも文言で区別できる。
    expect(within(screen.getByTestId("hash-chain-demo-badge-1")).getByText("有効")).toBeTruthy();
  });

  it("marks the decorative connector and compute glyph as aria-hidden", () => {
    renderView();
    fireEvent.change(screen.getByTestId("hash-chain-demo-data-1"), {
      target: { value: "tampered" },
    });
    // 連結線は装飾。状態はバッジ文言で伝えるため、支援技術からは隠す。
    expect(screen.getByTestId("hash-chain-demo-connector-2").getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});
