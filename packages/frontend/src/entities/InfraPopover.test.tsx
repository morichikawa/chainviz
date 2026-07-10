import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { InfraEntity } from "./infraNode.js";
import { InfraPopover } from "./InfraPopover.js";

const rpcEndpointGlossary: Glossary = {
  "rpc-endpoint": {
    key: "rpc-endpoint",
    name: { ja: "RPCエンドポイント", en: "RPC endpoint" },
    definition: { ja: "窓口となるノードのAPI", en: "The API of the gateway node" },
    layer: "a-infra",
    relatedTerms: [],
  },
};

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

function renderPopover(
  entity: InfraEntity,
  lang: "ja" | "en" = "ja",
  drivesNodeContainerName?: string,
  maxElBlockHeight?: number,
  drivenByContainerName?: string,
) {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={{}}>
        <InfraPopover
          entity={entity}
          drivesNodeContainerName={drivesNodeContainerName}
          maxElBlockHeight={maxElBlockHeight}
          drivenByContainerName={drivenByContainerName}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("InfraPopover data-testid instrumentation (Issue #198, ARCHITECTURE.md §8.5)", () => {
  it("exposes the popover root via data-testid keyed by the entity id", () => {
    renderPopover(node);
    expect(screen.getByTestId(`infra-popover-${node.id}`)).toBe(
      screen.getByRole("tooltip"),
    );
  });

  it("keys the testid by the workbench's id too", () => {
    renderPopover(workbench);
    expect(screen.getByTestId(`infra-popover-${workbench.id}`)).toBe(
      screen.getByRole("tooltip"),
    );
  });
});

describe("InfraPopover P2P role row (Issue #124 C, relabeled field.p2pRole in Issue #215)", () => {
  it("shows a P2P role row with the bootnode value for a bootnode node", () => {
    renderPopover({ ...node, p2pRole: "bootnode" });
    expect(screen.getByText("P2Pでの役割")).toBeTruthy();
    expect(screen.getByText("ブートノード")).toBeTruthy();
  });

  it("does not show a P2P role row for a peer node", () => {
    renderPopover({ ...node, p2pRole: "peer" });
    expect(screen.queryByText("P2Pでの役割")).toBeNull();
    expect(screen.queryByText("ブートノード")).toBeNull();
  });

  it("does not show a P2P role row when p2pRole is undefined (旧スナップショット想定)", () => {
    const withoutRole: NodeEntity = { ...node };
    delete withoutRole.p2pRole;
    renderPopover(withoutRole);
    expect(screen.queryByText("P2Pでの役割")).toBeNull();
  });

  it("does not show a P2P role row for a workbench (bootnode is a node-only concept)", () => {
    // ワークベンチには p2pRole フィールド自体が無い。役割行は node 分岐内に
    // あるため、型を欺いて bootnode を差し込んでも出ないことを固定する。
    const corrupted = { ...workbench, p2pRole: "bootnode" } as unknown as InfraEntity;
    renderPopover(corrupted);
    expect(screen.queryByText("P2Pでの役割")).toBeNull();
  });

  it("shows the P2P role row regardless of removable (independent fields)", () => {
    // 役割行は removable と無関係。削除不可(compose起動)のブートノードでも出る。
    renderPopover({ ...node, p2pRole: "bootnode", removable: false });
    expect(screen.getByText("P2Pでの役割")).toBeTruthy();
    expect(screen.getByText("ブートノード")).toBeTruthy();
  });

  it("shows the P2P role row alongside the sync/blockHeight fields for a syncing bootnode", () => {
    // 役割行は同期状態と独立。同期中でも役割行と同期行の両方が出る。
    renderPopover({ ...node, p2pRole: "bootnode", syncStatus: "syncing" });
    expect(screen.getByText("P2Pでの役割")).toBeTruthy();
    expect(screen.getByText("同期中")).toBeTruthy();
  });

  it("localizes the P2P role row to English", () => {
    renderPopover({ ...node, p2pRole: "bootnode" }, "en");
    expect(screen.getByText("P2P role")).toBeTruthy();
    expect(screen.getByText("Bootnode")).toBeTruthy();
  });
});

describe("InfraPopover node role row (Issue #215)", () => {
  it("shows the role row for an execution node with the EL client glossary anchor", () => {
    renderPopover({ ...node, nodeRole: "execution" });
    expect(screen.getByText("役割")).toBeTruthy();
    expect(screen.getByText("実行クライアント")).toBeTruthy();
  });

  it("shows the role row for a consensus node", () => {
    renderPopover({ ...node, clientType: "lighthouse", nodeRole: "consensus" });
    expect(screen.getByText("役割")).toBeTruthy();
    expect(screen.getByText("コンセンサスクライアント")).toBeTruthy();
  });

  it("shows the role row for a validator node", () => {
    renderPopover({ ...node, clientType: "lighthouse", nodeRole: "validator" });
    expect(screen.getByText("役割")).toBeTruthy();
    expect(screen.getByText("バリデーター")).toBeTruthy();
  });

  it("does not show the role row when nodeRole is undefined (legacy snapshot)", () => {
    renderPopover(node);
    expect(screen.queryByText("役割")).toBeNull();
  });

  it("does not show the role row for an unmapped nodeRole value", () => {
    renderPopover({ ...node, nodeRole: "sequencer" });
    expect(screen.queryByText("役割")).toBeNull();
  });

  it("does not show the role row for a workbench (node-only concept)", () => {
    const corrupted = {
      ...workbench,
      nodeRole: "execution",
    } as unknown as InfraEntity;
    renderPopover(corrupted);
    expect(screen.queryByText("役割")).toBeNull();
  });

  it("shows both the role row and the P2P role row together when both apply", () => {
    // 役割行(field.role)とP2P役割行(field.p2pRole)は別軸で共存する。
    renderPopover({ ...node, nodeRole: "execution", p2pRole: "bootnode" });
    expect(screen.getByText("役割")).toBeTruthy();
    expect(screen.getByText("実行クライアント")).toBeTruthy();
    expect(screen.getByText("P2Pでの役割")).toBeTruthy();
    expect(screen.getByText("ブートノード")).toBeTruthy();
  });

  it("localizes the role row to English", () => {
    renderPopover({ ...node, nodeRole: "validator" }, "en");
    expect(screen.getByText("Role")).toBeTruthy();
    expect(screen.getByText("Validator")).toBeTruthy();
  });
});

describe("InfraPopover sync/blockHeight visibility by nodeRole (Issue #215)", () => {
  it("shows the sync and blockHeight rows for an execution node", () => {
    renderPopover({ ...node, nodeRole: "execution" });
    expect(screen.getByText("同期状態")).toBeTruthy();
    expect(screen.getByText("ブロック高")).toBeTruthy();
  });

  it("shows the sync and blockHeight rows when nodeRole is undefined (legacy snapshot fallback)", () => {
    renderPopover(node);
    expect(screen.getByText("同期状態")).toBeTruthy();
    expect(screen.getByText("ブロック高")).toBeTruthy();
  });

  it("hides the sync and blockHeight rows for a validator node", () => {
    renderPopover({ ...node, nodeRole: "validator" });
    expect(screen.queryByText("同期状態")).toBeNull();
    expect(screen.queryByText("ブロック高")).toBeNull();
    expect(screen.queryByText("同期済み")).toBeNull();
    expect(screen.queryByText("10")).toBeNull();
  });

  it("still shows the role row for a validator even though sync fields are hidden", () => {
    renderPopover({ ...node, nodeRole: "validator" });
    expect(screen.getByText("役割")).toBeTruthy();
    expect(screen.getByText("バリデーター")).toBeTruthy();
  });
});

describe("InfraPopover drivenBy row (ARCHITECTURE.md §7.6.3 updated, Issue #215)", () => {
  it("shows a drivenBy row with the resolved consensus node's containerName", () => {
    renderPopover(node, "ja", undefined, undefined, "chainviz-lighthouse-1");
    expect(screen.getByText("駆動元（合意ノード）")).toBeTruthy();
    expect(screen.getByText("chainviz-lighthouse-1")).toBeTruthy();
  });

  it("does not show the drivenBy row when it cannot be resolved", () => {
    renderPopover(node);
    expect(screen.queryByText("駆動元（合意ノード）")).toBeNull();
  });

  it("does not show the drivenBy row for a workbench", () => {
    renderPopover(workbench, "ja", undefined, undefined, "chainviz-lighthouse-1");
    expect(screen.queryByText("駆動元（合意ノード）")).toBeNull();
  });

  it("localizes the drivenBy row to English", () => {
    renderPopover(node, "en", undefined, undefined, "chainviz-lighthouse-1");
    expect(screen.getByText("Driven by (consensus node)")).toBeTruthy();
  });

  it("shows both drivesNode and drivenBy rows together (defensive, not expected on a real node)", () => {
    renderPopover(node, "ja", "chainviz-reth-2", undefined, "chainviz-lighthouse-1");
    expect(screen.getByText("駆動する実行ノード")).toBeTruthy();
    expect(screen.getByText("chainviz-reth-2")).toBeTruthy();
    expect(screen.getByText("駆動元（合意ノード）")).toBeTruthy();
    expect(screen.getByText("chainviz-lighthouse-1")).toBeTruthy();
  });
});

describe("InfraPopover drivesNode row (ARCHITECTURE.md §7.6.3, Issue #188)", () => {
  it("shows a drivesNode row with the resolved execution node's containerName", () => {
    renderPopover(node, "ja", "chainviz-reth-1");
    expect(screen.getByText("駆動する実行ノード")).toBeTruthy();
    expect(screen.getByText("chainviz-reth-1")).toBeTruthy();
  });

  it("does not show the drivesNode row when it cannot be resolved", () => {
    renderPopover(node, "ja", undefined);
    expect(screen.queryByText("駆動する実行ノード")).toBeNull();
  });

  it("does not show the drivesNode row for a workbench", () => {
    renderPopover(workbench, "ja", "chainviz-reth-1");
    expect(screen.queryByText("駆動する実行ノード")).toBeNull();
  });

  it("localizes the drivesNode row to English", () => {
    renderPopover(node, "en", "chainviz-reth-1");
    expect(screen.getByText("Drives execution node")).toBeTruthy();
  });

  it("shows the drivesNode row alongside sync/blockHeight fields", () => {
    renderPopover({ ...node, syncStatus: "syncing" }, "ja", "chainviz-reth-1");
    expect(screen.getByText("同期中")).toBeTruthy();
    expect(screen.getByText("駆動する実行ノード")).toBeTruthy();
  });
});

describe("InfraPopover workbench RPC target field glossary anchor (Issue #215)", () => {
  it("anchors the rpc-endpoint glossary term on the RPC target label when it resolves", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={rpcEndpointGlossary}>
          <InfraPopover
            entity={workbench}
            rpcTargetContainerName="chainviz-reth-1"
          />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByText("操作先ノード")).toBeTruthy();
    expect(screen.getByText("chainviz-reth-1")).toBeTruthy();
    expect(screen.getByTestId("glossary-term-rpc-endpoint")).toBeTruthy();
  });

  it("does not render the anchor when the RPC target cannot be resolved", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <InfraPopover entity={workbench} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.queryByTestId("glossary-term-rpc-endpoint")).toBeNull();
  });
});

