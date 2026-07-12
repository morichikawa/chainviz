// Issue #293 の回帰・エッジケーステスト。動的に追加したワークベンチ
// （addWorkbench）のコンテナに、サンプルコントラクトの Foundry プロジェクト
// （profiles/ethereum/contracts）を deployContract（forge create --root
// /contracts）が参照できるパスへ bind mount できているかを、境界値・非退行の
// 観点で固める。
//
// このファイルは node-lifecycle.test.ts から「/contracts の bind mount」という
// 関心事だけを切り出したもの（node-lifecycle.test.ts が既に多数の関心事を抱えて
// 肥大化しているため、Issue #293 で強化する分は独立ファイルに置く。CLAUDE.md
// 「1 ファイル 1 責務」）。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
import { EthereumNodeLifecycle } from "./node-lifecycle.js";
import {
  buildOperationCommand,
  CONTRACTS_MOUNT_PATH,
} from "./workbench-operations.js";

/** 作成された spec を記録するだけの最小フェイク（このファイルの検証に必要な分）。 */
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

const baseConfig = {
  profileDir: "/repo/profiles/ethereum",
  ethRpcUrl: "http://host.docker.internal:4001",
};

/** "source:target[:flags]" 形式の bind エントリの target 部分を取り出す。 */
function bindTarget(entry: string): string {
  return entry.split(":")[1] as string;
}

/** 追加ワークベンチの ContainerSpec を組み立てて返すヘルパー。 */
async function addWorkbenchSpec(
  config: typeof baseConfig,
): Promise<ContainerSpec> {
  const ops = fakeOps();
  const lifecycle = new EthereumNodeLifecycle(ops, config);
  await lifecycle.addWorkbench("Alice");
  return ops.created[0] as ContainerSpec;
}

