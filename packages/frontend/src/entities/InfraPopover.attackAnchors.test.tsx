import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { InfraEntity } from "./infraNode.js";
import { InfraPopover } from "./InfraPopover.js";

/**
 * 攻撃手法解説の土台（ARCHITECTURE.md §17.4、Issue #413）のうち、
 * `fiftyOnePercentAttack`/`reorg` への用語アンカーが「見ている tip」欄
 * （既存の `fork` アンカー、Issue #296）の近傍に出ることの確認。
 * 「見ている tip」欄自体の表示条件は InfraPopover.forkTip.test.tsx が
 * 別途扱う（CLAUDE.md「1ファイル1責務」をテストファイルにも適用）。
 */

afterEach(cleanup);

function createAnchorRef(): { current: HTMLElement | null } {
  return { current: document.createElement("div") };
}

const node: NodeEntity = {
  kind: "node",
  id: "reth-node-1",
  containerName: "chainviz-reth-1",
  ip: "172.20.0.10",
  ports: [8545],
  resources: { cpuPercent: 1, memMB: 100 },
  process: { name: "reth node" },
  chainType: "ethereum",
  clientType: "reth",
  syncStatus: "synced",
  blockHeight: 130,
  headBlockHash: "0xaaaa0082aaaa0082",
  removable: false,
};

// GlossaryTerm は用語が glossary に見つからない場合 data-testid を出さない
// （GlossaryTerm.tsx の unknown 分岐）ため、テスト対象キーを実際に含む
// glossary を渡す（InfraPopover.test.tsx の既存パターンと同じ）。
const glossary: Glossary = {
  fiftyOnePercentAttack: {
    key: "fiftyOnePercentAttack",
    name: { ja: "51%攻撃", en: "51% attack" },
    definition: { ja: "定義", en: "definition" },
    layer: "b-network",
    relatedTerms: [],
  },
  reorg: {
    key: "reorg",
    name: { ja: "リオーグ", en: "Reorg" },
    definition: { ja: "定義", en: "definition" },
    layer: "b-network",
    relatedTerms: [],
  },
};

const workbench: WorkbenchEntity = {
  kind: "workbench",
  id: "workbench-1",
  containerName: "chainviz-workbench-1",
  ip: "172.20.0.20",
  ports: [],
  resources: { cpuPercent: 0.5, memMB: 40 },
  process: { name: "node" },
  label: "ワークベンチ1",
  walletIds: [],
  removable: false,
};

function renderPopover(
  entity: InfraEntity,
  forkColorIndex?: number,
  options: { lang?: "ja" | "en"; glossaryOverride?: Glossary } = {},
) {
  return render(
    <LanguageProvider initialLanguage={options.lang ?? "ja"}>
      <GlossaryProvider glossary={options.glossaryOverride ?? glossary}>
        <InfraPopover
          anchorRef={createAnchorRef()}
          entity={entity}
          forkColorIndex={forkColorIndex}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

/** ポップオーバー内の `.infra-field` 行の並び（DOM順）。 */
function fieldRows(entityId: string): HTMLElement[] {
  const popover = screen.getByTestId(`infra-popover-${entityId}`);
  return [...popover.querySelectorAll<HTMLElement>(".infra-field")];
}

describe("InfraPopover attack term anchors (Issue #413)", () => {
  it("shows fiftyOnePercentAttack and reorg anchors when the following-tip row is shown", () => {
    renderPopover(node, 0);
    expect(screen.getByTestId(`infra-popover-attack-hint-${node.id}`)).toBeTruthy();
    expect(screen.getByTestId("glossary-term-fiftyOnePercentAttack")).toBeTruthy();
    expect(screen.getByTestId("glossary-term-reorg")).toBeTruthy();
  });

  it("does not show the attack hint row when the following-tip row is not shown (no fork)", () => {
    renderPopover(node, undefined);
    expect(screen.queryByTestId(`infra-popover-attack-hint-${node.id}`)).toBeNull();
    expect(screen.queryByTestId("glossary-term-fiftyOnePercentAttack")).toBeNull();
    expect(screen.queryByTestId("glossary-term-reorg")).toBeNull();
  });

  it("does not show the attack hint row when headBlockHash is empty even if forkColorIndex were set", () => {
    renderPopover({ ...node, headBlockHash: "" }, 0);
    expect(screen.queryByTestId(`infra-popover-attack-hint-${node.id}`)).toBeNull();
  });

  it("places the attack hint row immediately after the following-tip row", () => {
    // 「見ている tip」欄の近傍に置くこと自体が設計意図（ARCHITECTURE.md
    // §17.4）。間に別の欄が挟まると、どの欄に対する関連用語なのかが伝わらない。
    renderPopover(node, 0);
    const rows = fieldRows(node.id);
    const tipIndex = rows.findIndex((row) =>
      row.textContent?.includes("見ている tip"),
    );
    const hintIndex = rows.findIndex(
      (row) => row.dataset.testid === `infra-popover-attack-hint-${node.id}`,
    );
    expect(tipIndex).toBeGreaterThanOrEqual(0);
    expect(hintIndex).toBe(tipIndex + 1);
  });

  it("shows the hint row exactly once (not one row per anchored term)", () => {
    renderPopover(node, 0);
    expect(
      screen.getAllByTestId(`infra-popover-attack-hint-${node.id}`),
    ).toHaveLength(1);
  });

  it("labels the hint row in English when the language is en", () => {
    renderPopover(node, 0, { lang: "en" });
    const row = screen.getByTestId(`infra-popover-attack-hint-${node.id}`);
    expect(row.textContent ?? "").toContain("Related terms");
    // 用語名も英語側（glossary の name.en）で出る。
    expect(row.textContent ?? "").toContain("51% attack");
  });

  it("still renders the hint row when the glossary lacks the attack terms", () => {
    // 用語 YAML の該当エントリが壊れて読み飛ばされた場合（parse.ts は
    // name/definition が {ja,en} 揃わないエントリを落とす）でも、行自体は
    // 消えず GlossaryTerm の unknown フォールバック（下線なしの素テキスト）に
    // 縮退するだけであることを固定する。
    renderPopover(node, 0, { glossaryOverride: {} });
    const row = screen.getByTestId(`infra-popover-attack-hint-${node.id}`);
    expect(row.textContent ?? "").toContain("fiftyOnePercentAttack");
    expect(row.textContent ?? "").toContain("reorg");
    // アンカー（ホバー/クリックできる用語）としては出さない。
    expect(screen.queryByTestId("glossary-term-fiftyOnePercentAttack")).toBeNull();
    expect(screen.queryByTestId("glossary-term-reorg")).toBeNull();
  });

  it("does not show the attack hint row for a workbench card", () => {
    // 「見ている tip」欄は kind === "node" の分岐の中にあるため、ワーク
    // ベンチ（チェーンの先端を持たない）には攻撃ヒント行も出ない。
    renderPopover(workbench, 0);
    expect(
      screen.queryByTestId(`infra-popover-attack-hint-${workbench.id}`),
    ).toBeNull();
  });
});
