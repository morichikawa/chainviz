// Issue #385 の統合的な回帰: 実際の createDockerOperations（force remove を
// 含む本物の後始末ロジック）を EthereumNodeLifecycle に配線し、start() 失敗時に
// 作成済みコンテナが orphan として残らないことを addNode / addWorkbench の両
// 経路で確認する。node-lifecycle.test.ts が使う fakeOps は createAndStart を
// 単純化しているため後始末ロジックそのものは通らない。ここでは本物の
// createDockerOperations を通すことで、依頼の観点3（両経路への波及）と観点4
// （addNode 既存ロールバックとの二重削除・競合の不在）を押さえる。

import type Docker from "dockerode";
import { describe, expect, it, vi } from "vitest";
import { createDockerOperations } from "../../docker/dockerode-operations.js";
import { EthereumNodeLifecycle } from "./node-lifecycle.js";

const config = {
  profileDir: "/repo/profiles/ethereum",
  ethRpcUrl: "http://host.docker.internal:4001",
};

/**
 * 本物の createDockerOperations が期待する最小面（createContainer /
 * getContainer / getNetwork）を持つフェイク Docker。作成した各コンテナは
 * 自身の start / remove を持ち、あらゆる remove 呼び出し（createAndStart の
 * 後始末経由でも stopAndRemove 経由でも）を id 付きで removedIds に記録する。
 * これにより「どのコンテナが何回削除されたか」を突き合わせて、二重削除や
 * 削除漏れ（orphan 残留）を検出できる。
 */
function fakeDocker(opts: { startFailsForImage?: (image?: string) => boolean }) {
  const removedIds: string[] = [];
  const createdImages: (string | undefined)[] = [];
  const startById = new Map<string, ReturnType<typeof vi.fn>>();
  const removeById = new Map<string, ReturnType<typeof vi.fn>>();
  let seq = 0;

  const createContainer = vi.fn(
    async (createOpts: Docker.ContainerCreateOptions) => {
      const id = `cid-${++seq}`;
      const image = createOpts.Image;
      createdImages.push(image);
      const start = vi.fn(async () => {
        if (opts.startFailsForImage?.(image)) {
          throw Object.assign(new Error(`start failed for ${image}`), {
            statusCode: 500,
          });
        }
      });
      // createAndStart の後始末が呼ぶ remove。id を記録する。
      const remove = vi.fn(async () => {
        removedIds.push(id);
      });
      startById.set(id, start);
      removeById.set(id, remove);
      return { id, start, remove };
    },
  );

  // stopAndRemove（addNode のロールバック等）が使う経路。
  const getContainer = vi.fn((id: string) => {
    const stop = vi.fn(async () => {});
    const remove = vi.fn(async () => {
      removedIds.push(id);
    });
    return { stop, remove };
  });

  // usedNetworkIps 用。空ネットワークを返し、addNode は index 3 から採番する。
  const getNetwork = vi.fn(() => ({
    inspect: vi.fn(async () => ({})),
  }));

  // uniqueWorkbenchService（listContainersByLabels）用。管理下コンテナ無し。
  const listContainers = vi.fn(async () => []);

  const docker = {
    createContainer,
    getContainer,
    getNetwork,
    listContainers,
  } as unknown as Docker;

  return {
    docker,
    removedIds,
    createdImages,
    createContainer,
    getContainer,
    startById,
    removeById,
  };
}

const RETH_IMAGE = "ghcr.io/paradigmxyz/reth:latest";
const BEACON_IMAGE = "sigp/lighthouse:latest";
const FOUNDRY_IMAGE = "ghcr.io/foundry-rs/foundry:latest";

