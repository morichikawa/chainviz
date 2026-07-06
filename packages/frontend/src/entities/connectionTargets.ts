import type { NodeEntity, WorldStateEntity } from "@chainviz/shared";
import { clientCategory } from "./clientCategory.js";

/**
 * `addNode` / `addWorkbench` を押す「前」に、実際に何と繋がって増えるのかを
 * 予告するための解決ロジック（Issue #123 UX設計 §4-1・§5）。
 *
 * ここで解決した対象は、押下前のツールチップ・仮カード（ゴースト）の
 * サブタイトル・到着後の常設エッジのどこからも同じ考え方で参照する
 * （UX設計の「接続先は現行どおり自動、何が起きるかを正確に予告する」方針）。
 */

export interface BootNodes {
  /** EL（実行層）側のブートノード。特定できなければ undefined。 */
  execution?: NodeEntity;
  /** CL（合意層）側のブートノード。特定できなければ undefined。 */
  consensus?: NodeEntity;
}

/**
 * ワールドステートから `p2pRole === "bootnode"` のノードを EL/CL 別に探す。
 * 同じ層に複数のブートノード候補がある場合は最初に見つかったものを使う
 * （現行の node-lifecycle 実装は層ごとに単一のブートノードを固定する前提。
 * ARCHITECTURE.md / node-lifecycle.ts 参照）。
 *
 * `p2pRole` は optional（旧スナップショット・collector 未対応との互換）なので、
 * 見つからない場合は該当フィールドを省略する（呼び出し側はフォールバック表示へ倒す。
 * Issue #123 UX設計 §4-5）。
 */
export function resolveBootNodes(entities: WorldStateEntity[]): BootNodes {
  const result: BootNodes = {};
  for (const entity of entities) {
    if (entity.kind !== "node" || entity.p2pRole !== "bootnode") continue;
    const category = clientCategory(entity.clientType);
    if (category === "execution" && !result.execution) {
      result.execution = entity;
    } else if (category === "consensus" && !result.consensus) {
      result.consensus = entity;
    }
  }
  return result;
}

/**
 * ワークベンチの RPC 呼び出しが実際に届くノードを解決する。
 *
 * これから追加するワークベンチ自体はまだ存在しないため、現行の実装
 * （node-lifecycle.ts が固定の `ETH_RPC_URL` を使う）を踏まえ、既に存在する
 * いずれかのワークベンチの `rpcTargetNodeId` を「新しく追加するワークベンチも
 * 同じ対象に繋がる」という近似値として使う。1件も解決できない場合は
 * undefined を返し、呼び出し側はフォールバック表示へ倒す（Issue #123 UX設計
 * §4-1・§4-5）。
 */
export function resolveRpcTargetNode(
  entities: WorldStateEntity[],
): NodeEntity | undefined {
  const nodesById = new Map<string, NodeEntity>();
  for (const entity of entities) {
    if (entity.kind === "node") nodesById.set(entity.id, entity);
  }
  for (const entity of entities) {
    if (entity.kind !== "workbench" || !entity.rpcTargetNodeId) continue;
    const node = nodesById.get(entity.rpcTargetNodeId);
    if (node) return node;
  }
  return undefined;
}