describe("InfraPopover txpool row (ARCHITECTURE.md §7.6.6, Issue #189)", () => {
  it("shows a txpool row with pending/queued counts when mempool is present", () => {
    renderPopover({ ...node, internals: { mempool: { pending: 3, queued: 2 } } });
    expect(screen.getByText("txpool")).toBeTruthy();
    expect(screen.getByText("pending 3 · queued 2")).toBeTruthy();
  });

  it("still shows the txpool row when both pending and queued are 0 (empty pool is information, not absence)", () => {
    // mempool 自体が観測できている以上、0/0 でも「空である」という情報として
    // 行を出す（省略 = 未観測 とは区別する）。
    renderPopover({ ...node, internals: { mempool: { pending: 0, queued: 0 } } });
    expect(screen.getByText("txpool")).toBeTruthy();
    expect(screen.getByText("pending 0 · queued 0")).toBeTruthy();
  });

  it("omits the txpool row when internals.mempool is undefined (unobserved)", () => {
    renderPopover({ ...node, internals: { syncStages: [] } });
    expect(screen.queryByText("txpool")).toBeNull();
  });

  it("omits the txpool row when internals itself is undefined", () => {
    renderPopover(node);
    expect(screen.queryByText("txpool")).toBeNull();
  });

  it("does not show a txpool row for a workbench (node-only concept)", () => {
    const corrupted = {
      ...workbench,
      internals: { mempool: { pending: 5, queued: 5 } },
    } as unknown as InfraEntity;
    renderPopover(corrupted);
    expect(screen.queryByText("txpool")).toBeNull();
  });
});

