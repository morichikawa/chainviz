import { useLanguage } from "../i18n/LanguageProvider.js";
import { NetworkLabel } from "./NetworkLabel.js";

/**
 * ピア接続（紐）へのホバーで出すポップオーバーの中身（Issue #124 B）。
 * 位置決め（`EdgeLabelRenderer` での配置）は `PeerPropagationEdge` 側が持ち、
 * ここは中身の描画だけに専念する（`EdgeLabelRenderer` はテストのために
 * 実際の React Flow ツリーが必要になるため、ロジックをここへ切り出して
 * 単体テストできるようにする）。
 */
export function PeerEdgePopover({
  networkId,
  endpoints,
}: {
  networkId: string;
  endpoints: [string, string];
}) {
  const { t } = useLanguage();
  const [from, to] = endpoints;

  return (
    <div className="peer-popover nodrag nopan" role="tooltip">
      <NetworkLabel networkId={networkId} />
      <div className="peer-popover__endpoints">
        {from} ↔ {to}
      </div>
      <div className="peer-popover__hint">{t("peerEdge.hint")}</div>
    </div>
  );
}
