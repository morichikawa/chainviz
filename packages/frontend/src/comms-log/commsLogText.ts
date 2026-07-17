import { format } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import { shortHex } from "../entities/transaction.js";
import type { CommsLogEntry } from "./commsLogEntry.js";

/** `useLanguage().t` と同じ形の翻訳関数（React に依存しない、テスト容易性のため引数化）。 */
export type Translate = (key: MessageKey) => string;

export interface CommsLogEntryText {
  /** 1行目の主体（`from → to` / 単一主体 / 短縮ハッシュ）。 */
  subject: string;
  /** 2行目の内容。 */
  body: string;
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

