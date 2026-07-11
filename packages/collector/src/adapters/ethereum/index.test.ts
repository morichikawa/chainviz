import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { DockerPoller } from "../../docker/poller.js";
import type {
  DockerClient,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "../../docker/types.js";
import { EthereumAdapter } from "./index.js";

const zeroStats: DockerStatsResult = {
  cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  precpu_stats: { cpu_usage: { total_usage: 0 } },
  memory_stats: {},
};

interface Fixture {
  summary: DockerContainerSummary;
  top: DockerTopResult;
}

function clientFrom(fixtures: Fixture[]): DockerClient {
  const byId = new Map(fixtures.map((f) => [f.summary.Id, f]));
  return {
    listContainers: async () => fixtures.map((f) => f.summary),
    getContainer: (id: string) => ({
      top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
      stats: async () => zeroStats,
    }),
  };
}

const rethFixture: Fixture = {
  summary: {
    Id: "id-reth1",
    Names: ["/chainviz-ethereum-reth1-1"],
    Image: "ghcr.io/paradigmxyz/reth:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "reth1",
    },
    Ports: [{ PrivatePort: 8545, PublicPort: 8545, Type: "tcp" }],
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.1.1" } } },
  },
  top: {
    Titles: ["PID", "CMD"],
    Processes: [
      ["1", "/usr/local/bin/reth node"],
      ["2", "some-sidecar"],
    ],
  },
};

const workbenchFixture: Fixture = {
  summary: {
    Id: "id-wb",
    Names: ["/chainviz-ethereum-workbench-1"],
    Image: "ghcr.io/foundry-rs/foundry:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "workbench",
    },
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.3.1" } } },
  },
  top: { Titles: ["CMD"], Processes: [["sh -c sleep infinity"]] },
};

/** addNode が起動した reth（com.chainviz.managed=true）を模したフィクスチャ。 */
const managedRethFixture: Fixture = {
  summary: {
    Id: "id-reth3",
    Names: ["/chainviz-ethereum-reth3"],
    Image: "ghcr.io/paradigmxyz/reth:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "reth3",
      "com.chainviz.managed": "true",
      "com.chainviz.role": "execution",
    },
    Ports: [{ PrivatePort: 8545, PublicPort: 8545, Type: "tcp" }],
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.1.3" } } },
  },
  top: {
    Titles: ["PID", "CMD"],
    Processes: [["1", "/usr/local/bin/reth node"]],
  },
};

/** addWorkbench が起動した foundry（com.chainviz.managed=true）を模したフィクスチャ。 */
const managedWorkbenchFixture: Fixture = {
  summary: {
    Id: "id-wb-managed",
    Names: ["/chainviz-ethereum-workbench-alice-1"],
    Image: "ghcr.io/foundry-rs/foundry:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "workbench-alice",
      "com.chainviz.managed": "true",
      "com.chainviz.role": "workbench",
    },
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.3.2" } } },
  },
  top: { Titles: ["CMD"], Processes: [["sh -c sleep infinity"]] },
};

