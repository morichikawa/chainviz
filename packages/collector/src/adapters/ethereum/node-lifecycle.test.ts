import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ContainerSpec,
  CreatedContainer,
  DockerOperations,
  LabeledContainer,
} from "../../docker/operations.js";
import {
  allocateNodeIndex,
  EthereumNodeLifecycle,
  parseMnemonic,
  parseNodeIndex,
} from "./node-lifecycle.js";

/** 作成した spec を記録し、削除された ID を記録するフェイク operations。 */
function fakeOps(
  opts: {
    usedIps?: string[];
    createFails?: (spec: ContainerSpec) => boolean;
    stopAndRemoveFails?: (id: string) => boolean;
    managedContainers?: LabeledContainer[];
  } = {},
): DockerOperations & {
  created: ContainerSpec[];
  removed: string[];
} {
  const created: ContainerSpec[] = [];
  const removed: string[] = [];
  let seq = 0;
  return {
    created,
    removed,
    createAndStart: vi.fn(
      async (spec: ContainerSpec): Promise<CreatedContainer> => {
        if (opts.createFails?.(spec)) throw new Error("create failed");
        created.push(spec);
        return { id: `cid-${++seq}` };
      },
    ),
    stopAndRemove: vi.fn(async (id: string): Promise<void> => {
      if (opts.stopAndRemoveFails?.(id)) throw new Error("stopAndRemove failed");
      removed.push(id);
    }),
    usedNetworkIps: vi.fn(async (): Promise<string[]> => opts.usedIps ?? []),
    listContainersByLabels: vi.fn(
      async (): Promise<LabeledContainer[]> => opts.managedContainers ?? [],
    ),
  };
}

const config = { profileDir: "/repo/profiles/ethereum" };

describe("parseMnemonic", () => {
  it("extracts a double-quoted mnemonic from values.env content", () => {
    const content = [
      "export CHAIN_ID=1337",
      'export EL_AND_CL_MNEMONIC="sleep moment list remain"',
      "export EL_PREMINE_COUNT=8",
    ].join("\n");
    expect(parseMnemonic(content)).toBe("sleep moment list remain");
  });

  it("returns undefined when the mnemonic is absent", () => {
    expect(parseMnemonic("export CHAIN_ID=1337")).toBeUndefined();
  });

  it("extracts a single-quoted mnemonic", () => {
    expect(parseMnemonic("export EL_AND_CL_MNEMONIC='word list here'")).toBe(
      "word list here",
    );
  });

  it("extracts an unquoted mnemonic up to the first whitespace", () => {
    expect(parseMnemonic("export EL_AND_CL_MNEMONIC=singleword rest")).toBe(
      "singleword",
    );
  });

  it("tolerates leading whitespace / indentation before export", () => {
    expect(parseMnemonic('   export EL_AND_CL_MNEMONIC="indented value"')).toBe(
      "indented value",
    );
  });

  it("picks the right line when other exports surround it", () => {
    const content = [
      "export FOO=1",
      'export EL_AND_CL_MNEMONIC="the real one"',
      "export EL_AND_CL_MNEMONIC_BACKUP=other",
    ].join("\n");
    expect(parseMnemonic(content)).toBe("the real one");
  });

  it("returns an empty string for an empty double-quoted value", () => {
    expect(parseMnemonic('export EL_AND_CL_MNEMONIC=""')).toBe("");
  });

  it("does not match a differently prefixed variable", () => {
    expect(
      parseMnemonic('export NOT_EL_AND_CL_MNEMONIC="nope"'),
    ).toBeUndefined();
  });
});

