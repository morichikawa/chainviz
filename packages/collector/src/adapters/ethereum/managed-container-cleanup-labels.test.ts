import { describe, expect, it, vi } from "vitest";
import type {
  ContainerSpec,
  CreatedContainer,
  DockerOperations,
  ExecResult,
  LabeledContainer,
} from "../../docker/operations.js";
import {
  COMPOSE_PROJECT_LABEL,
  COMPOSE_SERVICE_LABEL,
  CONFIG_HASH_LABEL,
  MANAGED_LABEL,
} from "./labels.js";
import { EthereumNodeLifecycle } from "./node-lifecycle.js";

// Issue #359 の回帰防止に特化したテスト。node-lifecycle.test.ts 側にも
// 「CONFIG_HASH_LABEL が付く（toBeTruthy）」という基本テストがあるが、実機
// 検証（docs/worklog/issue-359.md）で分かった以下の不変条件までは押さえて
// いなかったため、ここで補強する:
//   - 値が「空でない文字列」であること（空文字だと Compose に認識されない）
//   - addNode（reth/beacon）・addWorkbench の全 managed コンテナ種別で
//     同一の値が付くこと（種別で食い違わない）
//   - config-hash 単体ではなく project/service/managed と「揃って」付くこと
//     （Compose が孤児として認識するのに必要なラベル一式）
//   - 1 個目だけでなく、2 回目以降・複数コンテナにも漏れなく付くこと（境界）

function fakeOps(
  opts: { usedIps?: string[] } = {},
): DockerOperations & { created: ContainerSpec[] } {
  const created: ContainerSpec[] = [];
  let seq = 0;
  return {
    created,
    createAndStart: vi.fn(async (spec: ContainerSpec): Promise<CreatedContainer> => {
      created.push(spec);
      return { id: `cid-${++seq}` };
    }),
    stopAndRemove: vi.fn(async (): Promise<void> => {}),
    usedNetworkIps: vi.fn(async (): Promise<string[]> => opts.usedIps ?? []),
    listContainersByLabels: vi.fn(async (): Promise<LabeledContainer[]> => []),
    exec: vi.fn(
      async (): Promise<ExecResult> => ({ exitCode: 0, stdout: "", stderr: "" }),
    ),
  };
}

const config = {
  profileDir: "/repo/profiles/ethereum",
  ethRpcUrl: "http://host.docker.internal:4001",
};

/** ラベル値が「空でない文字列」であることを表明するヘルパー。 */
function expectNonEmptyStringLabel(
  labels: Record<string, string> | undefined,
  key: string,
): string {
  const value = labels?.[key];
  expect(typeof value).toBe("string");
  // 空文字は Docker Compose に認識されない（実機検証）。truthy より厳密に
  // 「長さ 1 以上の文字列」を要求して、空文字への退行を確実に弾く。
  expect((value as string).length).toBeGreaterThan(0);
  return value as string;
}

describe("managed container cleanup labels (Issue #359)", () => {
  it("labels every managed container type with a non-empty config-hash and a consistent value", async () => {
    const ops = fakeOps({
      usedIps: ["172.28.1.1", "172.28.1.2", "172.28.2.1", "172.28.2.2"],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum"); // reth3, beacon3
    await lifecycle.addWorkbench("Alice"); // workbench

    const [reth, beacon, workbench] = ops.created;
    const rethHash = expectNonEmptyStringLabel(reth.labels, CONFIG_HASH_LABEL);
    const beaconHash = expectNonEmptyStringLabel(beacon.labels, CONFIG_HASH_LABEL);
    const workbenchHash = expectNonEmptyStringLabel(
      workbench.labels,
      CONFIG_HASH_LABEL,
    );

    // reth/beacon/workbench で同じプレースホルダー値を共有する（種別ごとに
    // 別値を採るような実装変更が入ると、down -v の一括掃除の挙動が
    // 種別で食い違いうるため、一貫性を固定しておく）。
    expect(rethHash).toBe(beaconHash);
    expect(beaconHash).toBe(workbenchHash);
  });

  it("adds config-hash alongside the project/service/managed labels Compose needs together", async () => {
    // 孤児（orphan）としての認識には config-hash 単体では足りず、
    // project + service + managed と揃って初めて「このプロジェクトの
    // managed コンテナ」として down -v --remove-orphans の対象になる。
    // どれか 1 つでも欠けると掃除が壊れるため、一式が揃うことを確認する。
    const ops = fakeOps({
      usedIps: ["172.28.1.1", "172.28.1.2", "172.28.2.1", "172.28.2.2"],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");
    await lifecycle.addWorkbench("Alice");

    for (const spec of ops.created) {
      expect(spec.labels?.[COMPOSE_PROJECT_LABEL]).toBe("chainviz-ethereum");
      expect(spec.labels?.[COMPOSE_SERVICE_LABEL]).toBeTruthy();
      expect(spec.labels?.[MANAGED_LABEL]).toBe("true");
      expectNonEmptyStringLabel(spec.labels, CONFIG_HASH_LABEL);
    }
  });

  it("labels every container across repeated addNode calls, not just the first (boundary)", async () => {
    // 「最初の 1 個には付くが 2 個目に付け忘れる」退行を弾く。reth3/beacon3/
    // reth4/beacon4 の 4 コンテナすべてに config-hash が付くこと。
    const ops = fakeOps({
      usedIps: ["172.28.1.1", "172.28.1.2", "172.28.2.1", "172.28.2.2"],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");
    await lifecycle.addNode("ethereum");

    expect(ops.created).toHaveLength(4);
    const services = ops.created.map(
      (s) => s.labels?.[COMPOSE_SERVICE_LABEL],
    );
    expect(services).toEqual(["reth3", "beacon3", "reth4", "beacon4"]);
    for (const spec of ops.created) {
      expectNonEmptyStringLabel(spec.labels, CONFIG_HASH_LABEL);
    }
  });

  it("labels a workbench created with an empty label (falls back to a service name and still gets config-hash)", async () => {
    // ワークベンチのラベルが空文字でも service 名は "workbench" に
    // フォールバックする（node-lifecycle.ts の uniqueWorkbenchService）。
    // その境界でも config-hash が漏れないことを確認する。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("   ");

    const wb = ops.created[0];
    expect(wb.labels?.[COMPOSE_SERVICE_LABEL]).toBe("workbench");
    expectNonEmptyStringLabel(wb.labels, CONFIG_HASH_LABEL);
  });
});
