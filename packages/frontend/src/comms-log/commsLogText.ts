import { format } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import { shortHex } from "../entities/transaction.js";
import type { CommsLogEntry, CommsLogOperationEntry } from "./commsLogEntry.js";

/** `useLanguage().t` と同じ形の翻訳関数（React に依存しない、テスト容易性のため引数化）。 */
export type Translate = (key: MessageKey) => string;

export interface CommsLogEntryText {
  /** 1行目の主体（`from → to` / 単一主体 / 短縮ハッシュ）。 */
  subject: string;
  /** 2行目の内容。 */
  body: string;
  /**
   * 操作（RPC）エントリのみ: 2行目に `body` へ続けて表示する成否・所要時間
   * の追加テキスト（設計メモ §3.4）。`outcome`/`durationMs` がどちらも無い
   * 場合は undefined（従来どおり `body` のみ表示）。
   *
   * `tone`/`ariaLabel` は `outcome` が観測できた場合のみ入る（durationMs単独
   * の場合は色分けもスクリーンリーダー向けの言語化も不要。可視テキストの
   * 数値がそのまま読み上げられるため）。色分けの実装は `CommsLogEntryRow`
   * 側（既存CSS変数の再利用のみ。新色は作らない）。
   */
  operationSuffix?: {
    /** `body` の直後に連結して表示するテキスト（例: " · 12ms" / " · ✓" / " · ✓ 12ms"）。 */
    text: string;
    tone?: "ok" | "error";
    /** tone がある場合のみ、成否+所要時間をスクリーンリーダー向けに言語化したテキスト。 */
    ariaLabel?: string;
  };
}

/**
 * `CommsLogEntry` を1エントリぶんの表示テキスト（設計メモ §5.1）へ変換する
 * 純関数。React に依存しない（`t` を引数で受け取る）ため単体テストしやすい。
 * 表示名の解決（containerName/label 等）は導出時（`deriveCommsLogEntries`）
 * 済みで、ここでは i18n の定型文への当てはめだけを行う。
 */
export function describeCommsLogEntry(entry: CommsLogEntry, t: Translate): CommsLogEntryText {
  switch (entry.category) {
    case "operation":
      return {
        subject: `${entry.workbenchLabel} → ${entry.nodeLabel}`,
        body: entry.method,
        operationSuffix: describeOperationSuffix(entry, t),
      };

    case "internal":
      return {
        subject: `${entry.fromLabel} → ${entry.toLabel}`,
        body: entry.calls
          .map((call) => {
            const base = format(t("commsLog.internal.call"), {
              method: call.method,
              count: String(call.count),
            });
            const latency =
              call.latencyMs !== undefined
                ? format(t("commsLog.internal.latency"), { ms: String(call.latencyMs) })
                : "";
            return `${base}${latency}`;
          })
          .join(", "),
      };

    case "block": {
      const seconds = (entry.relativeDelayMs / 1000).toFixed(2);
      return {
        subject: entry.nodeLabel,
        body: entry.isOrigin
          ? format(t("commsLog.block.receivedFirst"), { number: String(entry.blockNumber) })
          : format(t("commsLog.block.received"), { number: String(entry.blockNumber) }) +
            format(t("commsLog.block.offset"), { seconds }),
      };
    }

    case "tx": {
      const subject = shortHex(entry.hash);
      if (entry.status === "pending") return { subject, body: t("commsLog.tx.pending") };
      if (entry.status === "included") {
        return {
          subject,
          body:
            entry.blockNumber !== undefined
              ? format(t("commsLog.tx.included"), { number: String(entry.blockNumber) })
              : t("commsLog.tx.includedUnknownBlock"),
        };
      }
      return {
        subject,
        body:
          entry.blockNumber !== undefined
            ? format(t("commsLog.tx.failed"), { number: String(entry.blockNumber) })
            : t("commsLog.tx.failedUnknownBlock"),
      };
    }

    case "peer":
      return {
        subject: `${entry.fromLabel} ⇄ ${entry.toLabel}`,
        body:
          entry.change === "connected"
            ? t("commsLog.peer.connected")
            : t("commsLog.peer.disconnected"),
      };

    case "environment":
      return describeEnvironmentEntry(entry, t);
  }
}

