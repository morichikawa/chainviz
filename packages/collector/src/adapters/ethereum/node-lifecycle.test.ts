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
import { CONFIG_HASH_LABEL } from "./labels.js";
import { walletTrackingDisabledWarning } from "./mnemonic.js";
import {
  allocateNodeIndex,
  allocateWalletIndex,
  EthereumNodeLifecycle,
  extractHost,
  isIpv4Literal,
  parseMnemonic,
  parseNodeIndex,
} from "./node-lifecycle.js";
import { WALLET_INDEX_LABEL } from "./wallet-derivation.js";

/** 作成した spec を記録し、削除された ID を記録するフェイク operations。 */
function fakeOps(
  opts: {
    usedIps?: string[];
    createFails?: (spec: ContainerSpec) => boolean;
    stopAndRemoveFails?: (id: string) => boolean;
    managedContainers?: LabeledContainer[];
    exec?: (containerId: string, cmd: string[]) => Promise<ExecResult>;
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
    exec: vi.fn(
      opts.exec ??
        (async (): Promise<ExecResult> => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
        })),
    ),
  };
}

const config = {
  profileDir: "/repo/profiles/ethereum",
  ethRpcUrl: "http://host.docker.internal:4001",
};

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

describe("walletTrackingDisabledWarning", () => {
  it("returns a warning message when the mnemonic is undefined", () => {
    expect(walletTrackingDisabledWarning(undefined)).toMatch(
      /wallet tracking disabled/,
    );
  });

  it("returns undefined when a mnemonic is present", () => {
    expect(
      walletTrackingDisabledWarning("sleep moment list remain"),
    ).toBeUndefined();
  });

  it("returns a warning for an empty-string mnemonic", () => {
    // parseMnemonic は EL_AND_CL_MNEMONIC="" を空文字列として返す。ウォレット
    // 層を無効化する側（wallet-tracker / adapters/ethereum/index）はいずれも
    // falsy 判定（!this.mnemonic）で無効化するため、空文字列でも追跡は無効
    // 化される。黙って無効化されないよう、警告の判定も falsy に揃える。
    expect(walletTrackingDisabledWarning("")).toMatch(
      /wallet tracking disabled/,
    );
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

describe("allocateWalletIndex", () => {
  it("starts at 1 (reserving 0 for the compose workbench)", () => {
    expect(allocateWalletIndex(new Set())).toBe(1);
  });

  it("returns the smallest free index", () => {
    expect(allocateWalletIndex(new Set([1, 2]))).toBe(3);
  });

  it("fills a gap left by a removed workbench", () => {
    expect(allocateWalletIndex(new Set([1, 3]))).toBe(2);
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

describe("extractHost", () => {
  it("extracts the hostname from an http URL", () => {
    expect(extractHost("http://host.docker.internal:4001")).toBe(
      "host.docker.internal",
    );
  });

  it("extracts an IPv4 host as-is", () => {
    expect(extractHost("http://172.28.1.1:8545")).toBe("172.28.1.1");
  });

  it("returns undefined for an unparseable URL", () => {
    expect(extractHost("not a url")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(extractHost("")).toBeUndefined();
  });

  it("returns undefined for a bare hostname with no scheme or authority", () => {
    // "host.docker.internal" 単体は URL としてパースできず undefined。
    expect(extractHost("host.docker.internal")).toBeUndefined();
  });

  it("returns an empty hostname for a scheme-less host:port string", () => {
    // "host.docker.internal:4001" は URL 的には "host.docker.internal:" を
    // スキーム、"4001" を opaque path とみなしてパースが成功してしまい、
    // hostname は空文字列になる（undefined ではない）。呼び出し側の
    // workbenchExtraHosts は空文字列を falsy として扱い extra_hosts を付与
    // しないため実害は無いが、直感に反する挙動なので回帰対象として固定する。
    expect(extractHost("host.docker.internal:4001")).toBe("");
  });

  it("drops the port and path, keeping only the hostname", () => {
    expect(extractHost("http://host.docker.internal:4001/rpc?x=1")).toBe(
      "host.docker.internal",
    );
  });

  it("lowercases the hostname (URL host normalization)", () => {
    // extra_hosts エントリの重複や大文字小文字の揺れを避けるため、URL 側で
    // 正規化された小文字ホストが得られることを固定する。
    expect(extractHost("http://Host.Docker.Internal:4001")).toBe(
      "host.docker.internal",
    );
  });

  it("keeps the brackets for an IPv6 literal host", () => {
    // Node の URL は IPv6 リテラルを角括弧付きで返す。chainviz の Ethereum
    // プロファイルは IPv4 帯（172.28.x.x）と host.docker.internal しか使わない
    // ため実運用では通らない経路だが、現状の挙動を回帰対象として固定する。
    expect(extractHost("http://[::1]:8545")).toBe("[::1]");
  });
});

describe("isIpv4Literal", () => {
  it("recognizes a dotted-quad IPv4 address", () => {
    expect(isIpv4Literal("172.28.1.1")).toBe(true);
  });

  it("rejects a hostname", () => {
    expect(isIpv4Literal("host.docker.internal")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isIpv4Literal("")).toBe(false);
  });

  it("rejects a three-group or five-group dotted number", () => {
    expect(isIpv4Literal("1.2.3")).toBe(false);
    expect(isIpv4Literal("1.2.3.4.5")).toBe(false);
  });

  it("rejects a dotted-quad that still carries a port suffix", () => {
    // extractHost はホスト部だけを渡す想定なので通常は起きないが、万一
    // "172.28.1.1:8545" が渡ってもホスト名扱い（= extra_hosts 付与）に
    // 倒れることを固定する。
    expect(isIpv4Literal("172.28.1.1:8545")).toBe(false);
  });

  it("rejects an IPv6 literal (with or without brackets)", () => {
    expect(isIpv4Literal("::1")).toBe(false);
    expect(isIpv4Literal("[::1]")).toBe(false);
  });

  it("classifies an out-of-range dotted-quad as an IPv4 literal (documented limitation)", () => {
    // 現状の判定は各オクテットが 0..255 に収まるかまでは検査しない。
    // ホスト名解決の要否を分けるだけの用途では、数字4組を「解決不要な
    // リテラル」とみなしても実害が無いためこの緩さを許容している。
    // 意図せぬ厳格化のデグレを検知できるよう現状を固定する。
    expect(isIpv4Literal("999.999.999.999")).toBe(true);
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

  it("restores the recovered workbench's wallet index so later allocations avoid it", async () => {
    // ラベルに index=1 を持つワークベンチを回収した後の addWorkbench は、
    // 1 を再利用せず次の空き（2）を割り当てる。
    const recovered: LabeledContainer = {
      id: "wb-cid",
      labels: {
        "com.docker.compose.project": "chainviz-ethereum",
        "com.docker.compose.service": "Alice",
        "com.chainviz.managed": "true",
        "com.chainviz.role": "workbench",
        [WALLET_INDEX_LABEL]: "1",
      },
    };
    const ops = fakeOps({ managedContainers: [recovered] });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await lifecycle.addWorkbench("Bob");
    expect(ops.created[0]?.labels?.[WALLET_INDEX_LABEL]).toBe("2");
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

  it("advances to -3 when both the base label and its -2 variant are taken", async () => {
    // uniqueWorkbenchService の採番ループ（for n=2,3,...）が -2 で止まらず、
    // 衝突が続く限り正しく次の番号へ進むことを確認する（UI-CMD-06 の一意化
    // 挙動の境界値。同名を 3 回以上追加した場合に相当する。既存の -2 テストは
    // ループが 1 周で返るケースしか通らず、増分ロジックのデグレを検知できない）。
    const ops = fakeOps({
      managedContainers: [
        managed("Alice", "workbench", "alice-cid"),
        managed("Alice-2", "workbench", "alice2-cid"),
      ],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await lifecycle.addWorkbench("Alice");
    const services = ops.created.map(
      (s) => s.labels?.["com.docker.compose.service"],
    );
    expect(services).toEqual(["Alice-3"]);
  });

  it("falls back to the 'workbench' service name for an empty label", async () => {
    // 空ラベルはフロント側（resolveWorkbenchLabel）で既定値に置換されるが、
    // collector を WebSocket 越しに直接叩く経路では素の空文字列が届きうる。
    // その防御として空/空白のみのラベルは "workbench" にフォールバックする。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);

    await lifecycle.addWorkbench("");
    expect(ops.created[0]?.labels?.["com.docker.compose.service"]).toBe(
      "workbench",
    );
  });

  it("trims surrounding whitespace and unique-suffixes the default fallback", async () => {
    // 前後の空白は除去し（"  Bob  " → "Bob"）、空白のみは "workbench" に
    // フォールバックする。既に "workbench" が居る状態で更に空ラベルを足すと
    // 一意化ループが働き "workbench-2" になる。
    const ops = fakeOps({
      managedContainers: [managed("workbench", "workbench", "wb-cid")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.recoverManagedContainers();

    await lifecycle.addWorkbench("  Bob  ");
    await lifecycle.addWorkbench("   ");
    const services = ops.created.map(
      (s) => s.labels?.["com.docker.compose.service"],
    );
    expect(services).toEqual(["Bob", "workbench-2"]);
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

  it("labels reth and beacon containers with CONFIG_HASH_LABEL so docker compose down --remove-orphans can recognize and remove them (Issue #359)", async () => {
    // 実機検証（docs/worklog/issue-359.md）: com.docker.compose.project /
    // com.docker.compose.service が正しくても、この CONFIG_HASH_LABEL が
    // 無いと Docker Compose がコンテナを一切認識せず、`docker compose ps -a`
    // にも `down -v --remove-orphans` の孤児検出にも現れなかった。
    const ops = fakeOps({
      usedIps: ["172.28.1.1", "172.28.1.2", "172.28.2.1", "172.28.2.2"],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");

    const [reth, beacon] = ops.created;
    expect(reth.labels?.[CONFIG_HASH_LABEL]).toBeTruthy();
    expect(beacon.labels?.[CONFIG_HASH_LABEL]).toBeTruthy();
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
    // reth へ直結させず、必ずロギングプロキシ経由の URL を渡す（Issue #129）。
    expect(wb.env?.ETH_RPC_URL).toBe(config.ethRpcUrl);
  });

  it("labels the workbench container with CONFIG_HASH_LABEL so docker compose down --remove-orphans can recognize and remove it (Issue #359)", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");

    const wb = ops.created[0];
    expect(wb.labels?.[CONFIG_HASH_LABEL]).toBeTruthy();
  });

  it("mounts the sample contracts project so deployContract (forge create) can find it (Issue #293)", async () => {
    // 動的に addWorkbench したコンテナには docker-compose.yml の静的
    // `workbench` サービスと同じ /contracts bind mount が必要。無いと
    // forge create --root /contracts が「No contract found」で必ず失敗する。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");

    const wb = ops.created[0];
    expect(wb.binds).toContain(
      `${config.profileDir}/contracts:/contracts`,
    );
  });

  it("maps the proxy hostname to Docker's host-gateway so the container can reach it", async () => {
    // 既定の ethRpcUrl は host.docker.internal（ホスト名）を指すため、
    // extra_hosts で host-gateway へのマッピングが必要（静的ワークベンチの
    // docker-compose.yml と同じ仕組み）。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");
    expect(ops.created[0]?.extraHosts).toEqual([
      "host.docker.internal:host-gateway",
    ]);
  });

  it("omits the host-gateway mapping when ethRpcUrl already points at a bare IP", async () => {
    // IP リテラル直指定（例: テストや特殊な運用での上書き）ではホスト名解決が
    // 不要なので、無意味な extra_hosts エントリを追加しない。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      ...config,
      ethRpcUrl: "http://172.28.1.9:8545",
    });
    await lifecycle.addWorkbench("Alice");
    expect(ops.created[0]?.extraHosts).toBeUndefined();
  });

  it("maps an arbitrary custom hostname (e.g. an env override) to host-gateway", async () => {
    // CHAINVIZ_WORKBENCH_RPC_HOST 相当の上書きでも、ホスト名であれば
    // host-gateway マッピングが付くこと（IPv4 リテラルとの分岐が値に
    // 依存して正しく効くこと）を固定する。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      ...config,
      ethRpcUrl: "http://custom-host:4001",
    });
    await lifecycle.addWorkbench("Alice");
    expect(ops.created[0]?.extraHosts).toEqual(["custom-host:host-gateway"]);
  });

  it("maps the mapping using the normalized (lowercased, port-stripped) hostname", async () => {
    // ETH_RPC_URL にポートや大文字が含まれても、extra_hosts エントリは
    // 正規化済みホスト名だけで組み立てる。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      ...config,
      ethRpcUrl: "http://Host.Docker.Internal:4001/rpc",
    });
    await lifecycle.addWorkbench("Alice");
    expect(ops.created[0]?.extraHosts).toEqual([
      "host.docker.internal:host-gateway",
    ]);
    // ETH_RPC_URL 自体は渡された文字列のまま（正規化しない）。
    expect(ops.created[0]?.env?.ETH_RPC_URL).toBe(
      "http://Host.Docker.Internal:4001/rpc",
    );
  });

  it("omits extra_hosts (but still sets ETH_RPC_URL) when ethRpcUrl is unparseable", async () => {
    // ホスト部を取り出せない壊れた URL でも addWorkbench は失敗せず、
    // extra_hosts を付けないだけ（extractHost が undefined を返す分岐）。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      ...config,
      ethRpcUrl: "not-a-url",
    });
    await lifecycle.addWorkbench("Alice");
    expect(ops.created[0]?.extraHosts).toBeUndefined();
    expect(ops.created[0]?.env?.ETH_RPC_URL).toBe("not-a-url");
  });

  it("omits extra_hosts when ethRpcUrl parses to an empty hostname (scheme-less host:port)", async () => {
    // extractHost が空文字列を返すケース（"host:port" 形式）でも、
    // workbenchExtraHosts は falsy 判定で extra_hosts を付与しない。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      ...config,
      ethRpcUrl: "host.docker.internal:4001",
    });
    await lifecycle.addWorkbench("Alice");
    expect(ops.created[0]?.extraHosts).toBeUndefined();
    expect(ops.created[0]?.env?.ETH_RPC_URL).toBe("host.docker.internal:4001");
  });

  it("does not set extra_hosts on the reth/beacon specs of addNode", async () => {
    // extraHosts はワークベンチ専用の配線であり、Issue #129 の ContainerSpec
    // 追加がノード（reth/beacon）側のコンテナ生成に漏れていないことを固定する。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addNode("ethereum");
    for (const spec of ops.created) {
      expect(spec.extraHosts).toBeUndefined();
    }
  });

  it("assigns distinct wallet derivation indexes starting at 1", async () => {
    // 0 は compose 由来のワークベンチ用に予約し、collector が作成する
    // ワークベンチには 1, 2, ... を割り当てて別々のアドレスにする。
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice");
    await lifecycle.addWorkbench("Bob");
    const indexes = ops.created.map((s) => s.labels?.[WALLET_INDEX_LABEL]);
    expect(indexes).toEqual(["1", "2"]);
  });

  it("reuses a freed wallet index after a workbench is removed", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, config);
    await lifecycle.addWorkbench("Alice"); // index 1
    await lifecycle.addWorkbench("Bob"); // index 2
    await lifecycle.removeWorkbench("chainviz-ethereum/Alice"); // frees index 1
    await lifecycle.addWorkbench("Carol"); // reuses index 1
    expect(ops.created[2]?.labels?.[WALLET_INDEX_LABEL]).toBe("1");
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
      ...config,
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
    const lifecycle = new EthereumNodeLifecycle(ops, { ...config, profileDir: dir });
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

describe("EthereumNodeLifecycle.runWorkbenchOperation", () => {
  /** mnemonic 付きの一時 profileDir を用意し、そこを指す config を返す。 */
  function configWithMnemonic(mnemonic = "alpha bravo charlie"): typeof config {
    const dir = mkdtempSync(path.join(tmpdir(), "chainviz-profile-"));
    writeFileSync(
      path.join(dir, "values.env"),
      `export EL_AND_CL_MNEMONIC="${mnemonic}"\n`,
    );
    return { ...config, profileDir: dir };
  }

  /** compose ラベル一式を持つワークベンチコンテナのフェイク観測値。 */
  function workbenchContainer(
    service: string,
    id: string,
    walletIndex?: number,
  ): LabeledContainer {
    const labels: Record<string, string> = {
      "com.docker.compose.project": "chainviz-ethereum",
      "com.docker.compose.service": service,
    };
    if (walletIndex !== undefined) {
      labels[WALLET_INDEX_LABEL] = String(walletIndex);
    }
    return { id, labels };
  }

  const transfer: WorkbenchOperation = {
    type: "transfer",
    to: "0x8943545177806ED17B9F23F0a21ee5948eCaa776",
    amount: "1000000000000000000",
  };

  it("throws when the profile mnemonic is unavailable, without touching Docker", async () => {
    const ops = fakeOps();
    const lifecycle = new EthereumNodeLifecycle(ops, {
      ...config,
      profileDir: "/nonexistent/profile/dir",
    });
    await expect(
      lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", transfer),
    ).rejects.toThrow(/mnemonic not found/);
    expect(ops.listContainersByLabels).not.toHaveBeenCalled();
    expect(ops.exec).not.toHaveBeenCalled();
  });

  it("throws when the target workbench cannot be found", async () => {
    const ops = fakeOps({ managedContainers: [] });
    const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
    await expect(
      lifecycle.runWorkbenchOperation("chainviz-ethereum/ghost", transfer),
    ).rejects.toThrow(/workbench chainviz-ethereum\/ghost not found/);
    expect(ops.exec).not.toHaveBeenCalled();
  });

  it("scopes the workbench search to this chain profile's compose project", async () => {
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 3)],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", transfer);
    expect(ops.listContainersByLabels).toHaveBeenCalledWith({
      "com.docker.compose.project": "chainviz-ethereum",
    });
  });

  it("execs the built cast command in the resolved managed workbench's container", async () => {
    const mnemonic = "alpha bravo charlie";
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 3)],
    });
    const lifecycle = new EthereumNodeLifecycle(
      ops,
      configWithMnemonic(mnemonic),
    );
    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", transfer);

    expect(ops.exec).toHaveBeenCalledWith("wb-cid", [
      "cast",
      "send",
      "--rpc-url",
      config.ethRpcUrl,
      "--mnemonic",
      mnemonic,
      "--mnemonic-index",
      "3",
      "--value",
      "1000000000000000000",
      "0x8943545177806ED17B9F23F0a21ee5948eCaa776",
    ]);
  });

  it("defaults to wallet index 0 for a static/unmanaged workbench (no wallet-index label)", async () => {
    // docker-compose.yml の静的な `workbench` サービスは com.chainviz の
    // ラベルを持たないため、addWorkbench 由来ではなくてもプリマインの
    // 先頭アカウント（既定インデックス 0）で操作できる必要がある。
    const ops = fakeOps({
      managedContainers: [workbenchContainer("workbench", "static-wb-cid")],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
    await lifecycle.runWorkbenchOperation(
      "chainviz-ethereum/workbench",
      transfer,
    );
    const call = (ops.exec as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string[],
    ];
    expect(call[0]).toBe("static-wb-cid");
    const indexFlagPos = call[1].indexOf("--mnemonic-index");
    expect(call[1][indexFlagPos + 1]).toBe("0");
  });

  it("returns the parsed txHash on a successful transfer", async () => {
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
      exec: async () => ({
        exitCode: 0,
        stdout: "transactionHash         0xabc123\n",
        stderr: "",
      }),
    });
    const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
    const result = await lifecycle.runWorkbenchOperation(
      "chainviz-ethereum/Alice",
      transfer,
    );
    expect(result).toEqual({ txHash: "0xabc123" });
  });

  it("returns the parsed txHash and deployedAddress on a successful deployContract", async () => {
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
      exec: async () => ({
        exitCode: 0,
        stdout: [
          "Deployed to: 0x2222222222222222222222222222222222222222",
          "Transaction hash: 0x3333333333333333333333333333333333333333333333333333333333333333",
        ].join("\n"),
        stderr: "",
      }),
    });
    const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
    const deploy: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/Counter.sol:Counter",
    };
    const result = await lifecycle.runWorkbenchOperation(
      "chainviz-ethereum/Alice",
      deploy,
    );
    expect(result).toEqual({
      deployedAddress: "0x2222222222222222222222222222222222222222",
      txHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
    });
  });

  describe("onContractDeployed callback (Issue #161/#163 integration)", () => {
    it("calls onContractDeployed with the deployed address and contractKey after a successful deployContract", async () => {
      const ops = fakeOps({
        managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
        exec: async () => ({
          exitCode: 0,
          stdout: [
            "Deployed to: 0x2222222222222222222222222222222222222222",
            "Transaction hash: 0x3333333333333333333333333333333333333333333333333333333333333333",
          ].join("\n"),
          stderr: "",
        }),
      });
      const onContractDeployed = vi.fn();
      const lifecycle = new EthereumNodeLifecycle(ops, {
        ...configWithMnemonic(),
        onContractDeployed,
      });
      const deploy: WorkbenchOperation = {
        type: "deployContract",
        contractKey: "ChainvizToken",
      };
      await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", deploy);

      expect(onContractDeployed).toHaveBeenCalledTimes(1);
      expect(onContractDeployed).toHaveBeenCalledWith(
        "0x2222222222222222222222222222222222222222",
        "ChainvizToken",
      );
    });

    it("does not call onContractDeployed when the deployed address could not be parsed from stdout", async () => {
      const ops = fakeOps({
        managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
        exec: async () => ({
          exitCode: 0,
          stdout: "some unrecognized forge output format\n",
          stderr: "",
        }),
      });
      const onContractDeployed = vi.fn();
      const lifecycle = new EthereumNodeLifecycle(ops, {
        ...configWithMnemonic(),
        onContractDeployed,
      });
      const deploy: WorkbenchOperation = {
        type: "deployContract",
        contractKey: "ChainvizToken",
      };
      await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", deploy);

      expect(onContractDeployed).not.toHaveBeenCalled();
    });

    it("does not call onContractDeployed for non-deployContract operations", async () => {
      const ops = fakeOps({
        managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
        exec: async () => ({
          exitCode: 0,
          stdout: "transactionHash         0xabc123\n",
          stderr: "",
        }),
      });
      const onContractDeployed = vi.fn();
      const lifecycle = new EthereumNodeLifecycle(ops, {
        ...configWithMnemonic(),
        onContractDeployed,
      });
      await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", transfer);

      expect(onContractDeployed).not.toHaveBeenCalled();
    });

    it("does not throw when onContractDeployed is not configured", async () => {
      const ops = fakeOps({
        managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
        exec: async () => ({
          exitCode: 0,
          stdout: [
            "Deployed to: 0x2222222222222222222222222222222222222222",
            "Transaction hash: 0x3333333333333333333333333333333333333333333333333333333333333333",
          ].join("\n"),
          stderr: "",
        }),
      });
      const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
      const deploy: WorkbenchOperation = {
        type: "deployContract",
        contractKey: "ChainvizToken",
      };
      await expect(
        lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", deploy),
      ).resolves.toEqual({
        deployedAddress: "0x2222222222222222222222222222222222222222",
        txHash:
          "0x3333333333333333333333333333333333333333333333333333333333333333",
      });
    });

    it("still returns the successful outcome and logs the error when onContractDeployed throws (Issue #161 QA follow-up)", async () => {
      // onContractDeployed の呼び出し連鎖（registerContractDeployment →
      // onContract → store.applyContract → server.broadcastDiff）のどこかで
      // 例外が投げられても、オンチェーンで既に成功しているデプロイを
      // commandResult 上で失敗として返してはならない。
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const ops = fakeOps({
        managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
        exec: async () => ({
          exitCode: 0,
          stdout: [
            "Deployed to: 0x2222222222222222222222222222222222222222",
            "Transaction hash: 0x3333333333333333333333333333333333333333333333333333333333333333",
          ].join("\n"),
          stderr: "",
        }),
      });
      const onContractDeployed = vi.fn(() => {
        throw new Error("broadcastDiff failed: socket closed");
      });
      const lifecycle = new EthereumNodeLifecycle(ops, {
        ...configWithMnemonic(),
        onContractDeployed,
      });
      const deploy: WorkbenchOperation = {
        type: "deployContract",
        contractKey: "ChainvizToken",
      };

      const result = await lifecycle.runWorkbenchOperation(
        "chainviz-ethereum/Alice",
        deploy,
      );

      expect(result).toEqual({
        deployedAddress: "0x2222222222222222222222222222222222222222",
        txHash:
          "0x3333333333333333333333333333333333333333333333333333333333333333",
      });
      expect(onContractDeployed).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("onContractDeployed callback failed"),
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });
  });

  it("throws with the stderr detail and logs it when the exec exits non-zero", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
      exec: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "Error: insufficient funds for gas * price + value",
      }),
    });
    const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
    await expect(
      lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", transfer),
    ).rejects.toThrow(/insufficient funds for gas/);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("insufficient funds for gas"),
    );
    errorSpy.mockRestore();
  });

  it("falls back to stdout, then the bare exit code, when stderr is empty", async () => {
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
      exec: async () => ({ exitCode: 2, stdout: "", stderr: "" }),
    });
    const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
    await expect(
      lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", transfer),
    ).rejects.toThrow(/exit code 2/);
  });

  it("builds the correct forge create command for deployContract", async () => {
    const mnemonic = "alpha bravo charlie";
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
    });
    const lifecycle = new EthereumNodeLifecycle(
      ops,
      configWithMnemonic(mnemonic),
    );
    const deploy: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/Counter.sol:Counter",
    };
    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", deploy);
    expect(ops.exec).toHaveBeenCalledWith("wb-cid", [
      "forge",
      "create",
      "src/Counter.sol:Counter",
      "--root",
      "/contracts",
      "--rpc-url",
      config.ethRpcUrl,
      "--mnemonic",
      mnemonic,
      "--mnemonic-index",
      "1",
      "--broadcast",
    ]);
  });

  it("appends --constructor-args as the last tokens when a deployContract carries constructorArgs", async () => {
    const mnemonic = "alpha bravo charlie";
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
    });
    const lifecycle = new EthereumNodeLifecycle(
      ops,
      configWithMnemonic(mnemonic),
    );
    const deploy: WorkbenchOperation = {
      type: "deployContract",
      contractKey: "src/ChainvizToken.sol:ChainvizToken",
      constructorArgs: ["1000000000000000000000000"],
    };
    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", deploy);
    expect(ops.exec).toHaveBeenCalledWith("wb-cid", [
      "forge",
      "create",
      "src/ChainvizToken.sol:ChainvizToken",
      "--root",
      "/contracts",
      "--rpc-url",
      config.ethRpcUrl,
      "--mnemonic",
      mnemonic,
      "--mnemonic-index",
      "1",
      "--broadcast",
      "--constructor-args",
      "1000000000000000000000000",
    ]);
  });

  it("propagates an exec rejection (e.g. the workbench container is not running)", async () => {
    // exec 自体が reject する（非ゼロ終了ではなく、コンテナ停止等で exec 作成に
    // 失敗する）ケースでも、runWorkbenchOperation は握りつぶさず伝播させる。
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
      exec: async () => {
        throw new Error("container is not running");
      },
    });
    const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
    await expect(
      lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", transfer),
    ).rejects.toThrow(/container is not running/);
  });

  it("passes a value carrying shell metacharacters through to exec as a single argument", async () => {
    // 端から端まで（コマンド組み立て → exec 呼び出し）のインジェクション回帰。
    // 危険な宛先文字列でも、exec には配列の 1 要素として渡り、シェル文字列に
    // 連結されないこと。
    const danger = "0xabc; rm -rf / #";
    let capturedCmd: string[] = [];
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
      exec: async (_id, cmd) => {
        capturedCmd = cmd;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", {
      type: "transfer",
      to: danger,
      amount: "1",
    });
    expect(capturedCmd[capturedCmd.length - 1]).toBe(danger);
    expect(capturedCmd.filter((t) => t === danger)).toHaveLength(1);
  });

  it("includes --value in order when a callContract carries an amount", async () => {
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
    });
    const lifecycle = new EthereumNodeLifecycle(ops, configWithMnemonic());
    const call: WorkbenchOperation = {
      type: "callContract",
      contractAddress: "0x0c0de",
      functionName: "deposit()",
      args: [],
      amount: "500",
    };
    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", call);
    const cmd = (ops.exec as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as string[];
    const valuePos = cmd.indexOf("--value");
    expect(valuePos).toBeGreaterThan(-1);
    expect(cmd[valuePos + 1]).toBe("500");
    // --value / 金額の後に、宛先コントラクト・関数シグネチャが続く。
    expect(cmd.slice(valuePos + 2)).toEqual(["0x0c0de", "deposit()"]);
  });

  it("builds the correct cast send command for callContract", async () => {
    const mnemonic = "alpha bravo charlie";
    const ops = fakeOps({
      managedContainers: [workbenchContainer("Alice", "wb-cid", 1)],
    });
    const lifecycle = new EthereumNodeLifecycle(
      ops,
      configWithMnemonic(mnemonic),
    );
    const call: WorkbenchOperation = {
      type: "callContract",
      contractAddress: "0x0c0de",
      functionName: "transfer(address,uint256)",
      args: ["0x0b0b", "500"],
    };
    await lifecycle.runWorkbenchOperation("chainviz-ethereum/Alice", call);
    expect(ops.exec).toHaveBeenCalledWith("wb-cid", [
      "cast",
      "send",
      "--rpc-url",
      config.ethRpcUrl,
      "--mnemonic",
      mnemonic,
      "--mnemonic-index",
      "1",
      "0x0c0de",
      "transfer(address,uint256)",
      "0x0b0b",
      "500",
    ]);
  });
});
