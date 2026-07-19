// SignatureDemoView のアクセシビリティ観点の補強テスト（Issue #402）。
// 操作フローは SignatureDemoView.test.tsx、文言は .i18n.test.tsx が扱う。
// ここは「キーボード/支援技術で操作・理解できるか」に絞る（#401 の
// HashChainDemoView.a11y.test.tsx と同じ観点。CLAUDE.md の1ファイル1責務）:
//   - 編集可能なフィールド・再署名・resetがアクセシブル名を持つ role で
//     公開されているか
//   - 有効/無効の状態が色だけでなくテキスト（バッジ文言）でも伝わるか
//   - 装飾用の計算アイコンが aria-hidden か
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SignatureDemoView } from "./SignatureDemoView.js";

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <SignatureDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

afterEach(cleanup);

describe("SignatureDemoView accessibility", () => {
  it("exposes the workbench 'to'/'amount' fields as labelled, keyboard-editable textboxes", () => {
    renderView();
    const toBoxes = screen.getAllByRole("textbox", { name: "宛先" });
    const amountBoxes = screen.getAllByRole("textbox", { name: "金額" });
    // 上ゾーン・下ゾーンでそれぞれ1つずつ、計2つ。
    expect(toBoxes.length).toBe(2);
    expect(amountBoxes.length).toBe(2);
    [...toBoxes, ...amountBoxes].forEach((el) => expect(el.tagName).toBe("INPUT"));
  });

  it("exposes reset as a real <button> with an accessible name", () => {
    renderView();
    const reset = screen.getByRole("button", { name: "最初に戻す" });
    expect(reset.tagName).toBe("BUTTON");
    expect((reset as HTMLButtonElement).type).toBe("button");
  });

  it("exposes resign actions as named buttons only when the demo is invalid", () => {
    renderView();
    expect(screen.queryByRole("button", { name: "攻撃者の鍵で署名し直す" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Alice が署名し直す（正しく送り直す）" }),
    ).toBeNull();

    fireEvent.change(screen.getByTestId("signature-demo-received-amount"), {
      target: { value: "999" },
    });
    expect(screen.getByRole("button", { name: "攻撃者の鍵で署名し直す" }).tagName).toBe("BUTTON");
    expect(
      screen.getByRole("button", { name: "Alice が署名し直す（正しく送り直す）" }).tagName,
    ).toBe("BUTTON");
  });

  it("conveys validity with text (not color alone) in the badge", () => {
    renderView();
    expect(screen.getByTestId("signature-demo-badge").textContent).toContain("有効");

    fireEvent.change(screen.getByTestId("signature-demo-received-amount"), {
      target: { value: "999" },
    });
    expect(screen.getByTestId("signature-demo-badge").textContent).toContain("無効");
  });

  // Issue #406: 処理帯コンテナ自体は「装飾」ではなく、アルゴリズム名・x の
  // 中身を説明する実コンテンツのため aria-hidden を外した(回帰テスト)。
  // 装飾記号の f(x)/f⁻¹(x)/x= トークン単体は aria-hidden のままでよい。
  it("keeps the compute band containers readable (not aria-hidden) while hiding only the f(x)/f⁻¹(x)/x= glyphs", () => {
    const { container } = renderView();
    const computeNodes = container.querySelectorAll(".signature-demo__compute");
    expect(computeNodes.length).toBe(2);
    computeNodes.forEach((node) => expect(node.getAttribute("aria-hidden")).toBeNull());

    const glyphNodes = container.querySelectorAll(".signature-demo__compute-fn");
    // 署名側(f(x)・x=)・検証側(f⁻¹(x)・x=)で計4つの装飾トークン。
    expect(glyphNodes.length).toBe(4);
    glyphNodes.forEach((node) => expect(node.getAttribute("aria-hidden")).toBe("true"));
  });

  // Issue #406 回帰: 署名側・検証側それぞれの x 行（実データの説明）が
  // aria-hidden サブツリーに紛れ込んでいないこと。glyph の span だけを
  // aria-hidden にしたつもりが行ごと隠す取り違えを検出する。
  it("keeps both x-input explanation lines reachable (no aria-hidden ancestor)", () => {
    renderView();
    const signLine = screen.getByText(
      (_, element) =>
        element?.textContent ===
        "keccak256(送信者 | 宛先 | 金額)。内容をまず keccak256 でハッシュ化し、そのハッシュに署名します。",
    );
    const verifyLine = screen.getByText(
      (_, element) =>
        element?.textContent ===
        "届いた署名 と keccak256(送信者 | 宛先 | 金額)。ハッシュは届いた内容から計算し直します。",
    );
    expect(signLine.closest('[aria-hidden="true"]')).toBeNull();
    expect(verifyLine.closest('[aria-hidden="true"]')).toBeNull();
  });
});
