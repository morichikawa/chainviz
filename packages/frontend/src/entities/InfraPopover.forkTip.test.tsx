import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { InfraEntity } from "./infraNode.js";
import { InfraPopover } from "./InfraPopover.js";

/**
 * 「見ている tip」欄（フォーク色分け、ARCHITECTURE.md §9.3、Issue #296）
 * 専用のポップオーバー表示テスト。既存の InfraPopover.test.tsx から関心を
 * 分けて新規ファイルにする（CLAUDE.md「1ファイル1責務」をテストファイルにも
 * 適用）。
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

const workbench: WorkbenchEntity = {
  kind: "workbench",
  id: "workbench-1",
  containerName: "chainviz-workbench-1",
  ip: "172.20.0.151",
  ports: [],
  resources: { cpuPercent: 0.2, memMB: 48 },
  process: { name: "foundry" },
  label: "Carol",
  walletIds: [],
  removable: true,
};

function renderPopover(entity: InfraEntity, forkColorIndex?: number) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <InfraPopover
          anchorRef={createAnchorRef()}
          entity={entity}
          forkColorIndex={forkColorIndex}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("InfraPopover following-tip row (Issue #296)", () => {
  it("shows the following-tip row (shortened hash) when forkColorIndex is set", () => {
    renderPopover(node, 0);
    expect(screen.getByText("見ている tip")).toBeTruthy();
    // shortHex(headBlockHash) の短縮表示（先頭6桁 + 末尾4桁）。
    expect(screen.getByText("0xaaaa00…0082")).toBeTruthy();
  });

  it("does not show the following-tip row when forkColorIndex is undefined (no fork)", () => {
    renderPopover(node, undefined);
    expect(screen.queryByText("見ている tip")).toBeNull();
  });

  it("does not show the following-tip row when headBlockHash is empty even if forkColorIndex were set (defensive)", () => {
    renderPopover({ ...node, headBlockHash: "" }, 0);
    expect(screen.queryByText("見ている tip")).toBeNull();
  });

  it("does not show the following-tip row for a workbench (node-only field)", () => {
    const corrupted = { ...workbench, headBlockHash: "0xabc" } as unknown as InfraEntity;
    renderPopover(corrupted, 0);
    expect(screen.queryByText("見ている tip")).toBeNull();
  });

  it("supports color index 0 without being confused with 'no fork' (falsy pitfall)", () => {
    renderPopover(node, 0);
    expect(screen.getByText("見ている tip")).toBeTruthy();
  });
});
