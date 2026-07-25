import type { NodeEntity } from "@chainviz/shared";
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

function renderPopover(entity: InfraEntity, forkColorIndex?: number) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={glossary}>
        <InfraPopover
          anchorRef={createAnchorRef()}
          entity={entity}
          forkColorIndex={forkColorIndex}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
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
});
