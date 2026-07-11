import type { NodeEntity } from "@chainviz/shared";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import type { CommandActions } from "../commands/useCommands.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { CanvasToolbar, type CanvasToolbarProps } from "./CanvasToolbar.js";

// Issue #251: CanvasToolbar はノード追加ボタンの hint に GlossaryTerm を
// 直接埋め込むため、GlossaryProvider をテストレンダーに含める必要がある
// （useGlossary は GlossaryProvider 無しで呼ぶと例外を投げる）。CanvasToolbar は
// どのテストでも常に pair hint（GlossaryTerm）を構築するので、pair hint を
// 直接検証しないテストでもこの Provider は必須。
export const testGlossary: Glossary = {
  "el-cl-separation": {
    key: "el-cl-separation",
    name: { ja: "EL/CL分離", en: "EL/CL separation" },
    definition: {
      ja: "実行クライアントと合意クライアントを分離する構成",
      en: "The split between execution and consensus clients",
    },
    layer: "d-internal",
    relatedTerms: [],
  },
};

export function node(overrides: Partial<NodeEntity> = {}): NodeEntity {
  return {
    kind: "node",
    id: "reth-1",
    containerName: "chainviz-reth-1",
    ip: "172.20.0.2",
    ports: [8545],
    resources: { cpuPercent: 1, memMB: 100 },
    process: { name: "reth node" },
    chainType: "ethereum",
    clientType: "reth",
    syncStatus: "synced",
    blockHeight: 1,
    headBlockHash: "0x0",
    ...overrides,
  };
}

export function renderToolbar(
  actions: Partial<CommandActions> = {},
  props: CanvasToolbarProps = {},
  lang: "ja" | "en" = "ja",
) {
  const full: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    runWorkbenchOperation: vi.fn(),
    ...actions,
  };
  render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={testGlossary}>
        <CommandActionsProvider actions={full}>
          <CanvasToolbar {...props} />
        </CommandActionsProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
  return full;
}