describe("EthereumAdapter.pollInfra", () => {
  it("normalizes a reth container into a NodeEntity with a stable id", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture])),
    );
    const partial = await adapter.pollInfra();

    expect(partial.chainType).toBe("ethereum");
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.kind).toBe("node");
    // 安定識別子はコンテナ ID ではない
    expect(node.id).toBe("chainviz-ethereum/reth1");
    expect(node.id).not.toBe("id-reth1");
    expect(node.containerName).toBe("chainviz-ethereum-reth1-1");
    expect(node.chainType).toBe("ethereum");
    expect(node.clientType).toBe("reth");
    expect(node.ip).toBe("172.28.1.1");
    expect(node.ports).toEqual([8545]);
    // 代表プロセスはクライアント種別に一致するものを選ぶ
    expect(node.process.name).toBe("reth");
    // A 層では同期状態・ブロック高は未取得のプレースホルダ
    expect(node.syncStatus).toBe("syncing");
    expect(node.blockHeight).toBe(0);
    expect(node.headBlockHash).toBe("");
    // compose 起動ノードには com.chainviz.managed ラベルが無いため削除不可
    // (Issue #103)。
    expect(node.removable).toBe(false);
  });

  it("normalizes a foundry container into a WorkbenchEntity", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([workbenchFixture])),
    );
    const partial = await adapter.pollInfra();

    const wb = partial.entities?.[0] as WorkbenchEntity;
    expect(wb.kind).toBe("workbench");
    expect(wb.id).toBe("chainviz-ethereum/workbench");
    expect(wb.label).toBe("workbench");
    expect(wb.walletIds).toEqual([]);
    expect(wb.process.name).toBe("sh");
    // compose 起動ワークベンチにも managed ラベルが無いため削除不可。
    expect(wb.removable).toBe(false);
  });

  it("sets walletIds from the derived address when a mnemonic is configured", async () => {
    // mnemonic を渡すと、ワークベンチのラベル index（無ければ 0）から導出した
    // アドレスが walletIds に載る。deriveAddress を差し替えて決定的に検証する。
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([workbenchFixture])),
      { mnemonic: "test mnemonic", deriveAddress: (_m, i) => `0xindex${i}` },
    );
    const partial = await adapter.pollInfra();
    const wb = partial.entities?.[0] as WorkbenchEntity;
    expect(wb.walletIds).toEqual(["0xindex0"]);
  });

  it("keeps walletIds empty when no mnemonic is configured", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([workbenchFixture])),
    );
    const partial = await adapter.pollInfra();
    const wb = partial.entities?.[0] as WorkbenchEntity;
    expect(wb.walletIds).toEqual([]);
  });

  it("normalizes a mixed set of containers", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture, workbenchFixture])),
    );
    const partial = await adapter.pollInfra();
    const kinds = partial.entities?.map((e) => e.kind);
    expect(kinds).toEqual(["node", "workbench"]);
  });

  it("returns an empty entity list when nothing is running", async () => {
    const adapter = new EthereumAdapter(new DockerPoller(clientFrom([])));
    const partial = await adapter.pollInfra();
    expect(partial.entities).toEqual([]);
  });

  it("keeps clientType from the image but process 'unknown' when top yields nothing", async () => {
    // top が空プロセスでも、イメージ名から reth と判定できる。代表プロセスは
    // 選べないので unknown にフォールバックする。
    const fixture: Fixture = {
      ...rethFixture,
      top: { Titles: ["CMD"], Processes: [] },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.clientType).toBe("reth");
    expect(node.process.name).toBe("unknown");
  });

  it("falls back to the first process when none matches the client type", async () => {
    // イメージからは reth と判定されるが、top には reth プロセスが無い場合、
    // 代表プロセスは先頭プロセスを採用する。
    const fixture: Fixture = {
      ...rethFixture,
      top: { Titles: ["CMD"], Processes: [["watchdog --pid 1"]] },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.clientType).toBe("reth");
    expect(node.process.name).toBe("watchdog");
  });

  it("uses the container id as entity id when no stable identifier is available", async () => {
    const fixture: Fixture = {
      summary: {
        Id: "raw-container-id",
        Names: [],
        Image: "reth",
        State: "running",
      },
      top: { Titles: ["CMD"], Processes: [["reth node"]] },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.id).toBe("raw-container-id");
    expect(node.containerName).toBe("");
  });

  it("marks a node as removable when the container carries the managed label (Issue #103)", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([managedRethFixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.removable).toBe(true);
  });

  it("marks a workbench as removable when the container carries the managed label (Issue #103)", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([managedWorkbenchFixture])),
    );
    const partial = await adapter.pollInfra();
    const wb = partial.entities?.[0] as WorkbenchEntity;
    expect(wb.removable).toBe(true);
  });

  it("does not mark a container as removable when the managed label has an unexpected value", async () => {
    // ラベル自体は存在するが値が "true" 以外（例: 手動で付けた誤ったラベル）
    // の場合は削除不可の安全側に倒す。
    const fixture: Fixture = {
      ...managedRethFixture,
      summary: {
        ...managedRethFixture.summary,
        Labels: {
          ...managedRethFixture.summary.Labels,
          "com.chainviz.managed": "false",
        },
      },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.removable).toBe(false);
  });

  // managed ラベルの値判定は厳密な === "true" 比較で行う。真偽値らしく見えるが
  // "true" 以外の値（大文字・数値表現・空文字など）はすべて安全側の削除不可に
  // 倒すことを、値ごとに網羅して固定する（Issue #103）。
  it.each(["TRUE", "True", "1", "yes", "", " true "])(
    "treats managed label value %j as non-removable (strict === true only)",
    async (labelValue) => {
      const fixture: Fixture = {
        ...managedRethFixture,
        summary: {
          ...managedRethFixture.summary,
          Labels: {
            ...managedRethFixture.summary.Labels,
            "com.chainviz.managed": labelValue,
          },
        },
      };
      const adapter = new EthereumAdapter(
        new DockerPoller(clientFrom([fixture])),
      );
      const partial = await adapter.pollInfra();
      const node = partial.entities?.[0] as NodeEntity;
      expect(node.removable).toBe(false);
    },
  );

  it("marks a node as non-removable when the container carries no Labels at all", async () => {
    // Docker サマリに Labels フィールドが無い場合、poller は空オブジェクトへ
    // 正規化する。managed キーが引けないので removable は false になる
    // （labels オブジェクトに該当キーが無い経路の明示的な検証）。
    const fixture: Fixture = {
      summary: {
        Id: "id-no-labels",
        Names: ["/chainviz-ethereum-reth9-1"],
        Image: "ghcr.io/paradigmxyz/reth:latest",
        State: "running",
        Ports: [{ PrivatePort: 8545, PublicPort: 8545, Type: "tcp" }],
        NetworkSettings: { Networks: { chain: { IPAddress: "172.28.1.9" } } },
      },
      top: { Titles: ["PID", "CMD"], Processes: [["1", "reth node"]] },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.kind).toBe("node");
    expect(node.removable).toBe(false);
  });

  it("marks a workbench as non-removable when the managed label has an unexpected value", async () => {
    // node 側と同じ判定が workbench 経路でも一貫して働くこと（片方だけ判定が
    // 漏れていないこと）の検証。
    const fixture: Fixture = {
      ...managedWorkbenchFixture,
      summary: {
        ...managedWorkbenchFixture.summary,
        Labels: {
          ...managedWorkbenchFixture.summary.Labels,
          "com.chainviz.managed": "false",
        },
      },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const wb = partial.entities?.[0] as WorkbenchEntity;
    expect(wb.kind).toBe("workbench");
    expect(wb.removable).toBe(false);
  });

  it("computes removable per entity across a mixed poll (node/workbench 両経路が独立に判定される)", async () => {
    // managed な node/workbench と unmanaged な node/workbench を 1 回の
    // ポーリングに混在させ、それぞれが自分のラベルに応じて独立に removable を
    // 得ること（共通の toEntity 経路を通り、片方の判定が他方へ漏れ出さないこと）
    // を確認する。
    const adapter = new EthereumAdapter(
      new DockerPoller(
        clientFrom([
          rethFixture, // unmanaged node
          workbenchFixture, // unmanaged workbench
          managedRethFixture, // managed node
          managedWorkbenchFixture, // managed workbench
        ]),
      ),
    );
    const partial = await adapter.pollInfra();
    const entities = (partial.entities ?? []) as (
      | NodeEntity
      | WorkbenchEntity
    )[];
    const byId = new Map(entities.map((e) => [e.id, e] as const));

    expect(byId.get("chainviz-ethereum/reth1")?.removable).toBe(false);
    expect(byId.get("chainviz-ethereum/workbench")?.removable).toBe(false);
    expect(byId.get("chainviz-ethereum/reth3")?.removable).toBe(true);
    expect(byId.get("chainviz-ethereum/workbench-alice")?.removable).toBe(
      true,
    );
    // kind とのペアも取り違えていないこと。
    expect(byId.get("chainviz-ethereum/reth3")?.kind).toBe("node");
    expect(byId.get("chainviz-ethereum/workbench-alice")?.kind).toBe(
      "workbench",
    );
  });

  it("marks a node as peer when it carries no p2p-role label (Issue #124)", async () => {
    // compose 起動の通常ノードには com.chainviz.p2p-role ラベルが無いため、
    // 「省略 = peer」のフォールバックにより peer と判定される。
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.p2pRole).toBe("peer");
  });

  it("marks a node as bootnode when the p2p-role label is exactly 'bootnode' (Issue #124)", async () => {
    // profiles/ethereum の reth1/beacon1 相当のフィクスチャ。
    const fixture: Fixture = {
      ...rethFixture,
      summary: {
        ...rethFixture.summary,
        Labels: {
          ...rethFixture.summary.Labels,
          "com.chainviz.p2p-role": "bootnode",
        },
      },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.p2pRole).toBe("bootnode");
  });

  it.each(["Bootnode", "BOOTNODE", "boot", "", " bootnode "])(
    "treats p2p-role label value %j as peer (strict === 'bootnode' only, Issue #124)",
    async (labelValue) => {
      // managed ラベルの判定（厳密な === "true"）と同じ流儀で、想定外の
      // 値はすべて安全側（peer）に倒すことを値ごとに網羅して固定する。
      const fixture: Fixture = {
        ...rethFixture,
        summary: {
          ...rethFixture.summary,
          Labels: {
            ...rethFixture.summary.Labels,
            "com.chainviz.p2p-role": labelValue,
          },
        },
      };
      const adapter = new EthereumAdapter(
        new DockerPoller(clientFrom([fixture])),
      );
      const partial = await adapter.pollInfra();
      const node = partial.entities?.[0] as NodeEntity;
      expect(node.p2pRole).toBe("peer");
    },
  );

  it("marks a node as peer when the container carries no Labels at all (Issue #124)", async () => {
    const fixture: Fixture = {
      summary: {
        Id: "id-no-labels-p2p",
        Names: ["/chainviz-ethereum-reth10-1"],
        Image: "ghcr.io/paradigmxyz/reth:latest",
        State: "running",
        Ports: [{ PrivatePort: 8545, PublicPort: 8545, Type: "tcp" }],
        NetworkSettings: { Networks: { chain: { IPAddress: "172.28.1.10" } } },
      },
      top: { Titles: ["PID", "CMD"], Processes: [["1", "reth node"]] },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.p2pRole).toBe("peer");
  });

  it("marks an addNode-created node as peer even though it is managed (Issue #124)", async () => {
    // addNode で追加したノードは常に peer 役であり、node-lifecycle.ts は
    // p2p-role ラベルを付与しない設計（#124 の設計どおり）。managed ラベルの
    // 有無とは独立して peer になることを確認する。
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([managedRethFixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.p2pRole).toBe("peer");
  });

  it("marks a validator client (VC) node as p2pRole 'none' (Issue #214, judged via com.chainviz.role since Issue #246)", async () => {
    // lighthouse の validator1/validator2 は com.chainviz.role ラベルが
    // "validator" で、libp2p の P2P ネットワークに参加しない（beacon へ
    // Beacon API で接続するのみ）。frontend が「接続確立中」エッジの対象から
    // 除外できるよう、p2pRole は "none" になる（isValidatorService 参照）。
    const validatorFixture: Fixture = {
      summary: {
        Id: "id-validator1",
        Names: ["/chainviz-ethereum-validator1-1"],
        Image: "sigp/lighthouse:latest",
        State: "running",
        Labels: {
          "com.docker.compose.project": "chainviz-ethereum",
          "com.docker.compose.service": "validator1",
          "com.chainviz.role": "validator",
        },
        NetworkSettings: { Networks: { chain: { IPAddress: "172.28.0.3" } } },
      },
      top: {
        Titles: ["PID", "CMD"],
        Processes: [["1", "lighthouse vc"]],
      },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([validatorFixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.clientType).toBe("lighthouse");
    expect(node.p2pRole).toBe("none");
  });

  it("does not misclassify a service whose name contains 'validator' but whose role label is not 'validator' (regression test for Issue #246)", async () => {
    // Issue #214 時点の実装は compose サービス名への部分一致で VC を判定して
    // いたため、将来の別チェーンプロファイルで "validator" を含む execution
    // ノードの service 名（例: "tx-validator1"）を誤って p2pRole: "none" に
    // 分類しうる、という指摘が #246。ラベルベースの現在の実装ではこの
    // 誤判定が起きないことを確認する。
    const rethNamedLikeValidatorFixture: Fixture = {
      summary: {
        Id: "id-tx-validator1",
        Names: ["/chainviz-ethereum-tx-validator1-1"],
        Image: "ghcr.io/paradigmxyz/reth:latest",
        State: "running",
        Labels: {
          "com.docker.compose.project": "chainviz-ethereum",
          "com.docker.compose.service": "tx-validator1",
          "com.chainviz.role": "execution",
        },
        Ports: [{ PrivatePort: 8545, PublicPort: 8545, Type: "tcp" }],
        NetworkSettings: { Networks: { chain: { IPAddress: "172.28.1.9" } } },
      },
      top: {
        Titles: ["PID", "CMD"],
        Processes: [["1", "reth node"]],
      },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethNamedLikeValidatorFixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.clientType).toBe("reth");
    expect(node.p2pRole).toBe("peer");
  });

  it("does not normalize the role label's case; an uppercase 'VALIDATOR' value is not treated as a VC (Issue #246)", async () => {
    // com.chainviz.role は collector が生成する値ではなく compose /
    // node-lifecycle.ts が付与する固定値のみを想定するため、旧実装
    // （compose サービス名への大文字小文字を無視した部分一致）にあった
    // ゆらぎ吸収は引き継がない。
    const validatorFixture: Fixture = {
      summary: {
        Id: "id-validator-upper",
        Names: ["/chainviz-ethereum-VALIDATOR2-1"],
        Image: "sigp/lighthouse:latest",
        State: "running",
        Labels: {
          "com.docker.compose.project": "chainviz-ethereum",
          "com.docker.compose.service": "VALIDATOR2",
          "com.chainviz.role": "VALIDATOR",
        },
        NetworkSettings: { Networks: { chain: { IPAddress: "172.28.0.4" } } },
      },
      top: {
        Titles: ["PID", "CMD"],
        Processes: [["1", "lighthouse vc"]],
      },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([validatorFixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.p2pRole).toBe("peer");
  });

  it("prefers the bootnode label over the validator role label when both are present (Issue #214)", async () => {
    // 現行構成では起こり得ない組み合わせだが、優先順位（ラベル > VC判定）を
    // 契約として固定しておく。
    const validatorFixture: Fixture = {
      summary: {
        Id: "id-validator-bootnode",
        Names: ["/chainviz-ethereum-validator1-1"],
        Image: "sigp/lighthouse:latest",
        State: "running",
        Labels: {
          "com.docker.compose.project": "chainviz-ethereum",
          "com.docker.compose.service": "validator1",
          "com.chainviz.role": "validator",
          "com.chainviz.p2p-role": "bootnode",
        },
        NetworkSettings: { Networks: { chain: { IPAddress: "172.28.0.5" } } },
      },
      top: {
        Titles: ["PID", "CMD"],
        Processes: [["1", "lighthouse vc"]],
      },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([validatorFixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.p2pRole).toBe("bootnode");
  });

  it("keeps a beacon node's p2pRole as peer even though it shares the lighthouse client type with validators (Issue #214, #246)", async () => {
    // beacon も lighthouse クライアントだが com.chainviz.role は "consensus"
    // であり "validator" ではないため、通常どおり peer のままであることを
    // 確認する（VC 判定が誤って beacon にも波及しないことの回帰防止）。
    const beaconFixture: Fixture = {
      summary: {
        Id: "id-beacon1",
        Names: ["/chainviz-ethereum-beacon1-1"],
        Image: "sigp/lighthouse:latest",
        State: "running",
        Labels: {
          "com.docker.compose.project": "chainviz-ethereum",
          "com.docker.compose.service": "beacon1",
          "com.chainviz.role": "consensus",
        },
        NetworkSettings: { Networks: { chain: { IPAddress: "172.28.2.1" } } },
      },
      top: {
        Titles: ["PID", "CMD"],
        Processes: [["1", "lighthouse bn"]],
      },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([beaconFixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.p2pRole).toBe("peer");
  });

  it("keeps a node's p2pRole as peer when it has no com.chainviz.role label at all (Issue #246)", async () => {
    // rethFixture は com.chainviz.role ラベルを持たない。isValidatorService
    // は「ラベルが無い場合は false」の流儀のため、通常どおり peer になる。
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.p2pRole).toBe("peer");
  });

  it.each(["execution", "consensus", "validator"])(
    "transcribes the com.chainviz.role label value %j as-is into NodeEntity.nodeRole (Issue #215)",
    async (roleValue) => {
      // collector は値の妥当性検証・解釈をせず、ROLE_LABEL の生値をそのまま
      // 転記する（execution/consensus/validator の意味づけはフロントの
      // チェーンプロファイル表現セットの責務）。
      const fixture: Fixture = {
        ...rethFixture,
        summary: {
          ...rethFixture.summary,
          Labels: {
            ...rethFixture.summary.Labels,
            "com.chainviz.role": roleValue,
          },
        },
      };
      const adapter = new EthereumAdapter(
        new DockerPoller(clientFrom([fixture])),
      );
      const partial = await adapter.pollInfra();
      const node = partial.entities?.[0] as NodeEntity;
      expect(node.nodeRole).toBe(roleValue);
    },
  );

  it("omits nodeRole when the container carries no com.chainviz.role label (Issue #215)", async () => {
    // rethFixture は com.chainviz.role ラベルを持たない（省略 = 不明の流儀）。
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.nodeRole).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(node, "nodeRole")).toBe(false);
  });

  it("omits nodeRole when the com.chainviz.role label is an empty string (Issue #215)", async () => {
    const fixture: Fixture = {
      ...rethFixture,
      summary: {
        ...rethFixture.summary,
        Labels: {
          ...rethFixture.summary.Labels,
          "com.chainviz.role": "",
        },
      },
    };
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([fixture])),
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.[0] as NodeEntity;
    expect(node.nodeRole).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(node, "nodeRole")).toBe(false);
  });

  it("rejects when the underlying poller fails to list containers", async () => {
    const failing: DockerClient = {
      listContainers: async () => {
        throw new Error("daemon down");
      },
      getContainer: () => {
        throw new Error("unused");
      },
    };
    const adapter = new EthereumAdapter(new DockerPoller(failing));
    await expect(adapter.pollInfra()).rejects.toThrow("daemon down");
  });
});

/** rethFixture とは別 IP を持つ、2つ目のワークベンチ（複数ワークベンチの一括解決確認用）。 */
const secondWorkbenchFixture: Fixture = {
  summary: {
    Id: "id-wb-2",
    Names: ["/chainviz-ethereum-workbench-2"],
    Image: "ghcr.io/foundry-rs/foundry:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "workbench-2",
    },
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.3.9" } } },
  },
  top: { Titles: ["CMD"], Processes: [["sh -c sleep infinity"]] },
};

describe("EthereumAdapter.pollInfra rpcTargetNodeId resolution (Issue #123)", () => {
  it("sets rpcTargetNodeId on every workbench when rpcTargetHost matches an observed node's ip", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(
        clientFrom([rethFixture, workbenchFixture, secondWorkbenchFixture]),
      ),
      { rpcTargetHost: "172.28.1.1" },
    );
    const partial = await adapter.pollInfra();
    const node = partial.entities?.find((e) => e.kind === "node") as NodeEntity;
    const workbenches = partial.entities?.filter(
      (e): e is WorkbenchEntity => e.kind === "workbench",
    );
    expect(workbenches).toHaveLength(2);
    for (const wb of workbenches ?? []) {
      expect(wb.rpcTargetNodeId).toBe(node.id);
    }
  });

  it("omits rpcTargetNodeId when rpcTargetHost is not configured (旧設定・未指定との互換)", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture, workbenchFixture])),
    );
    const partial = await adapter.pollInfra();
    const workbench = partial.entities?.find(
      (e) => e.kind === "workbench",
    ) as WorkbenchEntity;
    expect(workbench.rpcTargetNodeId).toBeUndefined();
  });

  it("omits rpcTargetNodeId when rpcTargetHost matches no observed node's ip", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture, workbenchFixture])),
      { rpcTargetHost: "10.0.0.99" },
    );
    const partial = await adapter.pollInfra();
    const workbench = partial.entities?.find(
      (e) => e.kind === "workbench",
    ) as WorkbenchEntity;
    expect(workbench.rpcTargetNodeId).toBeUndefined();
  });

  it("re-resolves on every poll instead of caching a fixed result (ブートノード再作成への追従)", async () => {
    // 1 回目のポーリングでは対象ノードがまだ観測されず、2 回目で現れるケースを
    // 模す。固定の解決結果を埋め込んでいれば 2 回目も unresolved のままになる。
    let containers: DockerContainerSummary[] = [workbenchFixture.summary];
    const byId = new Map([
      [rethFixture.summary.Id, rethFixture],
      [workbenchFixture.summary.Id, workbenchFixture],
    ]);
    const client: DockerClient = {
      listContainers: async () => containers,
      getContainer: (id: string) => ({
        top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
        stats: async () => zeroStats,
      }),
    };
    const adapter = new EthereumAdapter(new DockerPoller(client), {
      rpcTargetHost: "172.28.1.1",
    });

    const first = await adapter.pollInfra();
    const firstWorkbench = first.entities?.find(
      (e) => e.kind === "workbench",
    ) as WorkbenchEntity;
    expect(firstWorkbench.rpcTargetNodeId).toBeUndefined();

    containers = [rethFixture.summary, workbenchFixture.summary];
    const second = await adapter.pollInfra();
    const secondNode = second.entities?.find(
      (e) => e.kind === "node",
    ) as NodeEntity;
    const secondWorkbench = second.entities?.find(
      (e) => e.kind === "workbench",
    ) as WorkbenchEntity;
    expect(secondWorkbench.rpcTargetNodeId).toBe(secondNode.id);
  });
});

