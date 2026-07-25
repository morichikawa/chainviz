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

function renderPopover(entity: TransactionEntity) {
  const anchorRef = { current: document.createElement("div") };
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={glossary}>
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
});
