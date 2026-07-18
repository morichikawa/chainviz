// Issue #369（collector の composeProject が "chainviz-ethereum" に
// ハードコードされ、環境変数での上書き口が無かった）専用の回帰テスト。
// node-lifecycle.test.ts は既に大きいため、composeProject の上書きに関する
// ケースはここへ分離する（CLAUDE.md「テストファイルにも1ファイル1責務」）。
//
// 検証する観点:
// 1. composeProject を上書きした config で addNode の ContainerSpec
//    （コンテナ名・ラベル・binds のボリューム名・networkName）と登録される
//    stableId が上書き値から導出されること
// 2. recoverManagedContainers() / runWorkbenchOperation（内部の
//    findWorkbenchContainer）のラベルフィルタが上書き値で走査すること
// 3. composeProject 未指定なら従来値 "chainviz-ethereum" のままであること
//    （回帰確認）
// 4. composeProject: undefined というキーだけを明示的に持つ config を渡しても
//    既定値が保たれること（コンストラクタの組み立て順に関する回帰）
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WorkbenchOperation } from "@chainviz/shared";
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
} from "./labels.js";
import {
  DEFAULT_COMPOSE_PROJECT,
  EthereumNodeLifecycle,
  type EthereumNodeLifecycleConfig,
} from "./node-lifecycle.js";

/** node-lifecycle.test.ts の fakeOps と同じ最小フェイク。 */
function fakeOps(
  opts: { managedContainers?: LabeledContainer[] } = {},
): DockerOperations & { created: ContainerSpec[] } {
  const created: ContainerSpec[] = [];
  let seq = 0;
  return {
    created,
    createAndStart: vi.fn(
      async (spec: ContainerSpec): Promise<CreatedContainer> => {
        created.push(spec);
        return { id: `cid-${++seq}` };
      },
    ),
    stopAndRemove: vi.fn(async (): Promise<void> => {}),
    usedNetworkIps: vi.fn(async (): Promise<string[]> => []),
    listContainersByLabels: vi.fn(
      async (): Promise<LabeledContainer[]> => opts.managedContainers ?? [],
    ),
    exec: vi.fn(
      async (): Promise<ExecResult> => ({ exitCode: 0, stdout: "", stderr: "" }),
    ),
  };
}

/** mnemonic 付きの一時 profileDir を用意し、そこを指す config を返す。 */
function configWithMnemonic(
  overrides: Partial<EthereumNodeLifecycleConfig> = {},
): EthereumNodeLifecycleConfig {
  const dir = mkdtempSync(path.join(tmpdir(), "chainviz-profile-"));
  writeFileSync(
    path.join(dir, "values.env"),
    'export EL_AND_CL_MNEMONIC="alpha bravo charlie"\n',
  );
  return {
    profileDir: dir,
    ethRpcUrl: "http://host.docker.internal:4001",
    ...overrides,
  };
}

function managed(
  service: string,
  role: string,
  id: string,
  project: string,
): LabeledContainer {
  return {
    id,
    labels: {
      [COMPOSE_PROJECT_LABEL]: project,
      [COMPOSE_SERVICE_LABEL]: service,
      "com.chainviz.managed": "true",
      "com.chainviz.role": role,
    },
  };
}