const beaconFixture: Fixture = {
  summary: {
    Id: "id-beacon1",
    Names: ["/chainviz-ethereum-beacon1-1"],
    Image: "sigp/lighthouse:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "beacon1",
    },
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.2.1" } } },
  },
  top: { Titles: ["CMD"], Processes: [["lighthouse bn"]] },
};

/** validator も lighthouse イメージだが beacon サービス名を持たない（Issue #186）。 */
const validatorFixture: Fixture = {
  summary: {
    Id: "id-validator1",
    Names: ["/chainviz-ethereum-validator1-1"],
    Image: "sigp/lighthouse:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "validator1",
    },
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.0.3" } } },
  },
  top: { Titles: ["CMD"], Processes: [["lighthouse vc"]] },
};

/** 2 組目の EL/CL ペア（複数ノード環境での対応付けを検証するため）。 */
const reth2Fixture: Fixture = {
  summary: {
    Id: "id-reth2",
    Names: ["/chainviz-ethereum-reth2-1"],
    Image: "ghcr.io/paradigmxyz/reth:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "reth2",
    },
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.1.2" } } },
  },
  top: { Titles: ["CMD"], Processes: [["reth node"]] },
};

const beacon2Fixture: Fixture = {
  summary: {
    Id: "id-beacon2",
    Names: ["/chainviz-ethereum-beacon2-1"],
    Image: "sigp/lighthouse:latest",
    State: "running",
    Labels: {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": "beacon2",
    },
    NetworkSettings: { Networks: { chain: { IPAddress: "172.28.2.2" } } },
  },
  top: { Titles: ["CMD"], Processes: [["lighthouse bn"]] },
};