describe("allocateNodeIndex", () => {
  it("starts at 3 when 1 and 2 are used", () => {
    const used = new Set(["172.28.1.1", "172.28.1.2", "172.28.2.1", "172.28.2.2"]);
    expect(allocateNodeIndex(used, new Set())).toBe(3);
  });

  it("skips an index whose execution IP is taken", () => {
    const used = new Set(["172.28.1.3"]);
    expect(allocateNodeIndex(used, new Set())).toBe(4);
  });

  it("skips an index whose consensus IP is taken", () => {
    const used = new Set(["172.28.2.3"]);
    expect(allocateNodeIndex(used, new Set())).toBe(4);
  });

  it("skips already-allocated indexes", () => {
    expect(allocateNodeIndex(new Set(), new Set([3, 4]))).toBe(5);
  });

  it("requires both the execution and consensus IP of an index to be free", () => {
    // index 3 has only its consensus IP free (execution taken) -> skip to 4.
    expect(allocateNodeIndex(new Set(["172.28.1.3"]), new Set())).toBe(4);
    // index 3 has only its execution IP free (consensus taken) -> skip to 4.
    expect(allocateNodeIndex(new Set(["172.28.2.3"]), new Set())).toBe(4);
  });

  it("returns the last slot (254) when 3..253 are all taken", () => {
    const taken = new Set<number>();
    for (let i = 3; i <= 253; i++) taken.add(i);
    expect(allocateNodeIndex(new Set(), taken)).toBe(254);
  });

  it("returns undefined when every index 3..254 is allocated", () => {
    const taken = new Set<number>();
    for (let i = 3; i <= 254; i++) taken.add(i);
    expect(allocateNodeIndex(new Set(), taken)).toBeUndefined();
  });

  it("returns undefined when every index is blocked by used IPs", () => {
    const used = new Set<string>();
    for (let i = 3; i <= 254; i++) used.add(`172.28.1.${i}`);
    expect(allocateNodeIndex(used, new Set())).toBeUndefined();
  });

  it("combines used IPs and taken indexes to find the first truly free slot", () => {
    // 3 taken as index, 4 blocked by execution IP, 5 blocked by consensus IP.
    const used = new Set(["172.28.1.4", "172.28.2.5"]);
    expect(allocateNodeIndex(used, new Set([3]))).toBe(6);
  });
});

describe("parseNodeIndex", () => {
  it("extracts the trailing number from a reth service name", () => {
    expect(parseNodeIndex("reth3")).toBe(3);
  });

  it("extracts the trailing number from a beacon service name", () => {
    expect(parseNodeIndex("beacon12")).toBe(12);
  });

  it("returns undefined for a compose node without a managed-style number", () => {
    expect(parseNodeIndex("reth")).toBeUndefined();
  });

  it("returns undefined for a service name that does not start with reth/beacon", () => {
    expect(parseNodeIndex("Alice-1")).toBeUndefined();
  });
});

