import type { Command } from "@chainviz/shared";
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