describe("InfraPopover sync stages section (ARCHITECTURE.md §7.6.5, Issue #189)", () => {
  const syncingNode: NodeEntity = {
    ...node,
    syncStatus: "syncing",
    blockHeight: 64,
    internals: {
      syncStages: [
        { stage: "Headers", checkpoint: 128 },
        { stage: "Bodies", checkpoint: 64 },
      ],
    },
  };

  it("renders the sync stages section when internals.syncStages has entries", () => {
    renderPopover(syncingNode, "ja", undefined, 128);
    expect(screen.getByText("同期ステージ")).toBeTruthy();
    expect(screen.getByText("ヘッダ取得")).toBeTruthy();
    expect(screen.getByText("ボディ取得")).toBeTruthy();
  });

  it("omits the sync stages section when syncStages is an empty array", () => {
    // 空配列は「ステージ情報が無い」に等しいので、見出しごと出さない
    // （InfraPopover.tsx が `.length > 0` でガードしている）。
    renderPopover({ ...node, internals: { syncStages: [] } }, "ja", undefined, 128);
    expect(screen.queryByText("同期ステージ")).toBeNull();
  });

  it("omits the sync stages section when internals.syncStages is undefined", () => {
    renderPopover(node);
    expect(screen.queryByText("同期ステージ")).toBeNull();
  });

  it("falls back to targetHeight 0 (no bars) when maxElBlockHeight prop is omitted", () => {
    const { container } = renderPopover(syncingNode);
    // 見出しとステージ行自体は出るが、分母0なのでバーは1本も出ない。
    expect(screen.getByText("同期ステージ")).toBeTruthy();
    expect(container.querySelectorAll(".sync-progress-bar")).toHaveLength(0);
  });

  it("renders one progress bar per stage when maxElBlockHeight is provided", () => {
    const { container } = renderPopover(syncingNode, "ja", undefined, 128);
    expect(container.querySelectorAll(".sync-progress-bar")).toHaveLength(2);
  });
});