describe("EthereumNodeLifecycle.recoverManagedContainers", () => {
  function managed(
    service: string,
    role: string,
    id: string,
    project = "chainviz-ethereum",
  ): LabeledContainer {
    return {
      id,
      labels: {
        "com.docker.compose.project": project,
        "com.docker.compose.service": service,
        "com.chainviz.managed": "true",
        "com.chainviz.role": role,
      },
    };
  }

  it("rebuilds a reth+beacon pair and lets removeNode delete it", async () => {
    const ops = fakeOps({
      managedContainers: [
        managed("reth5", "execution", "reth-cid"),
        managed("beacon5", "consensus", "beacon-cid"),
      ],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await lifecycle.removeNode("chainviz-ethereum/reth5");
    expect(ops.removed).toEqual(["beacon-cid", "reth-cid"]);
  });

  it("scopes the recovery query to this chain profile's compose project", async () => {
    const ops = fakeOps({
      managedContainers: [managed("reth5", "execution", "reth-cid")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    expect(ops.listContainersByLabels).toHaveBeenCalledWith({
      "com.chainviz.managed": "true",
      "com.docker.compose.project": "chainviz-ethereum",
    });
  });

  it("recovers a workbench and lets removeWorkbench delete it", async () => {
    const ops = fakeOps({
      managedContainers: [managed("Alice", "workbench", "wb-cid")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await lifecycle.removeWorkbench("chainviz-ethereum/Alice");
    expect(ops.removed).toEqual(["wb-cid"]);
  });

  it("allocates the next free index after recovering an existing node", async () => {
    const ops = fakeOps({
      managedContainers: [
        managed("reth5", "execution", "reth-cid"),
        managed("beacon5", "consensus", "beacon-cid"),
      ],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await lifecycle.addNode("ethereum");
    const services = ops.created.map(
      (s) => s.labels?.["com.docker.compose.service"],
    );
    // 回収済みの index 5 は taken として扱われるため、次の addNode は
    // (index 5 と衝突せず) 空いている最小の index である 3 を選ぶ。
    expect(services).toEqual(["reth3", "beacon3"]);
  });

  it("still allows removing a node whose pair is incomplete (only execution survived)", async () => {
    const ops = fakeOps({
      managedContainers: [managed("reth7", "execution", "reth-cid")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await lifecycle.removeNode("chainviz-ethereum/reth7");
    expect(ops.removed).toEqual(["reth-cid"]);
  });

  it("still allows removing a node whose pair is incomplete (only consensus survived)", async () => {
    const ops = fakeOps({
      managedContainers: [managed("beacon8", "consensus", "beacon-cid")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await lifecycle.removeNode("chainviz-ethereum/beacon8");
    expect(ops.removed).toEqual(["beacon-cid"]);
  });

  it("skips a managed container with no compose service label", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ops = fakeOps({
      managedContainers: [
        { id: "orphan-cid", labels: { "com.chainviz.managed": "true" } },
      ],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await expect(
      lifecycle.removeWorkbench("chainviz-ethereum/orphan"),
    ).rejects.toThrow(/was not added via addWorkbench/);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("has no com.docker.compose.service label"),
    );
    warnSpy.mockRestore();
  });

  it("skips a managed container with an unrecognized role label", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ops = fakeOps({
      managedContainers: [managed("mystery1", "sidecar", "mystery-cid")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    expect(ops.removed).toHaveLength(0);
    await expect(
      lifecycle.removeNode("chainviz-ethereum/mystery1"),
    ).rejects.toThrow(/was not added via addNode/);
    warnSpy.mockRestore();
  });

  it("skips a node/consensus container whose service name has no parseable index", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ops = fakeOps({
      managedContainers: [managed("reth", "execution", "weird-cid")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth"),
    ).rejects.toThrow(/was not added via addNode/);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("no parseable node index"),
    );
    warnSpy.mockRestore();
  });

  it("skips a managed container that has no compose project label", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ops = fakeOps({
      managedContainers: [
        {
          id: "reth-cid",
          labels: {
            "com.docker.compose.service": "reth9",
            "com.chainviz.managed": "true",
            "com.chainviz.role": "execution",
          },
        },
      ],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    // project ラベルが無いコンテナは安定 ID を捏造せずスキップするため、
    // removeNode は「addNode で追加されていない」として拒否される。
    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth9"),
    ).rejects.toThrow(/was not added via addNode/);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("has no com.docker.compose.project label"),
    );
    warnSpy.mockRestore();
  });

  it("recovers multiple workbenches so a later addWorkbench avoids name collisions", async () => {
    const ops = fakeOps({
      managedContainers: [
        managed("Alice", "workbench", "alice-cid"),
        managed("Bob", "workbench", "bob-cid"),
      ],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await lifecycle.addWorkbench("Alice");
    const services = ops.created.map(
      (s) => s.labels?.["com.docker.compose.service"],
    );
    // "Alice" は既に管理下にあるので "-2" に退避する。
    expect(services).toEqual(["Alice-2"]);
  });
});

describe("EthereumNodeLifecycle.addNode", () => {
  it("rejects a non-ethereum chain profile without creating anything", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await expect(lifecycle.addNode("solana")).rejects.toThrow(
      /unsupported chain profile/,
    );
    expect(ops.created).toHaveLength(0);
  });

  it("creates a reth then a beacon follower pair with paired index 3", async () => {
    const ops = fakeOps({
      usedIps: ["172.28.1.1", "172.28.1.2", "172.28.2.1", "172.28.2.2"],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");

    expect(ops.created).toHaveLength(2);
    const [reth, beacon] = ops.created;

    // reth を先に起動する。
    expect(reth.image).toBe("ghcr.io/paradigmxyz/reth:latest");
    expect(reth.ipv4Address).toBe("172.28.1.3");
    expect(reth.entrypoint).toEqual(["/bin/sh", "/scripts/reth-node.sh"]);
    expect(reth.labels?.["com.docker.compose.project"]).toBe("chainviz-ethereum");
    expect(reth.labels?.["com.docker.compose.service"]).toBe("reth3");
    expect(reth.binds).toContain(
      "chainviz-ethereum_genesis:/genesis:ro",
    );
    expect(reth.binds).toContain("chainviz-ethereum_elpeer:/elpeer:ro");
    expect(reth.binds).toContain(
      "/repo/profiles/ethereum/scripts/reth-node.sh:/scripts/reth-node.sh:ro",
    );
    // 追加ノードは peer 役で起動し、自分の固定 IP を P2P 広告に使う。
    expect(reth.env).toMatchObject({
      RETH_ROLE: "peer",
      RETH_P2P_IP: "172.28.1.3",
    });

    expect(beacon.image).toBe("sigp/lighthouse:latest");
    expect(beacon.ipv4Address).toBe("172.28.2.3");
    expect(beacon.labels?.["com.docker.compose.service"]).toBe("beacon3");
    expect(beacon.env).toMatchObject({
      BEACON_ROLE: "peer",
      ENR_ADDRESS: "172.28.2.3",
      EXECUTION_ENDPOINT: "http://172.28.1.3:8551",
    });
    expect(beacon.binds).toContain("chainviz-ethereum_clpeer:/clpeer:ro");
  });

  it("allocates the next free index on a second addNode", async () => {
    const ops = fakeOps({
      usedIps: ["172.28.1.1", "172.28.1.2", "172.28.2.1", "172.28.2.2"],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");
    await lifecycle.addNode("ethereum");

    const services = ops.created.map(
      (s) => s.labels?.["com.docker.compose.service"],
    );
    expect(services).toEqual(["reth3", "beacon3", "reth4", "beacon4"]);
  });

  it("rolls back the reth container if the beacon fails to start", async () => {
    const ops = fakeOps({
      usedIps: [],
      createFails: (spec) =>
        spec.image === "sigp/lighthouse:latest",
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await expect(lifecycle.addNode("ethereum")).rejects.toThrow(
      /create failed/,
    );
    // reth は作られたが、後始末で削除されている。
    expect(ops.created).toHaveLength(1);
    expect(ops.removed).toEqual(["cid-1"]);
  });

  it("propagates the original beacon error even if the reth rollback also fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ops = fakeOps({
      usedIps: [],
      createFails: (spec) => spec.image === "sigp/lighthouse:latest",
      stopAndRemoveFails: () => true,
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    // 後始末が失敗しても、呼び出し元へは根本原因の beacon エラー
    // （"create failed"）が伝わり、後始末エラー（"stopAndRemove failed"）に
    // 差し替わらない。
    await expect(lifecycle.addNode("ethereum")).rejects.toThrow(/create failed/);
    // reth の後始末は試みられている（記録は失敗のため removed には残らない）。
    expect(ops.stopAndRemove).toHaveBeenCalledWith("cid-1");
    expect(ops.removed).toHaveLength(0);
    // 後始末の失敗はログに残る（黙って握りつぶさない）。
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to roll back reth"),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it("does not try to roll back or register anything when reth itself fails", async () => {
    const ops = fakeOps({
      createFails: (spec) => spec.image === "ghcr.io/paradigmxyz/reth:latest",
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await expect(lifecycle.addNode("ethereum")).rejects.toThrow(/create failed/);
    expect(ops.created).toHaveLength(0);
    expect(ops.removed).toHaveLength(0);
  });

  it("does not consume the index when addNode fails, so a retry reuses it", async () => {
    let failBeacon = true;
    const ops = fakeOps({
      createFails: (spec) =>
        failBeacon && spec.image === "sigp/lighthouse:latest",
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await expect(lifecycle.addNode("ethereum")).rejects.toThrow();
    failBeacon = false;
    await lifecycle.addNode("ethereum");
    const services = ops.created
      .map((s) => s.labels?.["com.docker.compose.service"])
      .filter((s) => s?.startsWith("reth"));
    // 失敗時の reth3 と、成功時の reth3（同じ index を再利用）。
    expect(services).toEqual(["reth3", "reth3"]);
  });

  it("throws when the network has no free slot and creates nothing", async () => {
    const used: string[] = [];
    for (let i = 3; i <= 254; i++) {
      used.push(`172.28.1.${i}`, `172.28.2.${i}`);
    }
    const ops = fakeOps({ usedIps: used });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await expect(lifecycle.addNode("ethereum")).rejects.toThrow(
      /no free node slot/,
    );
    expect(ops.created).toHaveLength(0);
  });

  it("skips an index already used in the live network (from usedNetworkIps)", async () => {
    // reth3's execution IP is already occupied in the network -> allocate 4.
    const ops = fakeOps({ usedIps: ["172.28.1.3"] });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");
    const services = ops.created.map(
      (s) => s.labels?.["com.docker.compose.service"],
    );
    expect(services).toEqual(["reth4", "beacon4"]);
  });
});

describe("EthereumNodeLifecycle.removeNode", () => {
  it("removes both containers of an added node (by the beacon's id)", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");

    await lifecycle.removeNode("chainviz-ethereum/beacon3");
    // beacon (cid-2) を先に、reth (cid-1) を後に削除する。
    expect(ops.removed).toEqual(["cid-2", "cid-1"]);
  });

  it("removes an added node identified by its reth id too", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");
    await lifecycle.removeNode("chainviz-ethereum/reth3");
    expect(ops.removed).toEqual(["cid-2", "cid-1"]);
  });

  it("refuses to remove a compose-started node that was not added", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth1"),
    ).rejects.toThrow(/was not added via addNode/);
    expect(ops.removed).toHaveLength(0);
  });

  it("frees the index so a subsequent addNode reuses it", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum"); // index 3
    await lifecycle.removeNode("chainviz-ethereum/reth3");
    await lifecycle.addNode("ethereum"); // index 3 again (free)
    const services = ops.created
      .slice(2)
      .map((s) => s.labels?.["com.docker.compose.service"]);
    expect(services).toEqual(["reth3", "beacon3"]);
  });

  it("rejects a second removeNode for the same node (already de-registered)", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");
    await lifecycle.removeNode("chainviz-ethereum/reth3");
    await expect(
      lifecycle.removeNode("chainviz-ethereum/beacon3"),
    ).rejects.toThrow(/was not added via addNode/);
    // 二重削除で余計な stopAndRemove を呼ばない。
    expect(ops.removed).toEqual(["cid-2", "cid-1"]);
  });

  it("does not touch Docker when asked to remove an unknown node id", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");
    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth99"),
    ).rejects.toThrow(/was not added via addNode/);
    expect(ops.removed).toHaveLength(0);
  });

  it("does not confuse a compose node id whose name is a prefix of a managed one", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum"); // registers reth3/beacon3
    // "reth" alone, or "reth3x", must not match the managed reth3.
    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth"),
    ).rejects.toThrow(/was not added via addNode/);
    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth30"),
    ).rejects.toThrow(/was not added via addNode/);
    expect(ops.removed).toHaveLength(0);
  });

  it("propagates a stopAndRemove failure from removeNode", async () => {
    const ops = fakeOps();
    ops.stopAndRemove = vi.fn(async () => {
      throw new Error("docker down");
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");
    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth3"),
    ).rejects.toThrow(/docker down/);
  });

  it("keeps the node registered when removal fails, so a retry can finish the job", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum"); // reth3 = cid-1, beacon3 = cid-2

    // 1 回目: consensus(cid-2) の削除で失敗する。
    const original = ops.stopAndRemove;
    ops.stopAndRemove = vi.fn(async (id: string) => {
      if (id === "cid-2") throw new Error("docker down");
      await original(id);
    });
    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth3"),
    ).rejects.toThrow(/docker down/);

    // 登録が残っているので再実行できる。2 回目は両コンテナを削除する。
    ops.stopAndRemove = original;
    await lifecycle.removeNode("chainviz-ethereum/reth3");
    expect(ops.removed).toEqual(["cid-2", "cid-1"]);

    // 成功後は登録が外れている。
    await expect(
      lifecycle.removeNode("chainviz-ethereum/reth3"),
    ).rejects.toThrow(/was not added via addNode/);
  });

  it("finishes removing the execution leftover when the first attempt failed halfway", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum"); // reth3 = cid-1, beacon3 = cid-2

    // 1 回目: consensus は削除できたが execution(cid-1) で失敗する。
    const original = ops.stopAndRemove;
    let failExecution = true;
    ops.stopAndRemove = vi.fn(async (id: string) => {
      if (failExecution && id === "cid-1") throw new Error("busy");
      await original(id);
    });
    await expect(
      lifecycle.removeNode("chainviz-ethereum/beacon3"),
    ).rejects.toThrow(/busy/);
    expect(ops.removed).toEqual(["cid-2"]); // consensus だけ消えている

    // 再実行では削除済みの consensus へ重ねて stopAndRemove が飛ぶが、
    // DockerOperations の契約（削除済みでも失敗しない）により成功する。
    failExecution = false;
    await lifecycle.removeNode("chainviz-ethereum/beacon3");
    expect(ops.removed).toEqual(["cid-2", "cid-2", "cid-1"]);
  });
});

describe("EthereumNodeLifecycle workbench commands", () => {
  it("creates a foundry workbench reflecting the given label", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");

    expect(ops.created).toHaveLength(1);
    const wb = ops.created[0];
    expect(wb.image).toBe("ghcr.io/foundry-rs/foundry:latest");
    expect(wb.entrypoint).toEqual(["/bin/sh", "-c", "sleep infinity"]);
    expect(wb.labels?.["com.docker.compose.service"]).toBe("Alice");
    expect(wb.env?.ETH_RPC_URL).toBe("http://172.28.1.1:8545");
  });

  it("disambiguates duplicate workbench labels", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");
    await lifecycle.addWorkbench("Alice");
    const services = ops.created.map(
      (s) => s.labels?.["com.docker.compose.service"],
    );
    expect(services).toEqual(["Alice", "Alice-2"]);
  });

  it("removes an added workbench", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");
    await lifecycle.removeWorkbench("chainviz-ethereum/Alice");
    expect(ops.removed).toEqual(["cid-1"]);
  });

  it("resolves both concurrent removeWorkbench calls for the same workbench", async () => {
    // 同じ workbenchId に対する removeWorkbench が短時間に重なるケース。
    // stopAndRemove 側で 409（削除進行中）が成功相当に扱われる（dockerode-operations）
    // 前提のもとでは、両方の呼び出しとも解決し、登録は残らない（孤児が生じない）。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");

    const results = await Promise.allSettled([
      lifecycle.removeWorkbench("chainviz-ethereum/Alice"),
      lifecycle.removeWorkbench("chainviz-ethereum/Alice"),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    // 削除後は登録が外れており、以降の removeWorkbench は拒否される。
    await expect(
      lifecycle.removeWorkbench("chainviz-ethereum/Alice"),
    ).rejects.toThrow(/was not added via addWorkbench/);
  });

  it("refuses to remove a workbench that was not added", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await expect(
      lifecycle.removeWorkbench("chainviz-ethereum/workbench"),
    ).rejects.toThrow(/was not added via addWorkbench/);
    expect(ops.removed).toHaveLength(0);
  });

  it("uses a custom RPC URL when configured", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      ...config,
      ethRpcUrl: "http://172.28.1.9:8545",
    });
    await lifecycle.addWorkbench("Bob");
    expect(ops.created[0].env?.ETH_RPC_URL).toBe("http://172.28.1.9:8545");
  });

  it("falls back to a default service for an empty or whitespace label", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("");
    await lifecycle.addWorkbench("   ");
    const services = ops.created.map(
      (s) => s.labels?.["com.docker.compose.service"],
    );
    expect(services).toEqual(["workbench", "workbench-2"]);
  });

  it("gives each workbench a unique container name via the sequence counter", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");
    await lifecycle.addWorkbench("Bob");
    const names = ops.created.map((s) => s.name);
    expect(new Set(names).size).toBe(2);
    expect(names).toEqual([
      "chainviz-ethereum-Alice-1",
      "chainviz-ethereum-Bob-2",
    ]);
  });

  it("rejects a second removeWorkbench for the same workbench", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");
    await lifecycle.removeWorkbench("chainviz-ethereum/Alice");
    await expect(
      lifecycle.removeWorkbench("chainviz-ethereum/Alice"),
    ).rejects.toThrow(/was not added via addWorkbench/);
    expect(ops.removed).toEqual(["cid-1"]);
  });

  it("frees a workbench label after removal so it can be reused", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");
    await lifecycle.removeWorkbench("chainviz-ethereum/Alice");
    await lifecycle.addWorkbench("Alice");
    const services = ops.created.map(
      (s) => s.labels?.["com.docker.compose.service"],
    );
    // 2 度目も -2 が付かず素の "Alice" を再利用できる。
    expect(services).toEqual(["Alice", "Alice"]);
  });

  it("rejects removeWorkbench on an empty registry without touching Docker", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await expect(
      lifecycle.removeWorkbench("chainviz-ethereum/Alice"),
    ).rejects.toThrow(/was not added via addWorkbench/);
    expect(ops.removed).toHaveLength(0);
  });

  it("omits EL_AND_CL_MNEMONIC when values.env cannot be read", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      profileDir: "/nonexistent/profile/dir",
    });
    await lifecycle.addWorkbench("Alice");
    expect(ops.created[0].env?.EL_AND_CL_MNEMONIC).toBeUndefined();
  });

  it("passes the mnemonic from values.env into the workbench env", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "chainviz-profile-"));
    writeFileSync(
      path.join(dir, "values.env"),
      'export EL_AND_CL_MNEMONIC="alpha bravo charlie"\n',
    );
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, { profileDir: dir });
    await lifecycle.addWorkbench("Alice");
    expect(ops.created[0].env?.EL_AND_CL_MNEMONIC).toBe("alpha bravo charlie");
  });

  it("keeps the workbench registered when removal fails, so a retry can finish the job", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");

    const original = ops.stopAndRemove;
    ops.stopAndRemove = vi.fn(async () => {
      throw new Error("docker down");
    });
    await expect(
      lifecycle.removeWorkbench("chainviz-ethereum/Alice"),
    ).rejects.toThrow(/docker down/);
    expect(ops.removed).toHaveLength(0);

    // 登録が残っているので再実行で削除を完遂できる。
    ops.stopAndRemove = original;
    await lifecycle.removeWorkbench("chainviz-ethereum/Alice");
    expect(ops.removed).toEqual(["cid-1"]);
  });
});
