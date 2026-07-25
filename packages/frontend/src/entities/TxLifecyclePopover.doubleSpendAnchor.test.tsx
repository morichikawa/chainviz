// 攻撃手法解説の土台（ARCHITECTURE.md §17.4、Issue #413）: 段階リスト直後の
// doubleSpend 用語アンカーの表示確認。ポップオーバーの他の挙動（段階の表示・
// 署名デモ導線等）は TxLifecyclePopover.test.tsx /
// TxLifecyclePopover.sigDemoEntry.test.tsx が別途扱う（CLAUDE.md
// 「1ファイル1責務」をテストファイルにも適用）。
import type { TransactionEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { messages } from "../i18n/messages.js";
import { TxLifecyclePopover } from "./TxLifecyclePopover.js";

afterEach(cleanup);

// GlossaryTerm は用語が glossary に見つからない場合 data-testid を出さない
// （GlossaryTerm.tsx の unknown 分岐）ため、テスト対象キーを実際に含む
// glossary を渡す。
const glossary: Glossary = {
  doubleSpend: {
    key: "doubleSpend",
    name: { ja: "ダブルスペンド", en: "Double-spend" },
    definition: { ja: "定義", en: "definition" },
    layer: "c-transaction",
    relatedTerms: [],
  },
};

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

function renderPopover(
  entity: TransactionEntity,
  options: { lang?: "ja" | "en"; glossaryOverride?: Glossary } = {},
) {
  const anchorRef = { current: document.createElement("div") };
  return render(
    <LanguageProvider initialLanguage={options.lang ?? "ja"}>
      <GlossaryProvider glossary={options.glossaryOverride ?? glossary}>
        <TxLifecyclePopover anchorRef={anchorRef} tx={entity} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("TxLifecyclePopover double-spend anchor (Issue #413)", () => {
  it("shows a doubleSpend anchor regardless of tx status", () => {
    const t = tx({ status: "pending" });
    renderPopover(t);
    expect(screen.getByTestId(`tx-lifecycle-double-spend-hint-${t.hash}`)).toBeTruthy();
    expect(screen.getByTestId("glossary-term-doubleSpend")).toBeTruthy();
  });

  it("still shows the anchor for an included tx", () => {
    const t = tx({ status: "included" });
    renderPopover(t);
    expect(screen.getByTestId(`tx-lifecycle-double-spend-hint-${t.hash}`)).toBeTruthy();
  });

  it("still shows the anchor for a failed tx", () => {
    // 失敗 tx は4段目が別文言（tx.lifecycle.desc.includedFailed）に分岐する
    // ため、段階リストの直後に置いたヒントが分岐に巻き込まれていないことを
    // 確認する。
    const t = tx({ status: "failed" });
    renderPopover(t);
    expect(screen.getByTestId(`tx-lifecycle-double-spend-hint-${t.hash}`)).toBeTruthy();
    expect(screen.getByTestId("glossary-term-doubleSpend")).toBeTruthy();
  });

  it("places the hint between the stage list and the signature demo button", () => {
    const t = tx();
    renderPopover(t);
    const popover = screen.getByTestId(`tx-lifecycle-popover-${t.hash}`);
    const children = [...popover.children];
    const stagesIndex = children.findIndex((el) =>
      el.classList.contains("tx-lifecycle-popover__stages"),
    );
    const hintIndex = children.findIndex(
      (el) =>
        el.getAttribute("data-testid") === `tx-lifecycle-double-spend-hint-${t.hash}`,
    );
    const buttonIndex = children.findIndex(
      (el) => el.getAttribute("data-testid") === `tx-lifecycle-sig-demo-open-${t.hash}`,
    );
    expect(stagesIndex).toBeGreaterThanOrEqual(0);
    expect(hintIndex).toBe(stagesIndex + 1);
    expect(buttonIndex).toBe(hintIndex + 1);
  });

  it("shows the hint exactly once (not once per lifecycle stage)", () => {
    const t = tx();
    renderPopover(t);
    expect(
      screen.getAllByTestId(`tx-lifecycle-double-spend-hint-${t.hash}`),
    ).toHaveLength(1);
  });

  it("localizes the hint to English without leaking Japanese characters", () => {
    const t = tx();
    renderPopover(t, { lang: "en" });
    const hint = screen.getByTestId(`tx-lifecycle-double-spend-hint-${t.hash}`);
    expect(hint.textContent ?? "").toContain("double-spend");
    // ひらがな(3040-309f)・カタカナ(30a0-30ff)・CJK統合漢字(4e00-9fff)。
    expect(hint.textContent ?? "").not.toMatch(/[぀-ヿ一-鿿]/);
  });

  it("composes the ja hint as prefix + anchor + suffix in that order", () => {
    // 3分割キーが1文として繋がること（文言そのものの整合は
    // i18n.attackHintTrios.test.ts が見る）。
    const t = tx();
    renderPopover(t);
    const hint = screen.getByTestId(`tx-lifecycle-double-spend-hint-${t.hash}`);
    expect(hint.textContent ?? "").toBe(
      messages["tx.lifecycle.doubleSpendHint.prefix"].ja +
        messages["tx.lifecycle.doubleSpendHint.term"].ja +
        messages["tx.lifecycle.doubleSpendHint.suffix"].ja,
    );
  });

  it("keeps the hint sentence readable when the glossary lacks doubleSpend", () => {
    // アンカーには表示テキスト（children）を渡しているため、用語エントリが
    // 読み飛ばされても生キーは露出せず文として成立する。
    const t = tx();
    renderPopover(t, { glossaryOverride: {} });
    const hint = screen.getByTestId(`tx-lifecycle-double-spend-hint-${t.hash}`);
    expect(hint.textContent ?? "").toContain(
      messages["tx.lifecycle.doubleSpendHint.term"].ja,
    );
    expect(hint.textContent ?? "").not.toContain("doubleSpend");
    expect(screen.queryByTestId("glossary-term-doubleSpend")).toBeNull();
  });
});
