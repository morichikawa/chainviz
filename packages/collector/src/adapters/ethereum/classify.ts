// Ethereum プロファイル固有の分類ロジック。コンテナの観測値から
// 「これはノードかワークベンチか」「実行クライアントは何か」を判定する。
// reth / lighthouse / foundry といった Ethereum 固有の語彙はこのファイル
// （ChainAdapter 実装）の内側に閉じ込め、ワールドステートのスキーマには
// 漏らさない（CLAUDE.md「ChainAdapter 境界」）。

import type { ContainerObservation } from "../../docker/types.js";
import { COMPOSE_SERVICE_LABEL } from "./labels.js";

/** Ethereum の実行/合意クライアントとして認識する識別子。 */
const KNOWN_CLIENTS = ["reth", "lighthouse", "geth", "besu", "nethermind", "erigon", "prysm", "teku", "nimbus"];

/** ワークベンチ（開発ツールコンテナ）を示す識別子。 */
const WORKBENCH_TOOLS = ["foundry", "forge", "cast", "anvil"];

export interface EthereumClassification {
  kind: "node" | "workbench";
  /** node の場合のクライアント種別（例: "reth"）。 */
  clientType: string;
  /** workbench の場合の表示ラベル。 */
  label: string;
}

/**
 * haystack から needles のいずれかを「単語単位」で探し、最初に一致した
 * needle を返す。部分文字列一致を避けるため単語境界（\b）で判定する。
 * これにより "broadcast" 内の "cast" や "forged" 内の "forge" のような
 * 偶発的な部分一致で誤分類されるのを防ぐ。イメージ名やサービス名で使われる
 * 区切り文字（/ : - . 空白など）はいずれも \b 境界として扱われるため、
 * "geth-mainnet" の "geth" や "ghcr.io/.../reth:latest" の "reth" は一致する。
 */
function findWord(haystack: string, needles: string[]): string | undefined {
  return needles.find((n) => new RegExp(`\\b${n}\\b`, "i").test(haystack));
}

/** イメージ名・プロセス・compose サービス名から判定材料を集める。 */
function searchTerms(obs: ContainerObservation): string {
  const service = obs.labels[COMPOSE_SERVICE_LABEL] ?? "";
  const processNames = obs.processes.map((p) => p.name).join(" ");
  return `${obs.image} ${service} ${processNames}`;
}

/** コンテナがワークベンチかどうかを判定する。 */
function isWorkbench(obs: ContainerObservation): boolean {
  return findWord(searchTerms(obs), WORKBENCH_TOOLS) !== undefined;
}

/** ノードの実行/合意クライアント種別を判定する。不明なら "unknown"。 */
function detectClientType(obs: ContainerObservation): string {
  const matched = findWord(searchTerms(obs), KNOWN_CLIENTS);
  if (matched) return matched;
  // 既知クライアントに当たらない場合は主要プロセス名で代替する。
  const firstProcess = obs.processes[0]?.name;
  return firstProcess && firstProcess.length > 0 ? firstProcess : "unknown";
}

/** ワークベンチの表示ラベルを決める（compose サービス名優先、無ければコンテナ名）。 */
function workbenchLabel(obs: ContainerObservation): string {
  const service = obs.labels[COMPOSE_SERVICE_LABEL];
  return service && service.length > 0 ? service : obs.name;
}

/**
 * 観測コンテナを Ethereum プロファイルの語彙で分類する。判別材料が無い場合は
 * ノード扱いにフォールバックする（A 層の時点では区別できない情報があってよい）。
 */
export function classifyContainer(
  obs: ContainerObservation,
): EthereumClassification {
  if (isWorkbench(obs)) {
    return { kind: "workbench", clientType: "", label: workbenchLabel(obs) };
  }
  return { kind: "node", clientType: detectClientType(obs), label: "" };
}