describe("workbench /contracts bind mount (Issue #293)", () => {
  describe("mount source follows profileDir", () => {
    it("derives the bind source from an arbitrary absolute profileDir", async () => {
      const wb = await addWorkbenchSpec({
        ...baseConfig,
        profileDir: "/opt/app/profiles/ethereum",
      });
      expect(wb.binds).toContain(
        `/opt/app/profiles/ethereum/contracts:${CONTRACTS_MOUNT_PATH}`,
      );
    });

    it("tracks a different profileDir independently (source is not hard-coded)", async () => {
      const wb = await addWorkbenchSpec({
        ...baseConfig,
        profileDir: "/var/lib/chainviz/profiles/ethereum",
      });
      expect(wb.binds).toContain(
        `/var/lib/chainviz/profiles/ethereum/contracts:${CONTRACTS_MOUNT_PATH}`,
      );
      // 別の profileDir の値が残留していないこと（source が profileDir に
      // 完全に追従していること）。
      expect(wb.binds).not.toContain(
        `/repo/profiles/ethereum/contracts:${CONTRACTS_MOUNT_PATH}`,
      );
    });

    it("normalizes a trailing slash in profileDir (no doubled separator)", async () => {
      const wb = await addWorkbenchSpec({
        ...baseConfig,
        profileDir: "/repo/profiles/ethereum/",
      });
      // path.join による正規化で "//contracts" のような重複区切りにならない。
      expect(wb.binds).toContain(
        `/repo/profiles/ethereum/contracts:${CONTRACTS_MOUNT_PATH}`,
      );
      const contractsBind = (wb.binds ?? []).find((b) =>
        bindTarget(b) === CONTRACTS_MOUNT_PATH,
      );
      expect(contractsBind).not.toContain("//contracts");
    });
  });

  describe("mount target agrees with the deploy command and the static workbench", () => {
    it("mounts to exactly CONTRACTS_MOUNT_PATH", async () => {
      const wb = await addWorkbenchSpec(baseConfig);
      const contractsBind = (wb.binds ?? []).find((b) =>
        b.startsWith(`${baseConfig.profileDir}/contracts:`),
      );
      expect(contractsBind).toBeDefined();
      expect(bindTarget(contractsBind as string)).toBe(CONTRACTS_MOUNT_PATH);
    });

    it("mounts where forge create --root looks for the project (the core of #293)", async () => {
      // deployContract は forge create ... --root <CONTRACTS_MOUNT_PATH> を組み立てる。
      // マウント先とこの --root が同一の値でなければ "No contract found" で失敗する。
      // 両者が同じ CONTRACTS_MOUNT_PATH を真実の情報源にしていることを固定する。
      const op: WorkbenchOperation = {
        type: "deployContract",
        contractKey: "src/ChainvizToken.sol:ChainvizToken",
        constructorArgs: [],
      };
      const cmd = buildOperationCommand(op, {
        mnemonic: "test test test",
        walletIndex: 1,
        ethRpcUrl: baseConfig.ethRpcUrl,
      });
      const rootIndex = cmd.indexOf("--root");
      expect(rootIndex).toBeGreaterThanOrEqual(0);
      const rootValue = cmd[rootIndex + 1];

      const wb = await addWorkbenchSpec(baseConfig);
      const contractsBind = (wb.binds ?? []).find((b) =>
        b.startsWith(`${baseConfig.profileDir}/contracts:`),
      );
      // マウント先 == forge の --root。これが一致していないのが #293 の不具合だった。
      expect(bindTarget(contractsBind as string)).toBe(rootValue);
    });

    it("matches the static docker-compose.yml workbench mount target", async () => {
      // 静的ワークベンチ（docker-compose.yml の `workbench` サービス）が
      // ./contracts をマウントしている先と、動的ワークベンチが使う
      // CONTRACTS_MOUNT_PATH が一致していることを固定する。片方だけ変えると
      // 静的・動的で挙動が食い違う。
      const composePath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../../profiles/ethereum/docker-compose.yml",
      );
      const compose = readFileSync(composePath, "utf8");
      // `- ./contracts:<target>` の target を取り出す。
      const match = compose.match(/-\s*\.\/contracts:(\S+)/);
      expect(match, "static workbench should mount ./contracts").not.toBeNull();
      expect((match as RegExpMatchArray)[1]).toBe(CONTRACTS_MOUNT_PATH);
    });
  });

  describe("non-regression: adding binds leaves other fields intact", () => {
    it("adds exactly one bind (the contracts mount) and does not mark it read-only", async () => {
      // ワークベンチには /contracts の bind だけを付ける（reth/beacon の
      // genesis/elpeer/scripts のような追加マウントを紛れ込ませない）。また
      // forge create はビルド成果物（out/・cache/）をマウント先へ書き戻すため
      // :ro を付けてはならない（付けると deploy が書き込み失敗する）。
      const wb = await addWorkbenchSpec(baseConfig);
      expect(wb.binds).toHaveLength(1);
      const only = (wb.binds as string[])[0];
      expect(only).toBe(`${baseConfig.profileDir}/contracts:${CONTRACTS_MOUNT_PATH}`);
      expect(only.endsWith(":ro")).toBe(false);
    });

    it("keeps env / labels / networkName / image / entrypoint / extraHosts intact alongside the bind", async () => {
      const wb = await addWorkbenchSpec(baseConfig);
      // binds 追加が他フィールドを巻き添えにしていないことをまとめて固定。
      expect(wb.image).toBe("ghcr.io/foundry-rs/foundry:latest");
      expect(wb.entrypoint).toEqual(["/bin/sh", "-c", "sleep infinity"]);
      expect(wb.env?.ETH_RPC_URL).toBe(baseConfig.ethRpcUrl);
      expect(wb.labels?.["com.docker.compose.service"]).toBe("Alice");
      expect(wb.labels?.["com.chainviz.role"]).toBe("workbench");
      expect(wb.networkName).toBe("chainviz-ethereum_chain");
      expect(wb.extraHosts).toEqual(["host.docker.internal:host-gateway"]);
    });
  });

  describe("concern separation: node specs do not get the contracts mount", () => {
    it("does not add the contracts bind to the reth/beacon specs of addNode", async () => {
      // /contracts のマウントはワークベンチ専用の配線。addNode（reth/beacon）の
      // ContainerSpec に誤って波及していないことを固定する。
      const ops = fakeOps();
      const lifecycle = new EthereumNodeLifecycle(ops, baseConfig);
      await lifecycle.addNode("ethereum");
      expect(ops.created).toHaveLength(2);
      for (const spec of ops.created) {
        const targets = (spec.binds ?? []).map(bindTarget);
        expect(targets).not.toContain(CONTRACTS_MOUNT_PATH);
      }
    });
  });
});
