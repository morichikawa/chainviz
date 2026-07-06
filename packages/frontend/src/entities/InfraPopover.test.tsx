import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { InfraEntity } from "./infraNode.js";
import { InfraPopover } from "./InfraPopover.js";

afterEach(cleanup);

const node: NodeEntity = {
  kind: "node",
  id: "reth-follower-1",
  containerName: "chainviz-reth-follower-1",
  ip: "172.20.0.101",
  ports: [8545],
  resources: { cpuPercent: 1.23, memMB: 100.7 },
  process: { name: "reth node", version: "1.0.0" },
  chainType: "ethereum",
  clientType: "reth",
  syncStatus: "synced",
  blockHeight: 10,
  headBlockHash: "0xabc",
  removable: true,
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

function renderPopover(entity: InfraEntity, lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={{}}>
        <InfraPopover entity={entity} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("InfraPopover role row (Issue #124 C)", () => {
  it("shows a role row with the bootnode value for a bootnode node", () => {
    renderPopover({ ...node, p2pRole: "bootnode" });
    expect(screen.getByText("役割")).toBeTruthy();
    expect(screen.getByText("ブートノード")).toBeTruthy();
  });

  it("does not show a role row for a peer node", () => {
    renderPopover({ ...node, p2pRole: "peer" });
    expect(screen.queryByText("役割")).toBeNull();
    expect(screen.queryByText("ブートノード")).toBeNull();
  });

  it("does not show a role row when p2pRole is undefined (旧スナップショット想定)", () => {
    const withoutRole: NodeEntity = { ...node };
    delete withoutRole.p2pRole;
    renderPopover(withoutRole);
    expect(screen.queryByText("役割")).toBeNull();
  });

  it("does not show a role row for a workbench (bootnode is a node-only concept)", () => {
    // ワークベンチには p2pRole フィールド自体が無い。役割行は node 分岐内に
    // あるため、型を欺いて bootnode を差し込んでも出ないことを固定する。
    const corrupted = { ...workbench, p2pRole: "bootnode" } as unknown as InfraEntity;
    renderPopover(corrupted);
    expect(screen.queryByText("役割")).toBeNull();
  });

  it("shows the role row regardless of removable (independent fields)", () => {
    // 役割行は removable と無関係。削除不可(compose起動)のブートノードでも出る。
    renderPopover({ ...node, p2pRole: "bootnode", removable: false });
    expect(screen.getByText("役割")).toBeTruthy();
    expect(screen.getByText("ブートノード")).toBeTruthy();
  });

  it("shows the role row alongside the sync/blockHeight fields for a syncing bootnode", () => {
    // 役割行は同期状態と独立。同期中でも役割行と同期行の両方が出る。
    renderPopover({ ...node, p2pRole: "bootnode", syncStatus: "syncing" });
    expect(screen.getByText("役割")).toBeTruthy();
    expect(screen.getByText("同期中")).toBeTruthy();
  });

  it("localizes the role row to English", () => {
    renderPopover({ ...node, p2pRole: "bootnode" }, "en");
    expect(screen.getByText("Role")).toBeTruthy();
    expect(screen.getByText("Bootnode")).toBeTruthy();
  });
});
