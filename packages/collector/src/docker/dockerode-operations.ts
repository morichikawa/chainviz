// DockerOperations を実際の dockerode インスタンスで実装する。
// dockerode への依存はこのファイルに閉じ込め、ライフサイクル操作を使う側は
// DockerOperations インターフェースだけに依存させる（dockerode-client.ts が
// 観測面で担っているのと同じ方針）。

import type Docker from "dockerode";
import type {
  ContainerSpec,
  CreatedContainer,
  DockerOperations,
} from "./operations.js";

/** dockerode の network.inspect() が返す形のうち、参照する部分だけ。 */
interface NetworkInspectInfo {
  Containers?: Record<string, { IPv4Address?: string } | undefined>;
  IPAM?: { Config?: Array<{ Gateway?: string; Subnet?: string }> };
}

/**
 * ContainerSpec を dockerode の createContainer 引数へ変換する。
 * 固定 IP は NetworkingConfig.EndpointsConfig[network].IPAMConfig で指定し、
 * NetworkMode で同じネットワークへ接続する（作成時に静的 IP を割り当てる標準手順）。
 */
export function toCreateOptions(
  spec: ContainerSpec,
): Docker.ContainerCreateOptions {
  const exposedPorts: Record<string, Record<string, never>> = {};
  for (const port of spec.exposedPorts ?? []) {
    exposedPorts[`${port}/tcp`] = {};
  }

  const endpointConfig: { IPAMConfig?: { IPv4Address: string } } = {};
  if (spec.ipv4Address) {
    endpointConfig.IPAMConfig = { IPv4Address: spec.ipv4Address };
  }

  const env = spec.env
    ? Object.entries(spec.env).map(([key, value]) => `${key}=${value}`)
    : undefined;

  return {
    name: spec.name,
    Image: spec.image,
    Entrypoint: spec.entrypoint,
    Cmd: spec.cmd,
    Env: env,
    Labels: spec.labels,
    ExposedPorts:
      Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
    HostConfig: {
      Binds: spec.binds,
      NetworkMode: spec.networkName,
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [spec.networkName]: endpointConfig,
      },
    },
  };
}

/** network.inspect() の結果から、使用中の IPv4 アドレス（gateway 含む）を集める。 */
export function collectNetworkIps(info: NetworkInspectInfo): string[] {
  const ips: string[] = [];
  for (const container of Object.values(info.Containers ?? {})) {
    const addr = container?.IPv4Address;
    if (addr) ips.push(stripCidr(addr));
  }
  for (const config of info.IPAM?.Config ?? []) {
    if (config.Gateway) ips.push(stripCidr(config.Gateway));
  }
  return ips;
}

/** "172.28.1.1/16" のような CIDR 付き表記からアドレス部分だけを取り出す。 */
function stripCidr(address: string): string {
  return address.split("/")[0] ?? address;
}

/** dockerode のエラーが「コンテナが存在しない（404）」かどうか。 */
function isNoSuchContainer(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { statusCode?: number }).statusCode === 404
  );
}

/** dockerode の Docker を DockerOperations として使えるようラップする。 */
export function createDockerOperations(docker: Docker): DockerOperations {
  return {
    async createAndStart(spec: ContainerSpec): Promise<CreatedContainer> {
      const container = await docker.createContainer(toCreateOptions(spec));
      await container.start();
      return { id: container.id };
    },

    async stopAndRemove(containerId: string): Promise<void> {
      const container = docker.getContainer(containerId);
      try {
        await container.stop();
      } catch {
        // 既に停止している / 存在しない場合は無視して削除へ進む。
      }
      try {
        await container.remove({ force: true });
      } catch (err) {
        // 既に削除済み（404）なら DockerOperations の契約どおり成功扱いに
        // する。それ以外の失敗は呼び出し側で扱えるよう伝播させる。
        if (isNoSuchContainer(err)) return;
        throw err;
      }
    },

    async usedNetworkIps(networkName: string): Promise<string[]> {
      const network = docker.getNetwork(networkName);
      const info = (await network.inspect()) as NetworkInspectInfo;
      return collectNetworkIps(info);
    },
  };
}
