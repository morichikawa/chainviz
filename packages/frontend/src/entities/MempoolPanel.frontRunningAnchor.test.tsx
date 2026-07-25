// 攻撃手法解説の土台（ARCHITECTURE.md §17.4、Issue #413）: ヘッダー直下に
// 添えた frontRunning 用語アンカーの表示確認。パネルの他の挙動（tx行・
// ノード別txpool行のクリック等）は MempoolPanel.test.tsx が別途扱う
// （CLAUDE.md「1ファイル1責務」をテストファイルにも適用）。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { messages } from "../i18n/messages.js";
import type { MempoolNodeEntry, MempoolTxEntry } from "./mempoolList.js";
import { MempoolPanel } from "./MempoolPanel.js";

afterEach(cleanup);

const glossary: Glossary = {
  mempool: {
    key: "mempool",
    name: { ja: "mempool", en: "Mempool" },
    definition: { ja: "定義", en: "definition" },
    layer: "c-transaction",
    relatedTerms: [],
  },
  frontRunning: {
    key: "frontRunning",
    name: { ja: "フロントランニング", en: "Front-running" },
    definition: { ja: "定義", en: "definition" },
    layer: "c-transaction",
    relatedTerms: [],
  },
};

function txEntry(hash: string): MempoolTxEntry {
  return { hash, from: "0xaaaa", to: "0xbbbb", walletCardId: "wallet-1" };
}

function nodeEntry(nodeId: string): MempoolNodeEntry {
  return { nodeId, label: `chainviz-${nodeId}`, pending: 2, queued: 1 };
}

function wrap(
  lang: "ja" | "en" = "ja",
  props: {
    txEntries?: MempoolTxEntry[];
    overflowCount?: number;
    totalPendingCount?: number;
    nodeEntries?: MempoolNodeEntry[];
    glossaryOverride?: Glossary;
  } = {},
) {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={props.glossaryOverride ?? glossary}>
        <MempoolPanel
          txEntries={props.txEntries ?? []}
          overflowCount={props.overflowCount ?? 0}
          totalPendingCount={props.totalPendingCount ?? 0}
          nodeEntries={props.nodeEntries ?? []}
          onSelectTx={() => {}}
          onSelectNode={() => {}}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("MempoolPanel front-running anchor (Issue #413)", () => {
  it("shows a frontRunning anchor even when there are 0 pending tx (panel always renders, §11.3)", () => {
    wrap();
    expect(screen.getByTestId("mempool-panel-front-running-hint")).toBeTruthy();
    expect(screen.getByTestId("glossary-term-frontRunning")).toBeTruthy();
  });

  it("localizes the hint to English without leaking Japanese characters", () => {
    const { container } = wrap("en");
    const hint = container.querySelector('[data-testid="mempool-panel-front-running-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent ?? "").toContain("front-running");
    // ひらがな(3040-309f)・カタカナ(30a0-30ff)・CJK統合漢字(4e00-9fff)。
    expect(hint?.textContent ?? "").not.toMatch(/[぀-ヿ一-鿿]/);
  });

  it("shows the empty-state message and the hint together at 0 pending tx", () => {
    // 0件は「tx が滞りなく取り込まれている」という意味のある状態（§11.3）。
    // 空メッセージとヒントの両方が出る（ヒントが空表示を押しのけない）。
    wrap();
    expect(screen.getByTestId("mempool-panel-front-running-hint")).toBeTruthy();
    expect(screen.getByText(messages["mempoolPanel.empty"].ja)).toBeTruthy();
  });

  it("keeps the hint when tx rows and the overflow note are present", () => {
    // 上限超過（overflowCount > 0）の表示が増えてもヒントは1つだけ。
    wrap("ja", {
      txEntries: [txEntry("0x1111"), txEntry("0x2222")],
      overflowCount: 3,
      totalPendingCount: 5,
    });
    expect(screen.getAllByTestId("mempool-panel-front-running-hint")).toHaveLength(1);
    expect(screen.getByTestId("mempool-overflow")).toBeTruthy();
  });

  it("keeps the hint when only the per-node txpool section has rows", () => {
    // 上段（C層の pending 一覧）が空で下段（D層のノード別実数）だけがある
    // 組み合わせでも、ヒントはヘッダー直下に残る。
    wrap("ja", { nodeEntries: [nodeEntry("reth-1")] });
    expect(screen.getByTestId("mempool-panel-front-running-hint")).toBeTruthy();
    expect(screen.getByTestId("mempool-node-row-reth-1")).toBeTruthy();
  });

  it("places the hint right after the header, before the tx list", () => {
    wrap("ja", { txEntries: [txEntry("0x1111")], totalPendingCount: 1 });
    const panel = screen.getByTestId("mempool-panel");
    const children = [...panel.children];
    const headerIndex = children.findIndex((el) =>
      el.classList.contains("mempool-panel__header"),
    );
    const hintIndex = children.findIndex(
      (el) => el.getAttribute("data-testid") === "mempool-panel-front-running-hint",
    );
    const rowsIndex = children.findIndex((el) =>
      el.classList.contains("mempool-panel__rows"),
    );
    expect(headerIndex).toBe(0);
    expect(hintIndex).toBe(headerIndex + 1);
    expect(rowsIndex).toBe(hintIndex + 1);
  });

  it("composes the ja hint as prefix + anchor + suffix in that order", () => {
    // 文言そのものの整合は i18n.attackHintTrios.test.ts が見る。
    wrap();
    const hint = screen.getByTestId("mempool-panel-front-running-hint");
    expect(hint.textContent ?? "").toBe(
      messages["mempoolPanel.frontRunningHint.prefix"].ja +
        messages["mempoolPanel.frontRunningHint.term"].ja +
        messages["mempoolPanel.frontRunningHint.suffix"].ja,
    );
  });

  it("keeps the hint sentence readable when the glossary lacks frontRunning", () => {
    // 用語エントリが読み飛ばされても、表示テキスト（children）を渡している
    // ため生キーは露出しない。
    wrap("ja", { glossaryOverride: {} });
    const hint = screen.getByTestId("mempool-panel-front-running-hint");
    expect(hint.textContent ?? "").toContain(
      messages["mempoolPanel.frontRunningHint.term"].ja,
    );
    expect(hint.textContent ?? "").not.toContain("frontRunning");
    expect(screen.queryByTestId("glossary-term-frontRunning")).toBeNull();
  });
});
