import type { NodeEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import type { CommandActions } from "../commands/useCommands.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { InfraNodeCard } from "./InfraNodeCard.js";
import type { InfraEntity } from "./infraNode.js";

/**
 * フォーク（一時的な分岐）色分け（ARCHITECTURE.md §9、Issue #296）専用の
 * カード表示テスト。既存の InfraNodeCard.test.tsx から関心を分けて新規
 * ファイルにする（CLAUDE.md「1ファイル1責務」をテストファイルにも適用）。
 */

afterEach(cleanup);

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
  headBlockHash: "0xaaaa0082",
  removable: false,
};

function renderCard(data: Record<string, unknown>) {
  const actions: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    runWorkbenchOperation: vi.fn(),
  };
  return render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <CommandActionsProvider actions={actions}>
            <InfraNodeCard
              {...({ data } as unknown as Parameters<typeof InfraNodeCard>[0])}
            />
          </CommandActionsProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

function cardClassName(entity: InfraEntity): string {
  return screen.getByTestId(`infra-card-${entity.id}`).className;
}

describe("InfraNodeCard fork color (Issue #296)", () => {
  it("does not add a fork color class by default (forkColorIndex omitted)", () => {
    renderCard({ entity: node });
    expect(cardClassName(node)).not.toMatch(/infra-card--fork-/);
  });

  it("adds the matching fork color class when data.forkColorIndex is set", () => {
    renderCard({ entity: node, forkColorIndex: 0 });
    expect(cardClassName(node)).toContain("infra-card--fork-0");
  });

  it("uses a different class for a different color index", () => {
    renderCard({ entity: node, forkColorIndex: 2 });
    expect(cardClassName(node)).toContain("infra-card--fork-2");
    expect(cardClassName(node)).not.toContain("infra-card--fork-0");
  });

  it("does not add a fork color class when forkColorIndex is explicitly undefined", () => {
    renderCard({ entity: node, forkColorIndex: undefined });
    expect(cardClassName(node)).not.toMatch(/infra-card--fork-/);
  });

  it("supports color index 0 without being confused with 'no fork' (falsy pitfall)", () => {
    // 0 は falsy な数値だが、有効な色 index として扱う必要がある
    // （`typeof forkColorIndex === "number"` で判定していることの回帰確認）。
    renderCard({ entity: node, forkColorIndex: 0 });
    expect(cardClassName(node)).toContain("infra-card--fork-0");
  });
});
