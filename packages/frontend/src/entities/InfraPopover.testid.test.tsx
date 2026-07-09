import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { InfraEntity } from "./infraNode.js";
import { InfraPopover } from "./InfraPopover.js";

afterEach(cleanup);

// Issue #198: infra-popover-<entity.id> の testid が entity.id に追従すること
// （仮カード→実カードの id 差し替えなど）と、複数のポップオーバーが同時に
// 存在しても id ごとに一意に識別できることを固定する。基本の「node/workbench
// 双方で testid が出る」ケースは InfraPopover.test.tsx が持つため、こちらは
// id の変化・共存に関心を絞る。

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

function wrap(entity: InfraEntity) {
  return (
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <InfraPopover entity={entity} />
      </GlossaryProvider>
    </LanguageProvider>
  );
}

describe("InfraPopover testid tracks entity.id (Issue #198)", () => {
  it("moves the testid to the new id when the entity id changes (ghost card → real card swap)", () => {
    // 仮カード（ゴースト）は暫定 id を持ち、実エンティティ到着で安定 id に
    // 差し替わる（ARCHITECTURE.md のゴースト→実カード遷移）。testid は
    // その時点の entity.id に追従し、古い id の testid は残さない。
    const ghost: NodeEntity = { ...node, id: "ghost-pending-abc123" };
    const { rerender } = render(wrap(ghost));
    expect(screen.getByTestId("infra-popover-ghost-pending-abc123")).toBeTruthy();

    rerender(wrap({ ...node, id: "reth-follower-1" }));
    expect(screen.queryByTestId("infra-popover-ghost-pending-abc123")).toBeNull();
    expect(screen.getByTestId("infra-popover-reth-follower-1")).toBeTruthy();
  });

  it("keys the testid off id independently of containerName", () => {
    // 同じ containerName でも id が違えば別 testid になる（id が安定キー）。
    render(wrap({ ...node, id: "some-other-id" }));
    expect(screen.getByTestId("infra-popover-some-other-id")).toBeTruthy();
    expect(screen.queryByTestId("infra-popover-reth-follower-1")).toBeNull();
  });
});

describe("InfraPopover testid uniqueness across entities (Issue #198)", () => {
  it("identifies node and workbench popovers uniquely when both are rendered together", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <InfraPopover entity={node} />
          <InfraPopover entity={workbench} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByTestId(`infra-popover-${node.id}`)).toBeTruthy();
    expect(screen.getByTestId(`infra-popover-${workbench.id}`)).toBeTruthy();
    // それぞれ別の tooltip 要素。
    expect(screen.getByTestId(`infra-popover-${node.id}`)).not.toBe(
      screen.getByTestId(`infra-popover-${workbench.id}`),
    );
  });
});
