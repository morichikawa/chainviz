// Issue #366（追加ワークベンチの命名が静的ワークベンチと衝突する）専用の
// 回帰テスト。node-lifecycle.test.ts は既に大きいため、この不具合に関する
// ケースはここへ分離する（CLAUDE.md「テストファイルにも1ファイル1責務」）。
//
// 検証する2つの根本原因:
// 1. コンテナ名の409衝突（addWorkbench が静的ワークベンチと同じ名前を
//    推測して createAndStart が失敗する）
// 2. stableId重複による操作の誤配送（uniqueWorkbenchService がメモリ上の
//    レジストリしか見ておらず、Docker 上に実在する静的ワークベンチの
//    service名と衝突する）
import { describe, expect, it, vi } from "vitest";
import {
  ContainerNameConflictError,
  type ContainerSpec,
  type CreatedContainer,
  type DockerOperations,
  type ExecResult,
  type LabeledContainer,
} from "../../docker/operations.js";
import { EthereumNodeLifecycle } from "./node-lifecycle.js";
import { COMPOSE_PROJECT_LABEL, COMPOSE_SERVICE_LABEL } from "./labels.js";

/**
 * node-lifecycle.test.ts の fakeOps と同じ最小フェイク。
 * conflictingNames に含まれる名前で createAndStart を呼ぶと
 * ContainerNameConflictError を投げ、一度投げたら集合から取り除く
 * （呼び出し側が別名で再試行したとき、その別名は空いているものとして扱う）。
 */
function fakeOps(
  opts: {
    conflictingNames?: Set<string>;
    docContainers?: LabeledContainer[];
  } = {},
): DockerOperations & { created: ContainerSpec[]; removed: string[] } {
  const created: ContainerSpec[] = [];
  const removed: string[] = [];
  let seq = 0;
  return {
    created,
    removed,
    createAndStart: vi.fn(
      async (spec: ContainerSpec): Promise<CreatedContainer> => {
        if (opts.conflictingNames?.has(spec.name)) {
          opts.conflictingNames.delete(spec.name);
          throw new ContainerNameConflictError(spec.name);
        }
        created.push(spec);
        return { id: `cid-${++seq}` };
      },
    ),
    stopAndRemove: vi.fn(async (id: string): Promise<void> => {
      removed.push(id);
    }),
    usedNetworkIps: vi.fn(async (): Promise<string[]> => []),
    listContainersByLabels: vi.fn(
      async (): Promise<LabeledContainer[]> => opts.docContainers ?? [],
    ),
    exec: vi.fn(
      async (): Promise<ExecResult> => ({ exitCode: 0, stdout: "", stderr: "" }),
    ),
  };
}

const config = {
  profileDir: "/repo/profiles/ethereum",
  ethRpcUrl: "http://host.docker.internal:4001",
};

/** docker-compose.yml 由来の静的ワークベンチ相当の LabeledContainer。 */
function staticWorkbenchContainer(project: string): LabeledContainer {
  return {
    id: "static-workbench-id",
    labels: {
      [COMPOSE_PROJECT_LABEL]: project,
      [COMPOSE_SERVICE_LABEL]: "workbench",
      // 静的ワークベンチは com.chainviz.managed / com.chainviz.role を
      // 一切持たない（docker-compose.yml 参照）。
    },
  };
}

