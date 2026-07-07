import { EventEmitter } from "node:events";
import type Docker from "dockerode";
import { describe, expect, it, vi } from "vitest";
import {
  collectNetworkIps,
  createDockerOperations,
  toCreateOptions,
  toLabelFilters,
} from "./dockerode-operations.js";
import type { ContainerSpec } from "./operations.js";

const baseSpec: ContainerSpec = {
  name: "chainviz-ethereum-reth3",
  image: "ghcr.io/paradigmxyz/reth:latest",
  entrypoint: ["/bin/sh", "/scripts/reth-node.sh"],
  env: { BEACON_ROLE: "peer", ENR_ADDRESS: "172.28.2.3" },
  labels: { "com.chainviz.managed": "true" },
  binds: ["chainviz-ethereum_genesis:/genesis:ro"],
  networkName: "chainviz-ethereum_chain",
  ipv4Address: "172.28.1.3",
  exposedPorts: [8545, 8551],
};

describe("toCreateOptions", () => {
  it("maps spec fields to dockerode create options", () => {
    const opts = toCreateOptions(baseSpec);
    expect(opts.name).toBe("chainviz-ethereum-reth3");
    expect(opts.Image).toBe("ghcr.io/paradigmxyz/reth:latest");
    expect(opts.Entrypoint).toEqual(["/bin/sh", "/scripts/reth-node.sh"]);
    expect(opts.Labels).toEqual({ "com.chainviz.managed": "true" });
    expect(opts.HostConfig?.Binds).toEqual([
      "chainviz-ethereum_genesis:/genesis:ro",
    ]);
    expect(opts.HostConfig?.NetworkMode).toBe("chainviz-ethereum_chain");
  });

  it("expands env as KEY=VALUE strings", () => {
    const opts = toCreateOptions(baseSpec);
    expect(opts.Env).toEqual([
      "BEACON_ROLE=peer",
      "ENR_ADDRESS=172.28.2.3",
    ]);
  });

  it("assigns the static IP under the network's endpoint config", () => {
    const opts = toCreateOptions(baseSpec);
    const endpoint =
      opts.NetworkingConfig?.EndpointsConfig?.["chainviz-ethereum_chain"];
    expect(endpoint?.IPAMConfig).toEqual({ IPv4Address: "172.28.1.3" });
  });

  it("omits IPAMConfig when no static IP is given", () => {
    const opts = toCreateOptions({ ...baseSpec, ipv4Address: undefined });
    const endpoint =
      opts.NetworkingConfig?.EndpointsConfig?.["chainviz-ethereum_chain"];
    expect(endpoint?.IPAMConfig).toBeUndefined();
  });

  it("exposes the given TCP ports", () => {
    const opts = toCreateOptions(baseSpec);
    expect(opts.ExposedPorts).toEqual({ "8545/tcp": {}, "8551/tcp": {} });
  });

  it("omits ExposedPorts and Env when not provided", () => {
    const opts = toCreateOptions({
      name: "x",
      image: "img",
      networkName: "net",
    });
    expect(opts.ExposedPorts).toBeUndefined();
    expect(opts.Env).toBeUndefined();
  });

  it("omits ExposedPorts when given an empty port array", () => {
    const opts = toCreateOptions({ ...baseSpec, exposedPorts: [] });
    expect(opts.ExposedPorts).toBeUndefined();
  });

  it("leaves Labels and Binds undefined when not provided", () => {
    const opts = toCreateOptions({
      name: "x",
      image: "img",
      networkName: "net",
    });
    expect(opts.Labels).toBeUndefined();
    expect(opts.HostConfig?.Binds).toBeUndefined();
  });

  it("always wires an endpoint entry for the target network (even without a static IP)", () => {
    const opts = toCreateOptions({
      name: "x",
      image: "img",
      networkName: "the-net",
    });
    expect(opts.HostConfig?.NetworkMode).toBe("the-net");
    expect(opts.NetworkingConfig?.EndpointsConfig?.["the-net"]).toBeDefined();
  });

  it("maps extraHosts to HostConfig.ExtraHosts", () => {
    const opts = toCreateOptions({
      ...baseSpec,
      extraHosts: ["host.docker.internal:host-gateway"],
    });
    expect(opts.HostConfig?.ExtraHosts).toEqual([
      "host.docker.internal:host-gateway",
    ]);
  });

  it("omits HostConfig.ExtraHosts when not provided", () => {
    const opts = toCreateOptions(baseSpec);
    expect(opts.HostConfig?.ExtraHosts).toBeUndefined();
  });

  it("passes through multiple extraHosts entries in order", () => {
    const opts = toCreateOptions({
      ...baseSpec,
      extraHosts: ["host.docker.internal:host-gateway", "other:10.0.0.5"],
    });
    expect(opts.HostConfig?.ExtraHosts).toEqual([
      "host.docker.internal:host-gateway",
      "other:10.0.0.5",
    ]);
  });

  it("passes an empty extraHosts array through as-is (no host-gateway synthesized)", () => {
    // 空配列は「明示的に extra_hosts なし」を意味し、undefined と実質同じ。
    // toCreateOptions は値を合成せずそのまま渡す（dockerode は空配列を無害に扱う）。
    const opts = toCreateOptions({ ...baseSpec, extraHosts: [] });
    expect(opts.HostConfig?.ExtraHosts).toEqual([]);
  });

  it("does not disturb other HostConfig fields when extraHosts is present", () => {
    // ExtraHosts の追加が既存の Binds / NetworkMode 設定に副作用を与えない。
    const opts = toCreateOptions({
      ...baseSpec,
      extraHosts: ["host.docker.internal:host-gateway"],
    });
    expect(opts.HostConfig?.Binds).toEqual([
      "chainviz-ethereum_genesis:/genesis:ro",
    ]);
    expect(opts.HostConfig?.NetworkMode).toBe("chainviz-ethereum_chain");
  });
});

