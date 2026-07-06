import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { describeNetwork, networkIdColor } from "./peerEdge.js";

/**
 * networkId 1件分の「色チップ + 名前」表示。ネットワーク凡例（Issue #124 A）と
 * ピアエッジのホバーポップオーバー（同 B）の両方で共有する。
 *
 * `describeNetwork` が既知の networkId（Ethereum プロファイルの
 * execution/consensus）と判定した場合だけ GlossaryTerm で包み、それ以外は
 * networkId をそのまま表示する（用語解説の無い生の networkId にリンクを
 * 張らない）。
 */
export function NetworkLabel({ networkId }: { networkId: string }) {
  const { t } = useLanguage();
  const info = describeNetwork(networkId);
  const color = networkIdColor(networkId);

  return (
    <span className="network-label">
      <span
        className="network-label__chip"
        style={{ background: color }}
        aria-hidden="true"
      />
      <span className="network-label__name">
        {info.kind === "known" ? (
          <GlossaryTerm termKey={info.termKey}>{t(info.labelKey)}</GlossaryTerm>
        ) : (
          networkId
        )}
      </span>
    </span>
  );
}