describe("EthereumNodeLifecycle composeProject override (Issue #369)", () => {
  it("derives networkName/genesisVolume/clpeerVolume/elpeerVolume from an overridden composeProject", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      composeProject: "synth-env",
    });
    await lifecycle.addNode("ethereum");

    const [reth, beacon] = ops.created;
    expect(reth.name).toBe("synth-env-reth3");
    expect(reth.labels?.[COMPOSE_PROJECT_LABEL]).toBe("synth-env");
    expect(reth.networkName).toBe("synth-env_chain");
    expect(reth.binds).toContain("synth-env_genesis:/genesis:ro");
    expect(reth.binds).toContain("synth-env_elpeer:/elpeer:ro");
    expect(beacon.binds).toContain("synth-env_clpeer:/clpeer:ro");
  });

  it("registers the addNode stableId using the overridden composeProject", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      composeProject: "synth-env",
    });
    await lifecycle.addNode("ethereum");

    await lifecycle.removeNode("synth-env/reth3");
    expect(ops.stopAndRemove).toHaveBeenCalledWith("cid-2"); // beacon first
    expect(ops.stopAndRemove).toHaveBeenCalledWith("cid-1"); // then reth
  });

  it("registers the addWorkbench stableId using the overridden composeProject", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      composeProject: "synth-env",
    });
    await lifecycle.addWorkbench("Alice");

    expect(ops.created[0]?.name).toBe("synth-env-Alice-1");
    // removeWorkbench only succeeds if the stableId matches "<project>/<service>".
    await expect(
      lifecycle.removeWorkbench("synth-env/Alice"),
    ).resolves.toBeUndefined();
  });

  it("scopes recoverManagedContainers' label query to the overridden composeProject", async () => {
    const ops = fakeOps({
      managedContainers: [managed("reth5", "execution", "reth-cid", "synth-env")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      composeProject: "synth-env",
    });
    await lifecycle.recoverManagedContainers();

    expect(ops.listContainersByLabels).toHaveBeenCalledWith({
      "com.chainviz.managed": "true",
      [COMPOSE_PROJECT_LABEL]: "synth-env",
    });
    // recovered under the overridden project's stableId, not the default one.
    await lifecycle.removeNode("synth-env/reth5");
    expect(ops.stopAndRemove).toHaveBeenCalledWith("reth-cid");
  });

  it("scopes runWorkbenchOperation's workbench lookup to the overridden composeProject", async () => {
    const ops = fakeOps({
      managedContainers: [
        managed("Alice", "workbench", "wb-cid", "synth-env"),
      ],
    });
    const lifecycle = new EthereumNodeLifecycle(
      ops,
      configWithMnemonic({ composeProject: "synth-env" }),
    );
    const transfer: WorkbenchOperation = {
      type: "transfer",
      to: "0x8943545177806ED17B9F23F0a21ee5948eCaa776",
      amount: "1000000000000000000",
    };

    await lifecycle.runWorkbenchOperation("synth-env/Alice", transfer);

    expect(ops.listContainersByLabels).toHaveBeenCalledWith({
      [COMPOSE_PROJECT_LABEL]: "synth-env",
    });
    expect(ops.exec).toHaveBeenCalledWith("wb-cid", expect.any(Array));
  });

  it("falls back to DEFAULT_COMPOSE_PROJECT ('chainviz-ethereum') when composeProject is not specified", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
    });
    await lifecycle.addNode("ethereum");

    const [reth] = ops.created;
    expect(reth.name).toBe(`${DEFAULT_COMPOSE_PROJECT}-reth3`);
    expect(reth.networkName).toBe(`${DEFAULT_COMPOSE_PROJECT}_chain`);
    expect(reth.binds).toContain(`${DEFAULT_COMPOSE_PROJECT}_genesis:/genesis:ro`);
  });

  it("does not let an explicit composeProject: undefined key clobber the default (constructor ordering regression)", async () => {
    // config オブジェクトが "composeProject" キーを持ちつつ値が undefined の
    // ケース（例: フロントから受けた JSON をそのまま展開した場合など）でも
    // 既定値が保たれることを固定する（設計メモの注意点）。
    const ops = fakeOps();
    const configWithUndefinedKey = {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      composeProject: undefined,
    } as EthereumNodeLifecycleConfig;
    const lifecycle = new EthereumNodeLifecycle(ops, configWithUndefinedKey);
    await lifecycle.addNode("ethereum");

    const [reth] = ops.created;
    expect(reth.name).toBe(`${DEFAULT_COMPOSE_PROJECT}-reth3`);
    expect(reth.networkName).toBe(`${DEFAULT_COMPOSE_PROJECT}_chain`);
  });

  it("still lets an explicit networkName/volume override take priority over the derived default", async () => {
    // 個別上書きキー（networkName 等）は composeProject からの導出値より
    // 優先されるという既存方針が、defaultConfigFor 化後も維持されることを固定。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      composeProject: "synth-env",
      networkName: "custom-net",
      genesisVolume: "custom-genesis",
    });
    await lifecycle.addNode("ethereum");

    const [reth] = ops.created;
    expect(reth.networkName).toBe("custom-net");
    expect(reth.binds).toContain("custom-genesis:/genesis:ro");
    // composeProject 自体は依然として上書き値を使う（コンテナ名・ラベル）。
    expect(reth.name).toBe("synth-env-reth3");
  });

  it("lets clpeerVolume/elpeerVolume overrides take priority while other keys stay derived", async () => {
    // 既存テストは networkName/genesisVolume の上書きのみを固定していたため、
    // 残る個別ボリューム上書きキー（clpeerVolume/elpeerVolume）も導出値より
    // 優先されること、かつ上書きしていないキーは composeProject から導出された
    // ままであることを固定する（全キーの優先順位を網羅する）。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      composeProject: "synth-env",
      clpeerVolume: "custom-clpeer",
      elpeerVolume: "custom-elpeer",
    });
    await lifecycle.addNode("ethereum");

    const [reth, beacon] = ops.created;
    // 上書きしたキーは優先される。
    expect(beacon.binds).toContain("custom-clpeer:/clpeer:ro");
    expect(reth.binds).toContain("custom-elpeer:/elpeer:ro");
    // 上書きしていないキーは composeProject から導出されたまま。
    expect(reth.networkName).toBe("synth-env_chain");
    expect(reth.binds).toContain("synth-env_genesis:/genesis:ro");
  });

  it("derives volume/network names from the default project when only networkName is overridden (no composeProject)", async () => {
    // composeProject を上書きせず個別キーだけを上書きした場合、composeProject
    // とその他の導出名は DEFAULT のまま、上書きしたキーだけが差し替わることを
    // 固定する（個別上書きと project 上書きが独立に効くことの確認）。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      networkName: "custom-net",
    });
    await lifecycle.addNode("ethereum");

    const [reth] = ops.created;
    expect(reth.networkName).toBe("custom-net");
    // composeProject を上書きしていないので、コンテナ名・ラベル・他の導出名は
    // 既定プロジェクトのまま。
    expect(reth.name).toBe(`${DEFAULT_COMPOSE_PROJECT}-reth3`);
    expect(reth.labels?.[COMPOSE_PROJECT_LABEL]).toBe(DEFAULT_COMPOSE_PROJECT);
    expect(reth.binds).toContain(`${DEFAULT_COMPOSE_PROJECT}_genesis:/genesis:ro`);
  });

  it("produces degenerate derived names when composeProject is an explicit empty string (constructor boundary)", async () => {
    // resolveComposeProject は空文字を DEFAULT へ変換するため main() 経路では
    // 空文字がここへ到達しないが、コンストラクタを直接呼ぶ経路では
    // `config.composeProject ?? DEFAULT` が空文字を捕捉しない（?? は null/
    // undefined のみ）。その結果、導出名が "_chain" / "-reth3" のように
    // 退化する現状の挙動を固定する（懸念点として worklog に記録済み。実装は
    // 変更しない）。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      composeProject: "",
    });
    await lifecycle.addNode("ethereum");

    const [reth] = ops.created;
    expect(reth.name).toBe("-reth3");
    expect(reth.networkName).toBe("_chain");
    expect(reth.binds).toContain("_genesis:/genesis:ro");
    expect(reth.labels?.[COMPOSE_PROJECT_LABEL]).toBe("");
  });

  it("passes composeProject through to names/labels without sanitizing invalid characters", async () => {
    // lifecycle 側も composeProject の文字種を検証・サニタイズしない
    // （resolveComposeProject と同じく素通し）。不正な文字を含む値でも
    // そのままコンテナ名・ラベル・導出名に反映される現状の挙動を固定する
    // （懸念点として worklog に記録済み）。service 名側は slug() で安全化
    // されるが、composeProject プレフィックスは安全化されないことを示す。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      composeProject: "Synth_Env",
    });
    await lifecycle.addNode("ethereum");

    const [reth] = ops.created;
    expect(reth.name).toBe("Synth_Env-reth3");
    expect(reth.labels?.[COMPOSE_PROJECT_LABEL]).toBe("Synth_Env");
    expect(reth.networkName).toBe("Synth_Env_chain");
  });

  it("builds recovered stableIds from each container's own project label, not from cfg.composeProject", async () => {
    // recover のラベルフィルタと stableId 組み立ての整合を固定する。
    // toManagedContainer は stableId をコンテナ自身の project ラベルから
    // 組み立てる（cfg.composeProject では補完しない）。そのため、config を
    // 別の composeProject 値で作り直しても、既存の managed コンテナは自身の
    // ラベルどおりの stableId で回収され、removeNode がその id と整合する。
    // （実運用では listContainersByLabels のフィルタが cfg と一致する
    // コンテナしか返さないため両者は一致するが、フェイクで異なる値を返して
    // 防御的挙動を確認する。）
    const ops = fakeOps({
      managedContainers: [
        managed("reth5", "execution", "reth-cid", "other-project"),
      ],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/repo/profiles/ethereum",
      ethRpcUrl: "http://host.docker.internal:4001",
      composeProject: "synth-env",
    });
    await lifecycle.recoverManagedContainers();

    // cfg は "synth-env" だが、コンテナのラベルは "other-project" なので
    // stableId は "other-project/reth5" になる。cfg の値では削除できない。
    await expect(
      lifecycle.removeNode("synth-env/reth5"),
    ).rejects.toThrow(/was not added via addNode/);
    await lifecycle.removeNode("other-project/reth5");
    expect(ops.stopAndRemove).toHaveBeenCalledWith("reth-cid");
  });
});
