// DockerOperations を実際の dockerode インスタンスで実装する。
// dockerode への依存はこのファイルに閉じ込め、ライフサイクル操作を使う側は
// DockerOperations インターフェースだけに依存させる（dockerode-client.ts が
// 観測面で担っているのと同じ方針）。

import type Docker from "dockerode";
import type {
  ContainerSpec,
  CreatedContainer,
  DockerOperations,
  LabeledContainer,
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

/**
 * ラベルの key/value ペアから、dockerode の listContainers に渡す
 * "key=value" 形式のフィルタ配列を組み立てる。
 */
export function toLabelFilters(labels: Record<string, string>): string[] {
  return Object.entries(labels).map(([key, value]) => `${key}=${value}`);
}

/** dockerode のエラーが「コンテナが存在しない（404）」かどうか。 */
function isNoSuchContainer(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { statusCode?: number }).statusCode === 404
  );
}

/**
 * dockerode のエラーが「削除処理が既に進行中（409 conflict）」かどうか。
 * 同じコンテナに対して remove が短時間に重なった場合や、Docker 側の状態遷移と
 * 削除が競合した場合に発生する（例: "removal of container ... is already in
 * progress"）。この状態は「別の削除が最終的にコンテナを消す」ことを意味するため、
 * stopAndRemove の契約（既に削除済み/削除中でも失敗しない）では成功相当として扱う。
 */
function isRemovalInProgress(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { statusCode?: number; message?: unknown };
  if (e.statusCode !== 409) return false;
  const message = typeof e.message === "string" ? e.message : "";
  return /removal of container .* is already in progress/i.test(message);
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
        // 既に削除済み（404）なら DockerOperations の契約どおり成功扱いにする。
        if (isNoSuchContainer(err)) return;
        // 別の削除が進行中（409）でも、そのコンテナは最終的に消えるため成功相当と
        // して扱う。これは複数の removeNode/removeWorkbench や Docker 側の状態遷移が
        // 重なったときに起きる良性の競合であり、ここで例外を伝播させると本来消える
        // コンテナに対して commandResult(ok:false) を返してしまう（さらに未捕捉だと
        // プロセスを巻き込みかねない）。異常として握りつぶすのではなく、進行中である
        // ことをログに残したうえで成功扱いにする。
        if (isRemovalInProgress(err)) {
          console.warn(
            `[collector] container ${containerId} removal already in progress; treating as removed`,
          );
          return;
        }
        // それ以外の失敗は握りつぶさず、呼び出し側（CommandHandler）で扱えるよう伝播させる。
        throw err;
      }
    },

    async usedNetworkIps(networkName: string): Promise<string[]> {
      const network = docker.getNetwork(networkName);
      const info = (await network.inspect()) as NetworkInspectInfo;
      return collectNetworkIps(info);
    },

    async listContainersByLabels(
      labels: Record<string, string>,
    ): Promise<LabeledContainer[]> {
      const containers = await docker.listContainers({
        all: true,
        filters: { label: toLabelFilters(labels) },
      });
      return containers.map((c) => ({ id: c.Id, labels: c.Labels ?? {} }));
    },
  };
}
