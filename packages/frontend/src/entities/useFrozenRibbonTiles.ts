import { useMemo, useRef } from "react";
import type { ChainRibbonTile } from "./chainRibbon.js";

/**
 * ホバー連動ハイライト中、チェーンリボンの表示窓（直近8タイル）の前進を
 * 一時停止する（Issue #298 QA差し戻し。docs/worklog/issue-298.md 参照）。
 *
 * 背景: `RIBBON_TILE_COUNT` 件の窓は前進のみで一度流出したタイルは二度と
 * 戻らない（`chainRibbon.ts` の `deriveRibbonTiles`）。実チェーン環境では
 * 2秒程度のブロック生成間隔で窓が進み続けるため、tx/活動チップ（他カード）
 * からの逆方向ホバーで一瞬ハイライトが点灯しても、次の描画までにハイライト
 * 対象のタイルが窓外へ流出し、以後永久にハイライトが復帰しない不具合が
 * 実機検証で確認された。
 *
 * 対策として、`frozen` が true の間（`RibbonHoverContext.hoveredBlockHash`
 * が非 null。順方向＝タイル自身のホバー・逆方向＝他カードのチップのホバー
 * のどちらでも共通）は、`frozen` になった瞬間の `liveTiles` をそのまま
 * 返し続け、以後 `liveTiles` がいくら更新されても無視する。`frozen` が
 * false に戻ったら最新の `liveTiles` への追従を再開する。
 *
 * ref を `useMemo` コールバック内で更新するパターンは、`App.tsx` の
 * `previousInfraNodesRef` 等と同じ書き方（レンダー中に副作用のない形で
 * メモ化キャッシュを持たせる。House style）。
 */
export function useFrozenRibbonTiles(
  liveTiles: ChainRibbonTile[],
  frozen: boolean,
): ChainRibbonTile[] {
  const snapshotRef = useRef<ChainRibbonTile[] | null>(null);

  return useMemo(() => {
    if (!frozen) {
      snapshotRef.current = null;
      return liveTiles;
    }
    if (snapshotRef.current === null) {
      // frozen が false → true に切り替わった、まさにこの瞬間の値を固定する。
      snapshotRef.current = liveTiles;
    }
    // liveTiles の以後の更新は無視して同じスナップショット参照を返し続ける
    // （frozen 中は liveTiles が deps に含まれ再計算自体は走るが、返す値は
    // 変えない。これにより呼び出し側の再レンダーも「見た目上変化なし」の
    // 参照同一性を保てる）。
    return snapshotRef.current;
  }, [liveTiles, frozen]);
}
