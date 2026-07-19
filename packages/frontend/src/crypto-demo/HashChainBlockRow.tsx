import type { ChangeEvent } from "react";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { shortHex } from "../entities/transaction.js";
import type { HashChainDemoBlock } from "./hashChainDemo.js";

export interface HashChainBlockRowProps {
  block: HashChainDemoBlock;
  /** このブロックの導出ハッシュ（`deriveBlockHash` の結果。呼び出し側 View
   * が connector の判定にも使うため、二重計算を避けてここへ渡す）。 */
  hash: string;
  /** このブロックが有効か（`isBlockValid` の結果）。 */
  valid: boolean;
  /** ハッシュが直前の操作で変わった直後かどうか（短いフラッシュ演出用）。 */
  flashing: boolean;
  onDataChange: (data: string) => void;
  /** 無効なブロックにのみ表示する「親ハッシュをつなぎ直す」ボタンの押下。
   * 先頭ブロック（親を持たない）では呼ばれない（`onRelink` 自体を渡さない）。 */
  onRelink?: () => void;
}

/**
 * 「ハッシュのしくみ」デモ（Issue #401）のブロック1件の表示。
 *
 * レイアウトは「ブロックに格納されている情報」枠（番号・親ハッシュ・データ）
 * と、枠の**外**・下端の「このブロックのハッシュ」（導出値）で構成する。
 * 自分のハッシュは自分の中に格納されず次のブロックの `storedParentHash` に
 * 格納される、という関係をこの配置そのもので示す（UX設計 §3 レイアウト）。
 */
export function HashChainBlockRow({
  block,
  hash,
  valid,
  flashing,
  onDataChange,
  onRelink,
}: HashChainBlockRowProps) {
  const { t } = useLanguage();

  function handleDataChange(event: ChangeEvent<HTMLInputElement>) {
    onDataChange(event.target.value);
  }

  return (
    <div
      className={
        valid ? "hash-chain-demo__block" : "hash-chain-demo__block hash-chain-demo__block--invalid"
      }
      data-testid={`hash-chain-demo-block-${block.number}`}
    >
      <div className="hash-chain-demo__stored">
        <div className="hash-chain-demo__stored-heading">{t("hashDemo.storedLabel")}</div>
        <div className="hash-chain-demo__field">
          <span className="hash-chain-demo__field-label">{t("hashDemo.field.number")}</span>
          <span className="hash-chain-demo__field-value">#{block.number}</span>
        </div>
        <div className="hash-chain-demo__field">
          <span className="hash-chain-demo__field-label">{t("hashDemo.field.parentHash")}</span>
          <span
            className="hash-chain-demo__field-value"
            title={block.storedParentHash}
            data-testid={`hash-chain-demo-parent-hash-${block.number}`}
          >
            {shortHex(block.storedParentHash)}
          </span>
        </div>
        {block.number === 1 && (
          <div className="hash-chain-demo__genesis-note">{t("hashDemo.genesisNote")}</div>
        )}
        <label className="hash-chain-demo__field hash-chain-demo__field--input">
          <span className="hash-chain-demo__field-label">{t("hashDemo.field.data")}</span>
          <input
            type="text"
            className="hash-chain-demo__data-input nodrag"
            value={block.data}
            onChange={handleDataChange}
            data-testid={`hash-chain-demo-data-${block.number}`}
          />
        </label>
      </div>
      <div className="hash-chain-demo__compute" aria-hidden="true">
        <span className="hash-chain-demo__compute-fn">f(x)</span>
        <span className="hash-chain-demo__compute-label">{t("hashDemo.compute")}</span>
      </div>
      <div className="hash-chain-demo__hash">
        <span className="hash-chain-demo__hash-label">{t("hashDemo.blockHash")}</span>
        <span
          className={
            flashing
              ? "hash-chain-demo__hash-value hash-chain-demo__hash-value--flash"
              : "hash-chain-demo__hash-value"
          }
          title={hash}
          data-testid={`hash-chain-demo-hash-${block.number}`}
        >
          {shortHex(hash)}
        </span>
      </div>
      <div
        className={
          valid
            ? "hash-chain-demo__badge hash-chain-demo__badge--valid"
            : "hash-chain-demo__badge hash-chain-demo__badge--invalid"
        }
        data-testid={`hash-chain-demo-badge-${block.number}`}
      >
        {valid ? t("hashDemo.badge.valid") : t("hashDemo.badge.invalid")}
      </div>
      {!valid && onRelink && (
        <button
          type="button"
          className="hash-chain-demo__relink nodrag"
          onClick={onRelink}
          data-testid={`hash-chain-demo-relink-${block.number}`}
        >
          {t("hashDemo.relink")}
        </button>
      )}
    </div>
  );
}
