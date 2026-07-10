import { describeNodeRole, nodeShowsSyncState } from "../chain-profiles/ethereum/nodeRoles.js";
import { format, pickLocale } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { InfraPopoverSyncStages } from "./InfraPopoverSyncStages.js";
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
 * ラベルには `rpc-endpoint` の用語解説を張る（Issue #215。操作先エッジ
 * 自体のポップオーバーは `EdgeLabelRenderer` が `pointerEvents: "none"` の
 * ため用語ホバーが実質できず、この欄に置くのが唯一の到達点になる）。
 *
 * `drivesNodeContainerName` は node（CL 側）が `drivesNodeId` を解決できた
 * 場合に「駆動する実行ノード」欄を追加する（ARCHITECTURE.md §7.6.3。
 * Issue #188）。逆方向は `drivenByContainerName`（EL 側が「駆動元（合意
 * ノード）」欄を出す。Issue #215 で §7.6.3 の「逆方向の行は追加しない」
 * 決定を更新した）。
 *
 * `maxElBlockHeight` はキャンバス上の全 EL ノードの blockHeight 最大値
 * （同期ステージのミニバーの分母。ARCHITECTURE.md §7.6.5。Issue #189）。
 * `entity.internals.syncStages` がある node にのみ「同期ステージ」セクションを、
 * `entity.internals.mempool` がある node にのみ「txpool」行を追加する
 * （どちらも省略時はセクション/行ごと出さない既存の流儀を踏襲）。
 *
 * node には `nodeRole` が解釈できれば「役割」行（`field.role` を再利用。
 * 値に `GlossaryTerm termKey={descriptor.glossaryKey}`）をクライアント行の
 * 直後に出す（Issue #215）。既存の bootnode 行は P2P 上の役割という別軸
 * なので統合せず、ラベルを `field.role` → `field.p2pRole`（P2P での役割）
 * に変更して混同を防ぐ。`nodeRole` の `showsSyncState` が false（現状
 * validator のみ）のときは「同期状態」「ブロック高」の2行を出さない
 * （バリデーターはチェーンを同期する係ではなく、値ゼロを出し続けると
 * 「壊れている」誤解を招くため）。
 */
export function InfraPopover({
  entity,
  rpcTargetContainerName,
  drivesNodeContainerName,
  drivenByContainerName,
  maxElBlockHeight,
}: {
  entity: InfraEntity;
  rpcTargetContainerName?: string;
  drivesNodeContainerName?: string;
  drivenByContainerName?: string;
  maxElBlockHeight?: number;
}) {
  const { t, lang } = useLanguage();
  const ports = entity.ports.length > 0 ? entity.ports.join(", ") : "-";
  const process =
    entity.process.name +
    (entity.process.version ? ` (${entity.process.version})` : "");
  const nodeRoleDescriptor =
    entity.kind === "node" ? describeNodeRole(entity.nodeRole) : undefined;
  const showsSyncState =
    entity.kind === "node" ? nodeShowsSyncState(entity.nodeRole) : true;

  return (
    <div
      className="infra-popover"
      role="tooltip"
      data-testid={`infra-popover-${entity.id}`}
    >
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
          {nodeRoleDescriptor && (
            <div className="infra-field">
              <span className="infra-field__label">{t("field.role")}</span>
              <span className="infra-field__value">
                <GlossaryTerm termKey={nodeRoleDescriptor.glossaryKey}>
                  {pickLocale(nodeRoleDescriptor.label, lang)}
                </GlossaryTerm>
              </span>
            </div>
          )}
          {entity.p2pRole === "bootnode" && (
            <div className="infra-field">
              <span className="infra-field__label">{t("field.p2pRole")}</span>
              <span className="infra-field__value">
                <GlossaryTerm termKey="bootnode">{t("role.bootnode")}</GlossaryTerm>
              </span>
            </div>
          )}
          {showsSyncState && (
            <>
              <Field
                label={t("field.sync")}
                value={
                  entity.syncStatus === "synced"
                    ? t("sync.synced")
                    : t("sync.syncing")
                }
              />
              <div className="infra-field">
                <span className="infra-field__label">
                  <GlossaryTerm termKey="block">{t("field.blockHeight")}</GlossaryTerm>
                </span>
                <span className="infra-field__value">
                  {String(entity.blockHeight)}
                </span>
              </div>
            </>
          )}
          {drivesNodeContainerName && (
            <div className="infra-field">
              <span className="infra-field__label">
                <GlossaryTerm termKey="engine-api">
                  {t("field.drivesNode")}
                </GlossaryTerm>
              </span>
              <span className="infra-field__value">{drivesNodeContainerName}</span>
            </div>
          )}
          {drivenByContainerName && (
            <div className="infra-field">
              <span className="infra-field__label">
                <GlossaryTerm termKey="engine-api">
                  {t("field.drivenBy")}
                </GlossaryTerm>
              </span>
              <span className="infra-field__value">{drivenByContainerName}</span>
            </div>
          )}
          {entity.internals?.syncStages && entity.internals.syncStages.length > 0 && (
            <InfraPopoverSyncStages
              stages={entity.internals.syncStages}
              targetHeight={maxElBlockHeight ?? 0}
            />
          )}
          {entity.internals?.mempool && (
            <div className="infra-field">
              <span className="infra-field__label">
                <GlossaryTerm termKey="txpool">{t("field.txpool")}</GlossaryTerm>
              </span>
              <span className="infra-field__value">
                {format(t("txpool.value"), {
                  pending: String(entity.internals.mempool.pending),
                  queued: String(entity.internals.mempool.queued),
                })}
              </span>
            </div>
          )}
        </>
      )}
      {entity.kind === "workbench" && (
        <>
          <Field label={t("card.workbench")} value={entity.label} />
          {rpcTargetContainerName && (
            <div className="infra-field">
              <span className="infra-field__label">
                <GlossaryTerm termKey="rpc-endpoint">
                  {t("field.rpcTarget")}
                </GlossaryTerm>
              </span>
              <span className="infra-field__value">{rpcTargetContainerName}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