describe("EthereumAdapter.pollInfra drivesNodeId resolution (Issue #186)", () => {
  it("sets drivesNodeId on the beacon node to the paired execution node's id", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture, beaconFixture])),
    );
    const partial = await adapter.pollInfra();
    const entities = (partial.entities ?? []) as NodeEntity[];
    const beacon = entities.find((e) => e.id === "chainviz-ethereum/beacon1");
    const reth = entities.find((e) => e.id === "chainviz-ethereum/reth1");
    expect(beacon?.drivesNodeId).toBe(reth?.id);
  });

  it("omits drivesNodeId on the execution node itself (drives, not driven)", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([rethFixture, beaconFixture])),
    );
    const partial = await adapter.pollInfra();
    const entities = (partial.entities ?? []) as NodeEntity[];
    const reth = entities.find((e) => e.id === "chainviz-ethereum/reth1");
    expect(reth?.drivesNodeId).toBeUndefined();
  });

  it("omits drivesNodeId on a validator node even though it shares the lighthouse client type", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(
        clientFrom([rethFixture, beaconFixture, validatorFixture]),
      ),
    );
    const partial = await adapter.pollInfra();
    const entities = (partial.entities ?? []) as NodeEntity[];
    const validator = entities.find(
      (e) => e.id === "chainviz-ethereum/validator1",
    );
    expect(validator?.drivesNodeId).toBeUndefined();
  });

  it("omits drivesNodeId when the beacon has no paired execution node observed", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(clientFrom([beaconFixture])),
    );
    const partial = await adapter.pollInfra();
    const beacon = partial.entities?.[0] as NodeEntity;
    expect(beacon.drivesNodeId).toBeUndefined();
  });

  it("re-resolves on every poll instead of caching a fixed result (execution ノードが後から現れる)", async () => {
    let containers: DockerContainerSummary[] = [beaconFixture.summary];
    const byId = new Map([
      [rethFixture.summary.Id, rethFixture],
      [beaconFixture.summary.Id, beaconFixture],
    ]);
    const client: DockerClient = {
      listContainers: async () => containers,
      getContainer: (id: string) => ({
        top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
        stats: async () => zeroStats,
      }),
    };
    const adapter = new EthereumAdapter(new DockerPoller(client));

    const first = await adapter.pollInfra();
    const firstBeacon = first.entities?.[0] as NodeEntity;
    expect(firstBeacon.drivesNodeId).toBeUndefined();

    containers = [rethFixture.summary, beaconFixture.summary];
    const second = await adapter.pollInfra();
    const secondEntities = (second.entities ?? []) as NodeEntity[];
    const secondBeacon = secondEntities.find(
      (e) => e.id === "chainviz-ethereum/beacon1",
    );
    const secondReth = secondEntities.find(
      (e) => e.id === "chainviz-ethereum/reth1",
    );
    expect(secondBeacon?.drivesNodeId).toBe(secondReth?.id);
  });

  it("pairs each beacon with its own execution node in a multi-node environment", async () => {
    const adapter = new EthereumAdapter(
      new DockerPoller(
        clientFrom([
          rethFixture,
          beaconFixture,
          reth2Fixture,
          beacon2Fixture,
        ]),
      ),
    );
    const partial = await adapter.pollInfra();
    const entities = (partial.entities ?? []) as NodeEntity[];
    const beacon1 = entities.find((e) => e.id === "chainviz-ethereum/beacon1");
    const beacon2 = entities.find((e) => e.id === "chainviz-ethereum/beacon2");
    // beacon1→reth1 / beacon2→reth2 と、ノード群キーごとに正しく対応付き、
    // 相手を取り違えない。
    expect(beacon1?.drivesNodeId).toBe("chainviz-ethereum/reth1");
    expect(beacon2?.drivesNodeId).toBe("chainviz-ethereum/reth2");
    // execution ノード自身は駆動される側なので drivesNodeId を持たない。
    const reth1 = entities.find((e) => e.id === "chainviz-ethereum/reth1");
    const reth2 = entities.find((e) => e.id === "chainviz-ethereum/reth2");
    expect(reth1?.drivesNodeId).toBeUndefined();
    expect(reth2?.drivesNodeId).toBeUndefined();
  });

  it("leaves the execution node without drivesNodeId after its driving beacon is removed", async () => {
    // drivesNodeId は beacon（CL）側のエンティティに載る。beacon が消えると
    // そのエンティティごと消え、pollInfra は毎回 observations から作り直すため
    // execution（EL）側に古い drivesNodeId が残ることはない（そもそも EL 側は
    // 一度も drivesNodeId を持たない）ことを固定する。
    let containers: DockerContainerSummary[] = [
      rethFixture.summary,
      beaconFixture.summary,
    ];
    const byId = new Map([
      [rethFixture.summary.Id, rethFixture],
      [beaconFixture.summary.Id, beaconFixture],
    ]);
    const client: DockerClient = {
      listContainers: async () => containers,
      getContainer: (id: string) => ({
        top: async () => byId.get(id)?.top ?? { Titles: ["CMD"], Processes: [] },
        stats: async () => zeroStats,
      }),
    };
    const adapter = new EthereumAdapter(new DockerPoller(client));

    const first = await adapter.pollInfra();
    const firstEntities = (first.entities ?? []) as NodeEntity[];
    const firstBeacon = firstEntities.find(
      (e) => e.id === "chainviz-ethereum/beacon1",
    );
    expect(firstBeacon?.drivesNodeId).toBe("chainviz-ethereum/reth1");

    // beacon を取り除く（reth だけ残る）。
    containers = [rethFixture.summary];
    const second = await adapter.pollInfra();
    const secondEntities = (second.entities ?? []) as NodeEntity[];
    expect(
      secondEntities.find((e) => e.id === "chainviz-ethereum/beacon1"),
    ).toBeUndefined();
    const reth = secondEntities.find((e) => e.id === "chainviz-ethereum/reth1");
    expect(reth?.drivesNodeId).toBeUndefined();
  });
});
