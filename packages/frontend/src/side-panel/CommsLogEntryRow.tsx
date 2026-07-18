import type { CommsLogCategory, CommsLogEntry } from "../comms-log/commsLogEntry.js";
import { describeCommsLogEntry } from "../comms-log/commsLogText.js";
import { formatLocalTime } from "../comms-log/formatLocalTime.js";
import { networkIdColor } from "../entities/peerEdge.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { MessageKey } from "../i18n/messages.js";

const CATEGORY_LABEL_KEY: Record<CommsLogCategory, MessageKey> = {
  operation: "commsLog.category.operation",
  internal: "commsLog.category.internal",
  block: "commsLog.category.block",
  tx: "commsLog.category.tx",
  peer: "commsLog.category.peer",
  environment: "commsLog.category.environment",
};

/**
 * カテゴリチップに付ける用語解説キー（設計メモ §5.3「カテゴリチップにのみ
 * 付ける」）。1対1で対応する既存用語が無いカテゴリ（environment）は省略する
 * （`GlossaryTerm` 相当の何かを無理に作らない。CLAUDE.mdの「用語集は
 * データファイルにある既存語彙を使う」流儀どおり、無い語彙を発明しない）。
 */
const CATEGORY_GLOSSARY_KEY: Partial<Record<CommsLogCategory, string>> = {
  operation: "rpc-endpoint",
  internal: "engine-api",
  block: "block",
  tx: "transaction",
  peer: "peer",
};

/**
 * カテゴリチップの色。既存のキャンバス表現（エッジ色・状態色）をそのまま
 * 再利用し、新しい色は作らない（設計メモ §5.2）。tx だけは status ごとに
 * 色が変わる（既存の `wallet-tx-chip--*` と同じ配色）ため関数で分岐し、
 * peer だけはネットワークごとの色（`networkIdColor`）を実行時に使うため
 * ここでは扱わない（呼び出し側で inline style を組む）。
 */
function chipClassName(entry: CommsLogEntry): string {
  const base = "comms-log-entry__chip";
  if (entry.category === "tx") return `${base} ${base}--tx-${entry.status}`;
  if (entry.category === "peer") return base; // 色は inline style（networkIdColor）で当てる
  return `${base} ${base}--${entry.category}`;
}

export interface CommsLogEntryRowProps {
  entry: CommsLogEntry;
}

/**
 * 通信ログパネルの1エントリ（Issue #317設計メモ §5.1）。固定2行レイアウト:
 * 1行目 = 時刻 + カテゴリチップ + 主体、2行目 = 内容。
 */
export function CommsLogEntryRow({ entry }: CommsLogEntryRowProps) {
  const { t } = useLanguage();
  const text = describeCommsLogEntry(entry, t);
  const glossaryKey = CATEGORY_GLOSSARY_KEY[entry.category];
  const chipLabel = t(CATEGORY_LABEL_KEY[entry.category]);
  const chipStyle =
    entry.category === "peer" ? { borderColor: networkIdColor(entry.networkId), color: networkIdColor(entry.networkId) } : undefined;

  return (
    <li className="comms-log-entry" data-testid="comms-log-entry" data-category={entry.category}>
      <div className="comms-log-entry__head">
        <span className="comms-log-entry__time">{formatLocalTime(entry.timestamp)}</span>
        <span className={chipClassName(entry)} style={chipStyle} data-testid="comms-log-entry-chip">
          {glossaryKey ? <GlossaryTerm termKey={glossaryKey}>{chipLabel}</GlossaryTerm> : chipLabel}
        </span>
        <span className="comms-log-entry__subject">{text.subject}</span>
      </div>
      <div className="comms-log-entry__body">
        {entry.category === "operation" ? (
          <code className="comms-log-entry__code">
            {text.body}
            {text.operationSuffix &&
              (text.operationSuffix.tone ? (
                <span
                  className={`comms-log-entry__outcome comms-log-entry__outcome--${text.operationSuffix.tone}`}
                  aria-label={text.operationSuffix.ariaLabel}
                  data-testid="comms-log-entry-outcome"
                >
                  {text.operationSuffix.text}
                </span>
              ) : (
                text.operationSuffix.text
              ))}
          </code>
        ) : entry.category === "internal" ? (
          <code className="comms-log-entry__code">{text.body}</code>
        ) : (
          text.body
        )}
      </div>
    </li>
  );
}
