import { useLanguage } from "../i18n/LanguageProvider.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import type { InfraEntity } from "./infraNode.js";

/** クライアント種別を用語キーへ対応づける（EL/CL の用語解説に繋ぐ）。 */
export function clientGlossaryKey(clientType: string): string {
  const lower = clientType.toLowerCase();
  if (lower.includes("reth") || lower.includes("geth")) return "el-client";
  if (lower.includes("lighthouse") || lower.includes("prysm")) return "cl-client";
  return "container";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="infra-field">
      <span className="infra-field__label">{label}</span>
      <span className="infra-field__value">{value}</span>
    </div>
  );
}

/**
 * カードのホバーで出る詳細ポップオーバー。IP・ポート・プロセス・リソース
 * （CPU/メモリ）・クライアント種別などを表示する（CONCEPT.md「体験イメージ」）。
 *
 * `rpcTargetContainerName` はワークベンチの RPC 接続先が解決できた場合に
 * 「操作先ノード」欄を追加する（Issue #123 UX設計 §4-4）。解決できない場合
 * （collector 未対応・削除されたノードなど）は欄自体を出さない（§4-5）。
 */
export function InfraPopover({
  entity,
  rpcTargetContainerName,
}: {
  entity: InfraEntity;
  rpcTargetContainerName?: string;
}) {
  const { t } = useLanguage();
  const ports = entity.ports.length > 0 ? entity.ports.join(", ") : "-";
  const process =
    entity.process.name +
    (entity.process.version ? ` (${entity.process.version})` : "");

  return (
    <div className="infra-popover" role="tooltip">
      <Field label={t("field.ip")} value={entity.ip} />
      <div className="infra-field">
        <span className="infra-field__label">
          <GlossaryTerm termKey="port-mapping">{t("field.ports")}</GlossaryTerm>
        </span>
        <span className="infra-field__value">{ports}</span>
      </div>
      <Field label={t("field.process")} value={process} />
      <Field
        label={t("field.cpu")}
        value={`${entity.resources.cpuPercent.toFixed(1)} %`}
      />
      <Field
        label={t("field.memory")}
        value={`${Math.round(entity.resources.memMB)} MB`}
      />
      {entity.kind === "node" && (
        <>
          <div className="infra-field">
            <span className="infra-field__label">
              <GlossaryTerm termKey={clientGlossaryKey(entity.clientType)}>
                {t("field.client")}
              </GlossaryTerm>
            </span>
            <span className="infra-field__value">{entity.clientType}</span>
          </div>
          {entity.p2pRole === "bootnode" && (
            <div className="infra-field">
              <span className="infra-field__label">{t("field.role")}</span>
              <span className="infra-field__value">
                <GlossaryTerm termKey="bootnode">{t("role.bootnode")}</GlossaryTerm>
              </span>
            </div>
          )}
          <Field
            label={t("field.sync")}
            value={
              entity.syncStatus === "synced"
                ? t("sync.synced")
                : t("sync.syncing")
            }
          />
          <Field
            label={t("field.blockHeight")}
            value={String(entity.blockHeight)}
          />
        </>
      )}
      {entity.kind === "workbench" && (
        <>
          <Field label={t("card.workbench")} value={entity.label} />
          {rpcTargetContainerName && (
            <Field label={t("field.rpcTarget")} value={rpcTargetContainerName} />
          )}
        </>
      )}
    </div>
  );
}