describe("EthereumNodeLifecycle.addWorkbench container name collision (Issue #366)", () => {
  it("retries with the next sequence number when the guessed name collides with an existing container", async () => {
    // "chainviz-ethereum-workbench-1" は静的ワークベンチが既に使っている名前
    // （workbenchSeq の初期推測値0からの1回目の候補）という想定。
    const ops = fakeOps({
      conflictingNames: new Set(["chainviz-ethereum-workbench-1"]),
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await lifecycle.addWorkbench("");

    expect(ops.created).toHaveLength(1);
    expect(ops.created[0]?.name).toBe("chainviz-ethereum-workbench-2");
  });

  it("keeps the advanced sequence number for subsequent addWorkbench calls", async () => {
    // 2回目は別ラベル(Bob)にして、service名の衝突（別のテストで検証済み）と
    // 混ざらないよう、コンテナ名の連番だけを見る。
    const ops = fakeOps({
      conflictingNames: new Set(["chainviz-ethereum-Alice-1"]),
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await lifecycle.addWorkbench("Alice"); // collides once, ends up at seq 2
    await lifecycle.addWorkbench("Bob");

    const names = ops.created.map((s) => s.name);
    expect(names).toEqual([
      "chainviz-ethereum-Alice-2",
      "chainviz-ethereum-Bob-3",
    ]);
  });

  it("retries through multiple consecutive collisions", async () => {
    const ops = fakeOps({
      conflictingNames: new Set([
        "chainviz-ethereum-workbench-1",
        "chainviz-ethereum-workbench-2",
        "chainviz-ethereum-workbench-3",
      ]),
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await lifecycle.addWorkbench("");

    expect(ops.created[0]?.name).toBe("chainviz-ethereum-workbench-4");
  });

  it("gives up after exhausting the retry budget instead of looping forever", async () => {
    // WORKBENCH_NAME_CONFLICT_RETRIES(1000)回すべて衝突させ、無限ループに
    // ならず有限個数の試行で諦めることを固定する。
    const conflictingNames = new Set(
      Array.from(
        { length: 1000 },
        (_, i) => `chainviz-ethereum-workbench-${i + 1}`,
      ),
    );
    const ops = fakeOps({ conflictingNames });
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await expect(lifecycle.addWorkbench("")).rejects.toThrow(
      /failed to allocate a unique workbench container name/,
    );
    expect(ops.created).toHaveLength(0);
  });

  it("propagates a non-conflict failure from createAndStart without retrying", async () => {
    const ops: DockerOperations & { created: ContainerSpec[] } = {
      created: [],
      createAndStart: vi.fn(async () => {
        throw new Error("image pull failed");
      }),
      stopAndRemove: vi.fn(async () => {}),
      usedNetworkIps: vi.fn(async () => []),
      listContainersByLabels: vi.fn(async () => []),
      exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    };
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await expect(lifecycle.addWorkbench("")).rejects.toThrow(
      /image pull failed/,
    );
    expect(ops.createAndStart).toHaveBeenCalledTimes(1);
  });
});

describe("EthereumNodeLifecycle.addWorkbench stableId collision (Issue #366)", () => {
  it("disambiguates from a static (unmanaged) workbench observed only via Docker, not the in-memory registry", async () => {
    // collector 起動直後(this.workbenches は空、recoverManagedContainers も
    // 呼んでいない)でも、Docker 上に静的ワークベンチが実在すれば
    // service名が衝突しないこと。
    const ops = fakeOps({
      docContainers: [staticWorkbenchContainer("chainviz-ethereum")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await lifecycle.addWorkbench("");

    expect(ops.created[0]?.labels?.[COMPOSE_SERVICE_LABEL]).toBe(
      "workbench-2",
    );
  });

  it("full regression: fresh startup with a static workbench, add + remove of a default-labeled workbench", async () => {
    // Issue #366 / #334 の再現シナリオそのもの:
    // managedコンテナ0件でcollectorが起動し(recoverManagedContainers)、
    // 既定ラベルでaddWorkbenchしても静的ワークベンチとstableIdが重複せず、
    // removeWorkbenchが1回で完了すること。
    const ops = fakeOps({
      docContainers: [staticWorkbenchContainer("chainviz-ethereum")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await lifecycle.recoverManagedContainers();
    await lifecycle.addWorkbench("");

    const stableId = "chainviz-ethereum/workbench-2";
    expect(ops.created[0]?.labels?.[COMPOSE_SERVICE_LABEL]).toBe(
      "workbench-2",
    );

    // 1回のremoveWorkbenchで正しく完了する(静的ワークベンチを巻き込まない)。
    await lifecycle.removeWorkbench(stableId);
    expect(ops.removed).toEqual(["cid-1"]);
    await expect(lifecycle.removeWorkbench(stableId)).rejects.toThrow(
      /was not added via addWorkbench/,
    );
  });

  it("still disambiguates against workbenches this lifecycle itself already created (regression guard)", async () => {
    // Docker側の走査結果が空でも(フェイクの都合)、メモリ上のレジストリとの
    // 突き合わせは既存どおり機能する。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await lifecycle.addWorkbench("Alice");
    await lifecycle.addWorkbench("Alice");

    const services = ops.created.map((s) => s.labels?.[COMPOSE_SERVICE_LABEL]);
    expect(services).toEqual(["Alice", "Alice-2"]);
  });

  it("queries listContainersByLabels with only the compose project label (not managed-only)", async () => {
    // 静的ワークベンチは managed ラベルを持たないため、絞り込みにmanaged
    // ラベルを含めてはいけない(含めると静的ワークベンチが見えなくなる)。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await lifecycle.addWorkbench("Alice");

    expect(ops.listContainersByLabels).toHaveBeenCalledWith({
      [COMPOSE_PROJECT_LABEL]: "chainviz-ethereum",
    });
  });
});