/**
 * 操作（RPC）エントリの成否・所要時間表示（設計メモ §3.4）を組み立てる。
 * `outcome`/`durationMs` は独立に欠落しうるため、4通りの組み合わせを扱う:
 *
 * - どちらも無い: undefined（`body` はメソッド名のみ、従来どおり）
 * - `durationMs` のみ: 内部APIエントリの `commsLog.internal.latency`
 *   （" · 12ms"）と同じ表記。色分け不要（可視テキストがそのまま読み上げ
 *   られるため `tone`/`ariaLabel` は付けない）
 * - `outcome` のみ: アイコン（✓/✕）のみを追加し、色分け + aria-label で
 *   言語化する
 * - 両方: アイコン + 所要時間をまとめて1つの色分け対象にし、aria-label にも
 *   両方の情報を含める（アイコンの後ろに数値だけを裸で置くと、aria-label
 *   を持つ要素の子テキストはスクリーンリーダーに読まれない＝所要時間が
 *   欠落するため、アイコンと所要時間をまとめて言語化する）
 */
function describeOperationSuffix(
  entry: Pick<CommsLogOperationEntry, "outcome" | "durationMs">,
  t: Translate,
): CommsLogEntryText["operationSuffix"] {
  if (entry.outcome === undefined) {
    if (entry.durationMs === undefined) return undefined;
    return { text: format(t("commsLog.operation.duration"), { ms: String(entry.durationMs) }) };
  }

  const icon = entry.outcome === "ok" ? "✓" : "✕";
  if (entry.durationMs === undefined) {
    return {
      text: ` · ${icon}`,
      tone: entry.outcome,
      ariaLabel: t(
        entry.outcome === "ok" ? "commsLog.operation.outcomeOk" : "commsLog.operation.outcomeError",
      ),
    };
  }

  return {
    text: ` · ${icon} ${entry.durationMs}ms`,
    tone: entry.outcome,
    ariaLabel: format(
      t(
        entry.outcome === "ok"
          ? "commsLog.operation.outcomeOkDuration"
          : "commsLog.operation.outcomeErrorDuration",
      ),
      { ms: String(entry.durationMs) },
    ),
  };
}

function describeEnvironmentEntry(
  entry: Extract<CommsLogEntry, { category: "environment" }>,
  t: Translate,
): CommsLogEntryText {
  switch (entry.change) {
    case "nodeAdded":
      return { subject: entry.subjectLabel ?? "", body: t("commsLog.environment.nodeAdded") };
    case "nodeRemoved":
      return { subject: entry.subjectLabel ?? "", body: t("commsLog.environment.nodeRemoved") };
    case "workbenchAdded":
      return {
        subject: entry.subjectLabel ?? "",
        body: t("commsLog.environment.workbenchAdded"),
      };
    case "workbenchRemoved":
      return {
        subject: entry.subjectLabel ?? "",
        body: t("commsLog.environment.workbenchRemoved"),
      };
    case "contractDeployed":
      return {
        subject: entry.subjectLabel ?? t("contract.unknown"),
        body: t("commsLog.environment.contractDeployed"),
      };
    case "contractRemoved":
      return {
        subject: entry.subjectLabel ?? t("contract.unknown"),
        body: t("commsLog.environment.contractRemoved"),
      };
    case "collectorDisconnected":
      return {
        subject: t("commsLog.environment.collectorSubject"),
        body: t("commsLog.environment.collectorDisconnected"),
      };
    case "collectorReconnected":
      return {
        subject: t("commsLog.environment.collectorSubject"),
        body: t("commsLog.environment.collectorReconnected"),
      };
  }
}

