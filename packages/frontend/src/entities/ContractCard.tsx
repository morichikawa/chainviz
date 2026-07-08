import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useState } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { ContractPopover } from "./ContractPopover.js";
import type { ContractFlowNode } from "./contractNode.js";
import { shortHex } from "./transaction.js";

/**
 * C層拡張のコントラクトカード（ARCHITECTURE.md §6.3）。ウォレットカードと
 * 同型の骨格（ヘッダ・名前・サブタイトル）を持つが、チェーン側の状態のため
 * 削除ボタンは置かない（Issue #103 の「削除できないものに削除 UI を出さない」
 * 流儀）。
 *
 * カタログで特定できない（`name` 省略）コントラクトは「未知のコントラクト」
 * として名前を出し、カード枠を破線 + muted 色にして既知カードと区別する
 * （§6.4）。「全ノードで実行」ピルはホバーで EVM の用語解説を出し、確定した
 * 呼び出しが全ノードへ同時にブロック伝播として見えるタイミングの一致（§6.6、
 * Issue #166 で実装）と合わせて「特定ノードではない」ことを伝える。
 */
export function ContractCard({ data }: NodeProps<ContractFlowNode>) {
  const { entity, isNew } = data;
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(false);

  const isUncataloged = entity.name === undefined;
  const name = entity.name ?? t("contract.unknown");

  const className = [
    "infra-card",
    "infra-card--contract",
    isUncataloged ? "infra-card--contract-unknown" : "",
    isNew ? "infra-card--new" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`contract-card-${entity.address}`}
    >
      {/* デプロイエッジ（ウォレット → コントラクト）の受け口。コントラクトへ
          張られるエッジはこの1種類のみ（§6.3「ノードへのエッジは張らない」）。
          source ハンドルは他のカード（InfraNodeCard/WalletCard）と同様、
          現状使わなくても骨格として持たせておく。 */}
      <Handle
        type="target"
        position={Position.Left}
        className="infra-card__handle"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="infra-card__handle"
        isConnectable={false}
      />
      <div className="infra-card__header">
        <span className="infra-card__kind">
          <GlossaryTerm termKey="contract">{t("card.contract")}</GlossaryTerm>
        </span>
        <span className="contract-card__badges">
          {isUncataloged && (
            <span
              className="contract-card__badge--uncataloged"
              data-testid={`contract-card-uncataloged-${entity.address}`}
            >
              {t("contract.badge.uncataloged")}
            </span>
          )}
          <span
            className="contract-card__badge--everynode"
            data-testid={`contract-card-everynode-${entity.address}`}
          >
            <GlossaryTerm termKey="evm">{t("contract.badge.everyNode")}</GlossaryTerm>
          </span>
        </span>
      </div>
      <div className="infra-card__name">{name}</div>
      <div className="infra-card__subtitle">
        {shortHex(entity.address)}
        {entity.token && (
          <>
            {" · "}
            <GlossaryTerm termKey="token">{t("field.token")}</GlossaryTerm>{" "}
            {entity.token.symbol}
          </>
        )}
      </div>
      {hovered && <ContractPopover entity={entity} />}
    </div>
  );
}