describe("createAndStart orphan cleanup wired through EthereumNodeLifecycle (Issue #385)", () => {
  it("addWorkbench force-removes the created container when start() fails and leaves no registration", async () => {
    const fake = fakeDocker({
      startFailsForImage: (image) => image === FOUNDRY_IMAGE,
    });
    const ops = createDockerOperations(fake.docker);
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await expect(lifecycle.addWorkbench("Alice")).rejects.toThrow(
      /start failed/,
    );

    // 作成した唯一のコンテナ(cid-1)が force remove され、orphan が残らない。
    expect(fake.removedIds).toEqual(["cid-1"]);
    expect(fake.removeById.get("cid-1")).toHaveBeenCalledWith({ force: true });

    // 登録もされていないため removeWorkbench は「未追加」で拒否される。
    await expect(
      lifecycle.removeWorkbench("chainviz-ethereum/Alice"),
    ).rejects.toThrow(/was not added via addWorkbench/);
  });

  it("addNode force-removes the reth container when reth's own start() fails (the previously-uncovered gap)", async () => {
    // reth 自身の start() 失敗は addNode の beacon ロールバックが救わない経路。
    // createAndStart 側の force remove がこの経路の orphan を消すことを固定する。
    const fake = fakeDocker({
      startFailsForImage: (image) => image === RETH_IMAGE,
    });
    const ops = createDockerOperations(fake.docker);
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await expect(lifecycle.addNode("ethereum")).rejects.toThrow(/start failed/);

    // reth(cid-1)だけが作られ、それが force remove される。beacon は作られない。
    expect(fake.createdImages).toEqual([RETH_IMAGE]);
    expect(fake.removedIds).toEqual(["cid-1"]);
    expect(fake.removeById.get("cid-1")).toHaveBeenCalledWith({ force: true });
    // reth が消えているため、後続の removeNode は「未追加」で拒否される。
    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth3"),
    ).rejects.toThrow(/was not added via addNode/);
  });

  it("removes beacon (via createAndStart cleanup) and reth (via addNode rollback) exactly once each, without a double-remove of the same container", async () => {
    // 依頼の観点4: beacon の start() 失敗時、beacon は createAndStart 内の
    // force remove で、reth は addNode の既存ロールバック(stopAndRemove)で
    // 削除される。両者は別コンテナであり、同一 id が二重に削除されたり
    // 互いの後始末が競合したりしないこと。
    const fake = fakeDocker({
      startFailsForImage: (image) => image === BEACON_IMAGE,
    });
    const ops = createDockerOperations(fake.docker);
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await expect(lifecycle.addNode("ethereum")).rejects.toThrow(/start failed/);

    // reth=cid-1, beacon=cid-2 の2つが作られる。
    expect(fake.createdImages).toEqual([RETH_IMAGE, BEACON_IMAGE]);
    // 両方がちょうど1回ずつ削除され、重複が無い。
    expect([...fake.removedIds].sort()).toEqual(["cid-1", "cid-2"]);
    expect(fake.removedIds).toHaveLength(2);
    expect(new Set(fake.removedIds).size).toBe(2);

    // beacon(cid-2)は createAndStart の後始末 remove で消える。
    expect(fake.removeById.get("cid-2")).toHaveBeenCalledTimes(1);
    expect(fake.removeById.get("cid-2")).toHaveBeenCalledWith({ force: true });
    // reth(cid-1)は addNode のロールバック(stopAndRemove → getContainer)で消える。
    // createAndStart の後始末 remove（createContainer が返した remove）は
    // reth に対しては呼ばれない（reth の start は成功しているため）。
    expect(fake.removeById.get("cid-1")).not.toHaveBeenCalled();
    expect(fake.getContainer).toHaveBeenCalledWith("cid-1");

    // 何も登録されていない（reth の index も消費していない）。
    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth3"),
    ).rejects.toThrow(/was not added via addNode/);
  });

  it("addNode succeeds and removes nothing when both start() calls succeed", async () => {
    // 対照群: start が両方成功する通常経路では後始末 remove は一切走らない。
    const fake = fakeDocker({ startFailsForImage: () => false });
    const ops = createDockerOperations(fake.docker);
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await lifecycle.addNode("ethereum");
    expect(fake.createdImages).toEqual([RETH_IMAGE, BEACON_IMAGE]);
    expect(fake.removedIds).toEqual([]);
  });
});
