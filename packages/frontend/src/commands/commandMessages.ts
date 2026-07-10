import type { Command, WorldStateEntity } from "@chainviz/shared";
import {
  resolveBootNodes,
  resolveRpcTargetNode,
} from "../entities/connectionTargets.js";
import { format } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";

/** ワークベンチ名の入力が空だったときに使う既定ラベル。 */
export const DEFAULT_WORKBENCH_LABEL = "workbench";

/** 追加ノードに使うチェーンプロファイル（現状 Ethereum 1種のみ）。 */
export const DEFAULT_CHAIN_PROFILE = "ethereum";

/** コマンド種別ごとの失敗時メッセージキー。 */
const ERROR_KEY: Record<Command["action"], MessageKey> = {
  addNode: "command.error.addNode",
  removeNode: "command.error.removeNode",
  addWorkbench: "command.error.addWorkbench",
  removeWorkbench: "command.error.removeWorkbench",
  runWorkbenchOperation: "command.error.runWorkbenchOperation",
};

/**
 * 入力欄のワークベンチ名を正規化する。前後空白を除き、空なら既定ラベルを返す。
 */
export function resolveWorkbenchLabel(input: string): string {
  const trimmed = input.trim();
  return trimmed === "" ? DEFAULT_WORKBENCH_LABEL : trimmed;
}

/**
 * コマンド失敗時にトーストへ出す文言を組み立てる。どの操作が失敗したかを
 * 示す定型文（i18n）に、collector から返った error 文字列があれば続けて添える。
 * pending から command が特定できなかった場合は汎用の失敗文言にフォールバック。
 */
export function describeCommandError(
  command: Command | undefined,
  error: string | undefined,
  t: (key: MessageKey) => string,
): string {
  const base = command ? t(ERROR_KEY[command.action]) : t("command.error.unknown");
  const detail = error?.trim();
  return detail ? `${base}: ${detail}` : base;
}

/**
 * commandResult 自体が返らなかった（＝collector とやり取りできなかった）
 * ケース用の失敗文言を組み立てる（Issue #235）。`describeCommandError` の
 * `error` は collector から返る生の（非i18n）文字列を想定しているのに対し、
 * こちらは理由自体をローカルで判断しているため、理由部分も `t()` で
 * 訳した文言を使う。
 */
function describeLocalCommandError(
  command: Command | undefined,
  reasonKey: MessageKey,
  t: (key: MessageKey) => string,
): string {
  const base = command ? t(ERROR_KEY[command.action]) : t("command.error.unknown");
  return `${base}: ${t(reasonKey)}`;
}

/**
 * WebSocket が未接続で、コマンドがそもそも送信できなかった場合の失敗文言
 * （Issue #235。`ChainvizClient.sendCommand` が `undefined` を返したとき用）。
 */
export function describeCommandNotConnectedError(
  command: Command,
  t: (key: MessageKey) => string,
): string {
  return describeLocalCommandError(command, "command.error.notConnected", t);
}

/**
 * ゴーストの安全網タイムアウト（`entities/ghostNode.ts` の
 * `GHOST_TIMEOUT_MS`）が発火するまで commandResult も実体到着も届かな
 * かった場合の失敗文言（Issue #235）。
 */
export function describeCommandTimeoutError(
  command: Command | undefined,
  t: (key: MessageKey) => string,
): string {
  return describeLocalCommandError(command, "command.error.timeout", t);
}

/**
 * 「+ ノードを追加」ボタンの押下前ツールチップ文言を組み立てる（Issue #123
 * UX設計 §4-1）。EL/CL 両方のブートノードを解決できた場合のみ具体的な
 * containerName を含む文言にし、片方でも解決できなければ generic な文言へ
 * フォールバックする（§4-5。半端に一方だけ埋めた文言は誤解を招くため）。
 */
export function resolveAddNodeHint(
  entities: WorldStateEntity[],
  t: (key: MessageKey) => string,
): string {
  const bootNodes = resolveBootNodes(entities);
  if (!bootNodes.execution || !bootNodes.consensus) {
    return t("action.addNode.hint.generic");
  }
  return format(t("action.addNode.hint"), {
    elBoot: bootNodes.execution.containerName,
    clBoot: bootNodes.consensus.containerName,
  });
}

/**
 * 「+ ワークベンチを追加」ボタンの押下前ツールチップ文言を組み立てる
 * （Issue #123 UX設計 §4-1）。RPC 接続先を解決できなければ generic な文言へ
 * フォールバックする（§4-5）。
 */
export function resolveAddWorkbenchHint(
  entities: WorldStateEntity[],
  t: (key: MessageKey) => string,
): string {
  const rpcTarget = resolveRpcTargetNode(entities);
  if (!rpcTarget) return t("action.addWorkbench.hint.generic");
  return format(t("action.addWorkbench.hint"), {
    rpcTarget: rpcTarget.containerName,
  });
}

/**
 * ワークベンチカードの「操作を実行…」ボタンの押下前予告ツールチップ文言を
 * 組み立てる（ARCHITECTURE.md §6.5）。RPC 接続先の containerName を解決
 * できなければ generic な文言へフォールバックする（Issue #123 §4-5と同じ
 * 流儀）。
 */
export function resolveWorkbenchOperationsHint(
  rpcTargetContainerName: string | undefined,
  t: (key: MessageKey) => string,
): string {
  if (!rpcTargetContainerName) {
    return t("action.workbenchOperations.hint.generic");
  }
  return format(t("action.workbenchOperations.hint"), {
    rpcTarget: rpcTargetContainerName,
  });
}