describe("collectNetworkIps", () => {
  it("collects container IPs (stripped of CIDR) and the gateway", () => {
    const ips = collectNetworkIps({
      Containers: {
        abc: { IPv4Address: "172.28.1.1/16" },
        def: { IPv4Address: "172.28.2.1/16" },
        ghi: undefined,
      },
      IPAM: { Config: [{ Gateway: "172.28.0.1", Subnet: "172.28.0.0/16" }] },
    });
    expect(ips).toContain("172.28.1.1");
    expect(ips).toContain("172.28.2.1");
    expect(ips).toContain("172.28.0.1");
  });

  it("tolerates missing Containers and IPAM", () => {
    expect(collectNetworkIps({})).toEqual([]);
  });

  it("skips containers whose IPv4Address is empty or missing", () => {
    const ips = collectNetworkIps({
      Containers: {
        a: { IPv4Address: "" },
        b: {},
        c: { IPv4Address: "172.28.1.5/16" },
      },
    });
    expect(ips).toEqual(["172.28.1.5"]);
  });

  it("returns a bare IP unchanged when it has no CIDR suffix", () => {
    const ips = collectNetworkIps({
      Containers: { a: { IPv4Address: "172.28.1.7" } },
      IPAM: { Config: [{ Gateway: "172.28.0.1" }] },
    });
    expect(ips).toEqual(["172.28.1.7", "172.28.0.1"]);
  });

  it("collects gateways across multiple IPAM configs and skips those without one", () => {
    const ips = collectNetworkIps({
      IPAM: {
        Config: [
          { Gateway: "172.28.0.1/16" },
          { Subnet: "10.0.0.0/24" },
          { Gateway: "10.0.0.1" },
        ],
      },
    });
    expect(ips).toEqual(["172.28.0.1", "10.0.0.1"]);
  });
});

