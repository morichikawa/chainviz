import type Docker from "dockerode";
import { describe, expect, it, vi } from "vitest";
import {
  collectNetworkIps,
  createDockerOperations,
  toCreateOptions,
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
});
