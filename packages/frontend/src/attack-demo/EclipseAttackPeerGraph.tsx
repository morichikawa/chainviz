import { useLanguage } from "../i18n/LanguageProvider.js";
import type { PeerSlotState } from "./eclipseAttackDemo.js";

/**
 * 「eclipse攻撃のしくみ」デモのミニ包囲グラフ（Issue #416。
 * `docs/worklog/issue-416.md` UX設計 §3レイアウト2）。中央の被害ノードと、
 * それを取り囲む8個のピアスロットを SVG で描く。`EclipseAttackDemoView.tsx`
 * から図解部分だけを切り出したもの（1ファイル1責務）。
 *
 * スロット配置: 中心から半径 `SLOT_RADIUS` の円周上に、12時位置をスロット0
 * として時計回りに45度刻みで配置する（UX設計: 0=12時, 1=1:30, 2=3時, …,
 * 7=10:30）。この描画順が「攻撃者ピアを追加」で置き換わっていく固定順と
 * 一致する。
 */

const VIEWBOX_SIZE = 280;
const CENTER = VIEWBOX_SIZE / 2;
const SLOT_RADIUS = 110;
const SLOT_CHIP_RADIUS = 15;
const VICTIM_WIDTH = 104;
const VICTIM_HEIGHT = 40;

/** スロット index (0=12時) の中心座標。時計回りに45度刻み。 */
function slotPosition(index: number): { x: number; y: number } {
  const angleRad = ((index * 45) / 180) * Math.PI;
  return {
    x: CENTER + SLOT_RADIUS * Math.sin(angleRad),
    y: CENTER - SLOT_RADIUS * Math.cos(angleRad),
  };
}

export interface EclipseAttackPeerGraphProps {
  /** 固定8要素。`eclipseAttackDemo.ts` の `EclipseAttackDemoState.slots` と同じ順。 */
  slots: readonly PeerSlotState[];
  /** 直前の操作で置き換わったスロットの index。フラッシュ演出の対象（無ければ null）。 */
  flashingSlotIndex: number | null;
  /** 完全包囲（8/8）かどうか。被害ノードの outline 切替に使う。 */
  eclipsed: boolean;
}

export function EclipseAttackPeerGraph({
  slots,
  flashingSlotIndex,
  eclipsed,
}: EclipseAttackPeerGraphProps) {
  const { t } = useLanguage();

  return (
    <svg
      className="eclipse-demo__graph"
      data-testid="eclipse-demo-graph"
      viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      role="img"
      aria-label={t("eclipseDemo.victimNode")}
    >
      {slots.map((slot, index) => {
        const { x, y } = slotPosition(index);
        const isAttacker = slot === "attacker";
        const flashing = flashingSlotIndex === index;
        return (
          <g
            key={index}
            data-testid={`eclipse-demo-slot-${index}`}
            role="img"
            aria-label={t(isAttacker ? "eclipseDemo.slot.attacker" : "eclipseDemo.slot.honest")}
          >
            <line
              className={
                isAttacker
                  ? "eclipse-demo__slot-line eclipse-demo__slot-line--attacker"
                  : "eclipse-demo__slot-line eclipse-demo__slot-line--honest"
              }
              x1={CENTER}
              y1={CENTER}
              x2={x}
              y2={y}
              aria-hidden="true"
            />
            <circle
              className={[
                "eclipse-demo__slot-chip",
                isAttacker
                  ? "eclipse-demo__slot-chip--attacker"
                  : "eclipse-demo__slot-chip--honest",
                flashing ? "eclipse-demo__slot-chip--flash" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              cx={x}
              cy={y}
              r={SLOT_CHIP_RADIUS}
              aria-hidden="true"
            />
            {/* 色だけに頼らない区別: 正規=チェック印、攻撃者=感嘆符。 */}
            <text
              className="eclipse-demo__slot-glyph"
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              aria-hidden="true"
            >
              {isAttacker ? "!" : "✓"}
            </text>
          </g>
        );
      })}
      <rect
        className={
          eclipsed
            ? "eclipse-demo__victim eclipse-demo__victim--eclipsed"
            : "eclipse-demo__victim"
        }
        data-testid="eclipse-demo-victim"
        x={CENTER - VICTIM_WIDTH / 2}
        y={CENTER - VICTIM_HEIGHT / 2}
        width={VICTIM_WIDTH}
        height={VICTIM_HEIGHT}
        rx={8}
      />
      <text
        className="eclipse-demo__victim-label"
        x={CENTER}
        y={CENTER}
        textAnchor="middle"
        dominantBaseline="central"
        aria-hidden="true"
      >
        {t("eclipseDemo.victimNode")}
      </text>
    </svg>
  );
}