describe("createDockerOperations", () => {
  it("creates and starts a container, returning its id", async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const createContainer = vi
      .fn()
      .mockResolvedValue({ id: "cid-1", start });
    const docker = { createContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    const result = await ops.createAndStart(baseSpec);

    expect(result).toEqual({ id: "cid-1" });
    expect(createContainer).toHaveBeenCalledWith(toCreateOptions(baseSpec));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("stops then force-removes a container", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const getContainer = vi.fn().mockReturnValue({ stop, remove });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    await ops.stopAndRemove("cid-1");

    expect(getContainer).toHaveBeenCalledWith("cid-1");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith({ force: true });
  });

  it("still removes a container even if stop fails (already stopped)", async () => {
    const stop = vi.fn().mockRejectedValue(new Error("not running"));
    const remove = vi.fn().mockResolvedValue(undefined);
    const getContainer = vi.fn().mockReturnValue({ stop, remove });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    await expect(ops.stopAndRemove("cid-1")).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith({ force: true });
  });

  it("returns used IPs from a network inspect", async () => {
    const inspect = vi.fn().mockResolvedValue({
      Containers: { a: { IPv4Address: "172.28.1.1/16" } },
      IPAM: { Config: [{ Gateway: "172.28.0.1" }] },
    });
    const getNetwork = vi.fn().mockReturnValue({ inspect });
    const docker = { getNetwork } as unknown as Docker;

    const ops = createDockerOperations(docker);
    const ips = await ops.usedNetworkIps("chainviz-ethereum_chain");

    expect(getNetwork).toHaveBeenCalledWith("chainviz-ethereum_chain");
    expect(ips).toEqual(["172.28.1.1", "172.28.0.1"]);
  });

  it("returns an empty list when the network has no containers or gateway", async () => {
    const inspect = vi.fn().mockResolvedValue({});
    const getNetwork = vi.fn().mockReturnValue({ inspect });
    const docker = { getNetwork } as unknown as Docker;

    const ops = createDockerOperations(docker);
    await expect(ops.usedNetworkIps("net")).resolves.toEqual([]);
  });

  it("propagates a failure from network.inspect", async () => {
    const inspect = vi.fn().mockRejectedValue(new Error("no such network"));
    const getNetwork = vi.fn().mockReturnValue({ inspect });
    const docker = { getNetwork } as unknown as Docker;

    const ops = createDockerOperations(docker);
    await expect(ops.usedNetworkIps("net")).rejects.toThrow(/no such network/);
  });

  it("does not swallow a failure from container.remove", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockRejectedValue(new Error("remove failed"));
    const getContainer = vi.fn().mockReturnValue({ stop, remove });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    await expect(ops.stopAndRemove("cid-1")).rejects.toThrow(/remove failed/);
  });

  it("treats an already-removed container (404 on remove) as success", async () => {
    const stop = vi.fn().mockRejectedValue(new Error("no such container"));
    const notFound = Object.assign(new Error("no such container"), {
      statusCode: 404,
    });
    const remove = vi.fn().mockRejectedValue(notFound);
    const getContainer = vi.fn().mockReturnValue({ stop, remove });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    // DockerOperations の契約（既に停止・削除済みでも失敗しない）を満たす。
    await expect(ops.stopAndRemove("cid-gone")).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith({ force: true });
  });

  it("treats a concurrent removal (409 already in progress) as success", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const stop = vi.fn().mockResolvedValue(undefined);
      // dockerode が返す 409 の実メッセージ形（repro で確認した文言）を模す。
      const conflict = Object.assign(
        new Error(
          "(HTTP code 409) unexpected - removal of container abc123 is already in progress ",
        ),
        { statusCode: 409 },
      );
      const remove = vi.fn().mockRejectedValue(conflict);
      const getContainer = vi.fn().mockReturnValue({ stop, remove });
      const docker = { getContainer } as unknown as Docker;

      const ops = createDockerOperations(docker);
      // 別の削除が進行中でも、そのコンテナは最終的に消えるため成功相当に扱う。
      await expect(ops.stopAndRemove("abc123")).resolves.toBeUndefined();
      expect(remove).toHaveBeenCalledWith({ force: true });
      // 異常として握りつぶすのではなく、進行中である旨をログに残す。
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not treat an unrelated 409 conflict as success", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    // 409 でもメッセージが「削除進行中」でないものは良性の競合ではないため伝播させる。
    const conflict = Object.assign(
      new Error("(HTTP code 409) unexpected - some other conflict"),
      { statusCode: 409 },
    );
    const remove = vi.fn().mockRejectedValue(conflict);
    const getContainer = vi.fn().mockReturnValue({ stop, remove });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    await expect(ops.stopAndRemove("cid-1")).rejects.toThrow(
      /some other conflict/,
    );
  });

  it("lists containers matching all given labels, including stopped ones", async () => {
    const listContainers = vi.fn().mockResolvedValue([
      { Id: "cid-1", Labels: { "com.chainviz.managed": "true", "com.chainviz.role": "execution" } },
      { Id: "cid-2", Labels: { "com.chainviz.managed": "true", "com.chainviz.role": "consensus" } },
    ]);
    const docker = { listContainers } as unknown as Docker;

    const ops = createDockerOperations(docker);
    const result = await ops.listContainersByLabels({
      "com.chainviz.managed": "true",
    });

    expect(listContainers).toHaveBeenCalledWith({
      all: true,
      filters: { label: ["com.chainviz.managed=true"] },
    });
    expect(result).toEqual([
      {
        id: "cid-1",
        labels: { "com.chainviz.managed": "true", "com.chainviz.role": "execution" },
      },
      {
        id: "cid-2",
        labels: { "com.chainviz.managed": "true", "com.chainviz.role": "consensus" },
      },
    ]);
  });

  it("defaults to an empty labels object when a container has none", async () => {
    const listContainers = vi.fn().mockResolvedValue([{ Id: "cid-1" }]);
    const docker = { listContainers } as unknown as Docker;

    const ops = createDockerOperations(docker);
    const result = await ops.listContainersByLabels({ foo: "bar" });

    expect(result).toEqual([{ id: "cid-1", labels: {} }]);
  });
});

