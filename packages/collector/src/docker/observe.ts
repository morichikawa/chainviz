// Docker API の生レスポンスをチェーン非依存な観測値へ正規化する純粋関数群。
// 副作用を持たず、ここだけを単体テストで固められるようにしている。

import type {
  ContainerProcess,
  DockerContainerSummary,
  DockerStatsResult,
  DockerTopResult,
} from "./types.js";

const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";

/** 小数第 2 位に丸める（表示・差分ノイズ抑制のため）。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** コンテナ名の先頭 "/" を除去する。 */
export function normalizeName(rawName: string | undefined): string {
  if (!rawName) return "";
  return rawName.startsWith("/") ? rawName.slice(1) : rawName;
}

/** 観測対象の表示用コンテナ名を取り出す。 */
export function extractName(summary: DockerContainerSummary): string {
  return normalizeName(summary.Names?.[0]);
}

/**
 * 再起動で変わらない安定識別子を決める。docker compose のラベル
 * （project/service）を第一候補にし、無ければコンテナ名、それも無ければ
 * コンテナ ID にフォールバックする。コンテナ ID は本来不安定なので最終手段。
 */
export function computeStableId(summary: DockerContainerSummary): string {
  const labels = summary.Labels ?? {};
  const project = labels[COMPOSE_PROJECT_LABEL];
  const service = labels[COMPOSE_SERVICE_LABEL];
  if (project && service) return `${project}/${service}`;
  const name = extractName(summary);
  if (name) return name;
  return summary.Id;
}

/** 所属ネットワークの最初の非空 IP アドレスを取り出す。 */
export function extractIp(summary: DockerContainerSummary): string {
  const networks = summary.NetworkSettings?.Networks ?? {};
  for (const net of Object.values(networks)) {
    if (net?.IPAddress) return net.IPAddress;
  }
  return "";
}

/**
 * コンテナのポート一覧を取り出す。公開ポート（PublicPort）があればそれを、
 * 無ければ内部ポート（PrivatePort）を採用し、重複を除いて昇順に並べる。
 */
export function extractPorts(summary: DockerContainerSummary): number[] {
  const ports = new Set<number>();
  for (const binding of summary.Ports ?? []) {
    ports.add(binding.PublicPort ?? binding.PrivatePort);
  }
  return [...ports].sort((a, b) => a - b);
}

/** command 文字列から実行ファイル名を取り出す（例: "/usr/bin/reth node" → "reth"）。 */
export function processName(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  const base = first.split("/").pop() ?? first;
  return base;
}

/** `/containers/{id}/top` の結果をプロセス一覧へ変換する。 */
export function parseTopProcesses(top: DockerTopResult): ContainerProcess[] {
  const titles = top.Titles ?? [];
  let cmdIndex = titles.indexOf("CMD");
  if (cmdIndex === -1) cmdIndex = titles.indexOf("COMMAND");
  if (cmdIndex === -1) cmdIndex = Math.max(0, titles.length - 1);
  return (top.Processes ?? []).map((row) => {
    const command = row[cmdIndex] ?? "";
    return { command, name: processName(command) };
  });
}

/**
 * stats から CPU 使用率（%）を計算する。Docker の標準式
 * （cpuDelta / systemDelta * onlineCpus * 100）に従う。差分が取れない・
 * 負になる場合は 0 を返す。
 */
export function computeCpuPercent(stats: DockerStatsResult): number {
  const cpu = stats.cpu_stats;
  const pre = stats.precpu_stats;
  const cpuDelta = cpu.cpu_usage.total_usage - (pre?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (cpu.system_cpu_usage ?? 0) - (pre?.system_cpu_usage ?? 0);
  if (systemDelta <= 0 || cpuDelta <= 0) return 0;
  const onlineCpus = cpu.online_cpus ?? 1;
  return round2((cpuDelta / systemDelta) * onlineCpus * 100);
}

/** stats からメモリ使用量（MB）を計算する。ページキャッシュ分は差し引く。 */
export function computeMemMB(stats: DockerStatsResult): number {
  const usage = stats.memory_stats?.usage ?? 0;
  const cache = stats.memory_stats?.stats?.cache ?? 0;
  const mem = Math.max(0, usage - cache);
  return round2(mem / (1024 * 1024));
}
