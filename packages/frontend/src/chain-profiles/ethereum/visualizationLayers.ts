import type { VisualizationLayer } from "../../entities/canvasLayers.js";

/**
 * このチェーンプロファイル(Ethereum)に存在する可視化レイヤーの一覧
 * (レイヤーレンズのチップバー`LayerFilterBar`が読む。Issue #299)。
 *
 * Ethereum は EL/CL 分離を持つため A〜D層すべてを持つ。将来、D層に相当する
 * 「ノード内部の配管」を持たないチェーン(単一プロセスのモノリシック
 * クライアントなど)のプロファイルを追加する場合は、そのプロファイル用に
 * 別の配列を作り D を含めない形にする(CLAUDE.md「チェーンプロファイル単位で
 * 増やす」。既存プロファイルのこの配列に分岐を足す方向にはしない)。
 */
export const ETHEREUM_VISUALIZATION_LAYERS: readonly VisualizationLayer[] = [
  "a",
  "b",
  "c",
  "d",
];