describe("createDockerOperations exec", () => {
  /**
   * dockerode の exec.start() が返す多重化ストリームと、それを分離する
   * exec.modem.demuxStream を模す。実際の demuxStream は Docker のフレーム
   * ヘッダをパースして stdout/stderr に振り分けるが、ここではその内部実装は
   * 対象外（dockerode 自体のテストではない）なので、渡された stdout/stderr の
   * Writable に直接書き込み、その後ソースストリーム側で "end" を発火して
   * 呼び出し元の待受（stream.on("end", ...)）を解決させる。
   */
  function fakeExecObject(opts: {
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    streamError?: Error;
  }): { exec: ReturnType<typeof vi.fn>; execObject: unknown } {
    const streamSource = new EventEmitter();
    const start = vi.fn().mockResolvedValue(streamSource);
    const exitCode = opts.exitCode === undefined ? 0 : opts.exitCode;
    const inspect = vi.fn().mockResolvedValue({ ExitCode: exitCode });
    const demuxStream = vi.fn(
      (
        _src: unknown,
        stdout: NodeJS.WritableStream,
        stderr: NodeJS.WritableStream,
      ) => {
        if (opts.stdout) stdout.write(Buffer.from(opts.stdout));
        if (opts.stderr) stderr.write(Buffer.from(opts.stderr));
        process.nextTick(() => {
          if (opts.streamError) streamSource.emit("error", opts.streamError);
          else streamSource.emit("end");
        });
      },
    );
    const execObject = { start, inspect, modem: { demuxStream } };
    const exec = vi.fn().mockResolvedValue(execObject);
    return { exec, execObject };
  }

  it("execs a command in a running container and returns stdout/stderr/exitCode", async () => {
    const { exec } = fakeExecObject({
      stdout: "transactionHash   0xabc123\n",
      exitCode: 0,
    });
    const getContainer = vi.fn().mockReturnValue({ exec });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    const result = await ops.exec("cid-1", ["cast", "send", "0xabc"]);

    expect(getContainer).toHaveBeenCalledWith("cid-1");
    expect(result).toEqual({
      exitCode: 0,
      stdout: "transactionHash   0xabc123\n",
      stderr: "",
    });
  });

  it("passes the command as an array (Cmd), never a concatenated shell string", async () => {
    // コマンドインジェクション防止の核心: 引数はトークンごとの配列のまま
    // dockerode の Cmd へ渡す（呼び出し側が文字列連結して渡さないことの回帰）。
    const { exec } = fakeExecObject({});
    const getContainer = vi.fn().mockReturnValue({ exec });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    const suspicious = "0xabc; rm -rf /";
    await ops.exec("cid-1", ["cast", "send", suspicious]);

    expect(exec).toHaveBeenCalledWith({
      Cmd: ["cast", "send", suspicious],
      AttachStdout: true,
      AttachStderr: true,
    });
    // 1つの配列要素として渡っており、シェル文字列に結合されていないこと。
    const call = exec.mock.calls[0]?.[0] as { Cmd: string[] };
    expect(call.Cmd).toHaveLength(3);
    expect(call.Cmd[2]).toBe(suspicious);
  });

  it("captures stderr separately from stdout", async () => {
    const { exec } = fakeExecObject({
      stdout: "",
      stderr: "Error: insufficient funds for gas * price + value\n",
      exitCode: 1,
    });
    const getContainer = vi.fn().mockReturnValue({ exec });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    const result = await ops.exec("cid-1", ["cast", "send"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "Error: insufficient funds for gas * price + value\n",
    );
    expect(result.stdout).toBe("");
  });

  it("captures stdout and stderr together on a non-zero exit (both demux branches)", async () => {
    // 標準出力・標準エラーの両方に出力があるケース。demux した 2 本の
    // PassThrough をどちらも取りこぼさず、終了コードと併せて返すこと。
    const { exec } = fakeExecObject({
      stdout: "partial progress...\n",
      stderr: "Error: reverted\n",
      exitCode: 1,
    });
    const getContainer = vi.fn().mockReturnValue({ exec });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    const result = await ops.exec("cid-1", ["forge", "create"]);
    expect(result).toEqual({
      exitCode: 1,
      stdout: "partial progress...\n",
      stderr: "Error: reverted\n",
    });
  });

  it("reports a non-zero exit code without throwing", async () => {
    const { exec } = fakeExecObject({ exitCode: 127 });
    const getContainer = vi.fn().mockReturnValue({ exec });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    const result = await ops.exec("cid-1", ["forge", "create"]);
    expect(result.exitCode).toBe(127);
  });

  it("falls back to exitCode -1 when the inspect result has a null ExitCode", async () => {
    const { exec } = fakeExecObject({ exitCode: null });
    const getContainer = vi.fn().mockReturnValue({ exec });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    const result = await ops.exec("cid-1", ["cast", "send"]);
    expect(result.exitCode).toBe(-1);
  });

  it("propagates a stream error instead of resolving with partial output", async () => {
    const { exec } = fakeExecObject({ streamError: new Error("stream broke") });
    const getContainer = vi.fn().mockReturnValue({ exec });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    await expect(ops.exec("cid-1", ["cast", "send"])).rejects.toThrow(
      /stream broke/,
    );
  });

  it("propagates a failure creating the exec (e.g. container not running)", async () => {
    const exec = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("container is not running"), {
          statusCode: 409,
        }),
      );
    const getContainer = vi.fn().mockReturnValue({ exec });
    const docker = { getContainer } as unknown as Docker;

    const ops = createDockerOperations(docker);
    await expect(ops.exec("cid-1", ["cast", "send"])).rejects.toThrow(
      /container is not running/,
    );
  });
});

describe("toLabelFilters", () => {
  it("converts a labels object into key=value filter strings", () => {
    expect(
      toLabelFilters({ "com.chainviz.managed": "true", "com.chainviz.role": "workbench" }),
    ).toEqual([
      "com.chainviz.managed=true",
      "com.chainviz.role=workbench",
    ]);
  });

  it("returns an empty array for an empty labels object", () => {
    expect(toLabelFilters({})).toEqual([]);
  });
});
