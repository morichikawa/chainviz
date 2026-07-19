// HashChainDemoView のアクセシビリティ観点の補強テスト（Issue #401
// テスト強化）。操作フローは HashChainDemoView.test.tsx、文言は
// .i18n.test.tsx が扱う。ここは「キーボード/支援技術で操作・理解できるか」
// に絞る（CLAUDE.md の1ファイル1責務）:
//   - データ入力・relink・reset がアクセシブル名を持つ role で公開されているか
//   - 無効状態が色だけでなくテキスト（バッジ文言）でも伝わるか
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { HashChainDemoView } from "./HashChainDemoView.js";

// Issue #406: 処理帯に keccak256 の GlossaryTerm アンカーが増えたため、
// useGlossary() が例外を投げないよう GlossaryProvider でラップする。
function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <HashChainDemoView />
      </GlossaryProvider>
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

  // Issue #406: 処理帯コンテナ自体は「装飾」ではなく、アルゴリズム名・x の
  // 中身を説明する実コンテンツのため aria-hidden を外した(回帰テスト)。
  // 装飾記号の f(x) / x = トークン単体は aria-hidden のままでよい。
  it("keeps the compute band container readable (not aria-hidden) while hiding only the f(x)/x= glyphs", () => {
    const { container } = renderView();
    const computeNodes = container.querySelectorAll(".hash-chain-demo__compute");
    expect(computeNodes.length).toBe(3);
    computeNodes.forEach((node) => expect(node.getAttribute("aria-hidden")).toBeNull());

    const glyphNodes = container.querySelectorAll(".hash-chain-demo__compute-fn");
    // 各ブロックにつき f(x) と x = の2つの装飾トークン。
    expect(glyphNodes.length).toBe(6);
    glyphNodes.forEach((node) => expect(node.getAttribute("aria-hidden")).toBe("true"));
  });

  // Issue #406 回帰: x の中身（実データの説明行）が、装飾用の aria-hidden
  // サブツリーに紛れ込んで支援技術から隠れていないこと。glyph の span だけを
  // aria-hidden にしたつもりが行ごと隠す、という取り違えを検出する。
  it("keeps the x-input explanation line reachable (no aria-hidden ancestor)", () => {
    renderView();
    const lines = screen.getAllByText(
      "ブロック番号 | 親ブロックのハッシュ | データ（上の3項目をこの順につなげた文字列です）",
    );
    expect(lines.length).toBe(3);
    lines.forEach((line) => {
      // 自身にも祖先にも aria-hidden="true" が無いこと。
      expect(line.closest('[aria-hidden="true"]')).toBeNull();
    });
  });

  it("keeps the algorithm-name text (keccak256 line) reachable (no aria-hidden ancestor)", () => {
    renderView();
    const labels = screen.getAllByText(
      (_, element) => element?.textContent === "keccak256 でハッシュ化",
    );
    expect(labels.length).toBeGreaterThanOrEqual(3);
    labels.forEach((label) => expect(label.closest('[aria-hidden="true"]')).toBeNull());
  });
});
