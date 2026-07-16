import type { ContractEntity } from "@chainviz/shared";
import type { ReactNode, RefObject } from "react";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { withTermAnchor } from "../glossary/withTermAnchor.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { PopoverPortal } from "../interaction/PopoverPortal.js";
import { LayerBadge } from "./LayerBadge.js";
import { shortHex } from "./transaction.js";

function Field({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="infra-field">
      <span className="infra-field__label">{label}</span>
      <span className="infra-field__value">{value}</span>
    </div>
  );
}

/**
 * 未知コントラクトの説明文中の「ABI」という語だけに用語解説アンカーを
 * 付ける（ARCHITECTURE.md §6.9: abi の主なアンカーの1つが「未知コントラクト
 * の説明文」）。実体は `withTermAnchor`（Issue #321 で汎用化。コントラクト
 * ソースビューの「ソース手元に無し」説明文でも同じ流儀を使う）。
 */
function withAbiAnchor(text: string): ReactNode {
  return withTermAnchor(text, "ABI", "abi");
}

/**
 * コントラクトカードのホバーで出る詳細ポップオーバー（ARCHITECTURE.md
 * §6.3「ポップオーバー」）。冒頭に「特定ノードではなく全ノードで実行される」
 * 誤解防止の説明文を置き、観測できなかったフィールド（デプロイした人・作成
 * tx・トークン）は行ごと省略する（WalletPopover と同じ既存の流儀）。
 *
 * カタログ未登録（`name` 省略）の場合は説明文を差し替え、ABI を復号できない
 * ことを伝える（§6.4）。
 *
 * `anchorRef` はこのポップオーバーを開いたカード本体への ref（Issue #245）。
 * React Flow のノードはそれぞれ独立したスタッキングコンテキストを持つため、
 * `PopoverPortal` でこのカードを基準位置に body 直下へ描画し、隣接カードの
 * 下に隠れないようにする。
 */
export function ContractPopover({
  anchorRef,
  entity,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  entity: ContractEntity;
}) {
  const { t } = useLanguage();
  const isUncataloged = entity.name === undefined;

  return (
    <PopoverPortal
      anchorRef={anchorRef}
      gapPx={8}
      className="infra-popover contract-popover"
      role="tooltip"
    >
      <div className="infra-popover__heading">
        <LayerBadge layer="c" />
      </div>
      <p className="contract-popover__description">
        {isUncataloged
          ? withAbiAnchor(t("contract.popover.unknownDescription"))
          : t("contract.popover.description")}
      </p>
      <Field label={t("field.address")} value={shortHex(entity.address, 10, 6)} />
      {entity.deployerAddress && (
        <div className="infra-field">
          <span className="infra-field__label">
            <GlossaryTerm termKey="deploy">{t("field.deployer")}</GlossaryTerm>
          </span>
          <span className="infra-field__value">
            {shortHex(entity.deployerAddress)}
          </span>
        </div>
      )}
      {entity.createdByTxHash && (
        <Field
          label={t("field.createdByTx")}
          value={shortHex(entity.createdByTxHash)}
        />
      )}
      {entity.token && (
        <div className="infra-field">
          <span className="infra-field__label">
            <GlossaryTerm termKey="token">{t("field.token")}</GlossaryTerm>
          </span>
          <span className="infra-field__value">
            {entity.token.symbol} / decimals {entity.token.decimals}
          </span>
        </div>
      )}
    </PopoverPortal>
  );
}
