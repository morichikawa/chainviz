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
