import type {
  NodeEntity,
  WorkbenchEntity,
  WorldStateEntity,
} from "@chainviz/shared";
import type { Node } from "@xyflow/react";
import type { LayoutMap, Position } from "../layout/layoutStore.js";
import { computeMaxSyncTargetHeight } from "./syncProgress.js";

/** A層で描画対象になるインフラエンティティ（コンテナ）。 */
export type InfraEntity = NodeEntity | WorkbenchEntity;

export interface InfraNodeData extends Record<string, unknown> {
  entity: InfraEntity;
  /**
   * entity が workbench で `rpcTargetNodeId` を解決できた場合の、対象ノードの
   * containerName（カード詳細ポップオーバーの「操作先ノード」欄用。
   * Issue #123）。解決できない場合は省略する（フォールバック: 欄自体を出さない）。
   */
  rpcTargetContainerName?: string;
  /**
   * entity が node で `drivesNodeId` を解決できた場合の、駆動先ノードの
   * containerName（カード詳細ポップオーバーの「駆動する実行ノード」欄用。
   * ARCHITECTURE.md §7.6.3。Issue #188）。解決できない場合は省略する
   * （フォールバック: 欄自体を出さない。`rpcTargetContainerName` と同じ流儀）。
   */
  drivesNodeContainerName?: string;
  /**
   * entity が node で、自分の id を `drivesNodeId` に持つ別ノード（駆動元）が
   * 解決できた場合の、その駆動元ノードの containerName（カード詳細ポップ
   * オーバーの「駆動元（合意ノード）」欄用。ARCHITECTURE.md §7.6.3の更新版、
   * Issue #215）。`drivesNodeContainerName` が「自分の `drivesNodeId` を
   * 順方向に解決した値」なのに対し、こちらは全ノードを走査して「自分を
   * 指している側」を逆引きする点が異なる。Ethereum プロファイルでは
   * beacon→reth が1対1のため最初に見つかった一致で確定する。解決できない
   * 場合は省略する（フォールバック: 欄自体を出さない）。
   */
  drivenByContainerName?: string;
  /**
   * `drivenByContainerName` が解決できた場合の、その駆動元ノードの
   * `nodeRole`（Issue #285）。InfraPopover が「駆動元（合意ノード）」/
   * 「接続元のバリデーター」のどちらのラベルを出すかを、この値で選ぶ
   * （`chain-profiles/ethereum/internalLinkKinds.ts` の
   * `describeDrivenByField` 参照）。`drivenByContainerName` が省略なら
   * こちらも省略。
   */
  drivenByNodeRole?: string;
  /**
   * D層: キャンバス上の全 EL ノード（`internals.syncStages` を持つ node）の
   * blockHeight 最大値（ARCHITECTURE.md §7.6.5「同期ステージのミニバーの
   * 分母」）。全カードに同じ値が入る（entity 単位ではなくスナップショット
   * 単位の値のため。`isSameInfraNode` の比較対象に含める必要がある点は
   * docstring 参照）。該当ノードが1件も無ければ0。
   */
  maxElBlockHeight?: number;
  /**
   * 実カード到着からの一定時間だけ true になる新着強調フラグ（Issue #123）。
   * entitiesToFlowNodes 自体はこの値を持たない（新着判定は時間経過に依存する
   * ため、entities/useNewArrivalHighlight.ts が別途計算し、呼び出し側
   * （App.tsx）がこのフィールドへ後付けする）。
   */
  isNew?: boolean;
  /**
   * entity が workbench で、`runWorkbenchOperation` が commandResult 待ちの
   * 間だけ true になるフラグ（ARCHITECTURE.md §6.5）。isNew と同じ理由
   * （時間・保留状態に依存する派生状態）で entitiesToFlowNodes 自体は持たず、
   * 呼び出し側（App.tsx）が `useCommands` の `pendingOperationWorkbenchIds`
   * から後付けする。
   */
  operationPending?: boolean;
  /**
   * entity が node/workbench で、`removeNode`/`removeWorkbench` が
   * commandResult 待ちの間だけ true になるフラグ（Issue #222）。
   * `operationPending` と同じ理由（時間・保留状態に依存する派生状態）で
   * entitiesToFlowNodes 自体は持たず、呼び出し側（App.tsx）が
   * `useCommands` の `pendingRemovalIds` から後付けする。
   */
  removalPending?: boolean;
}

export type InfraFlowNode = Node<InfraNodeData, "infra">;

export function isInfraEntity(entity: WorldStateEntity): entity is InfraEntity {
  return entity.kind === "node" || entity.kind === "workbench";
}

export interface GridOptions {
  columns: number;
  gapX: number;
  gapY: number;
  originX: number;
  originY: number;
}

/**
 * gapX(横間隔)は420(Issue #125 UX設計)。カード実測最大幅は現行の命名
 * (`chainviz-ethereum-<service>-N`)で約285フローpx(workbench)なので、420
 * なら横に隣接するカード間に約135px以上の紐が見え、450msフロアでの移動
 * (約300px/s)がはっきり知覚できる。カード幅は `containerName` の長さに
 * 依存する(min-width 190px、max-width なし)ため、コンテナ名が現行より
 * 大幅に長くなる運用に変わった場合はこの値の見直しが必要。
 * gapY(縦間隔)はカード実測高さ(約80フローpx)に対して十分な余白があるため
 * 変えない。
 */
export const DEFAULT_GRID: GridOptions = {
  columns: 3,
  gapX: 420,
  gapY: 200,
  originX: 0,
  originY: 0,
};

/** レイアウト未保存のカードを並べる既定のグリッド座標を返す。 */
export function defaultGridPosition(
  index: number,
  grid: GridOptions = DEFAULT_GRID,
): { x: number; y: number } {
  const col = index % grid.columns;
  const row = Math.floor(index / grid.columns);
  return {
    x: grid.originX + col * grid.gapX,
    y: grid.originY + row * grid.gapY,
  };
}

/** レイアウト上の位置を、空き判定に使う衝突キー（"x,y"）へ変換する。 */
export function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

/**
 * `occupied`（`positionKey` で変換済みの衝突キー集合）のどれとも衝突しない、
 * 既定グリッド上で最初に見つかる空き位置を返す（Issue #123）。グリッド添字を
 * 0 から順に試し、既に使われている座標を飛ばして最初の空きセルを返す純粋関数。
 *
 * 「エンティティの並び順に応じて添字を振り直す」旧方式（Issue #113 の温床）
 * と違い、この関数は「今どのセルが埋まっているか」という状態だけから毎回
 * 独立に空きセルを決めるため、既存カードの増減で結果が変わらない。
 */
export function findFreeGridPosition(
  occupied: Iterable<string>,
  grid: GridOptions = DEFAULT_GRID,
): Position {
  const occupiedKeys = new Set(occupied);
  let index = 0;
  let position = defaultGridPosition(index, grid);
  while (occupiedKeys.has(positionKey(position))) {
    index += 1;
    position = defaultGridPosition(index, grid);
  }
  return position;
}

/**
 * 保存済みレイアウトに無いコンテナ名へ、既存の位置と衝突しない空きグリッド
 * スロットを割り当てた新しいレイアウトマップを返す（純粋関数。Issue #123
 * UX設計 §4-3 ルール1）。割り当て済みの分はそのまま引き継ぐ。
 *
 * 割り当て順は containerName の辞書順（到着順に依存しない決定的な順序）。
 * 追加すべきものが無ければ引数の `layout` をそのまま返す（参照の変化で
 * 「何か変わった」を安価に判定できるようにするため）。
 *
 * 呼び出し側（App.tsx）はこの結果を localStorage へ永続化することで、
 * 「エンティティ初出時に位置を確定し、以後は二度と動かさない」を実現する。
 */
export function resolveLayoutPositions(
  containerNames: string[],
  layout: LayoutMap,
  grid: GridOptions = DEFAULT_GRID,
): LayoutMap {
  const missing = containerNames.filter((name) => !(name in layout)).sort();
  if (missing.length === 0) return layout;

  const occupied = new Set(Object.values(layout).map(positionKey));
  const next: LayoutMap = { ...layout };
  for (const name of missing) {
    const position = findFreeGridPosition(occupied, grid);
    next[name] = position;
    occupied.add(positionKey(position));
  }
  return next;
}

/**
 * ワールドステートのエンティティ群を React Flow のノード配列に変換する。
 *
 * - node / workbench のみを対象にする（A層）。
 * - 位置は安定 ID（containerName）をキーに layout から引く。未保存の場合は
 *   `resolveLayoutPositions` と同じアルゴリズムでその場限りの表示用位置を
 *   計算する（実際の確定・永続化は呼び出し側 App.tsx が担う。1レンダー分の
 *   暫定表示に過ぎず、次のレンダーで確定位置に切り替わる。Issue #123）。
 * - 並び順を安定させるため id でソートする（位置の算出には使わない）。
 */
export function entitiesToFlowNodes(
  entities: WorldStateEntity[],
  layout: LayoutMap,
  grid: GridOptions = DEFAULT_GRID,
): InfraFlowNode[] {
  const infra = entities
    .filter(isInfraEntity)
    .sort((a, b) => a.id.localeCompare(b.id));

  const nodesById = new Map<string, NodeEntity>();
  for (const entity of entities) {
    if (entity.kind === "node") nodesById.set(entity.id, entity);
  }

  const occupied = new Set(Object.values(layout).map(positionKey));
  const fallbackPositions = new Map<string, Position>();

  // D層: 全カード共通の値（スナップショット単位）なので、エンティティごとに
  // 計算しない（ARCHITECTURE.md §7.6.5）。
  const maxElBlockHeight = computeMaxSyncTargetHeight(nodesById.values());

  // 「駆動元（合意ノード / バリデーター）」逆引き用の索引（Issue #215、
  // nodeRole は Issue #285 で追加）。node 全体を一度走査し、`drivesNodeId` の
  // 指す先ごとに最初に見つかった駆動元の containerName・nodeRole を記録する。
  // Ethereum プロファイルは beacon→reth・validator→beacon がそれぞれ1対1
  // なので、複数の駆動元が同じ相手を指す状況は想定しない（最初の一致を採用）。
  const drivenByContainerNameByTargetId = new Map<string, string>();
  const drivenByNodeRoleByTargetId = new Map<string, string | undefined>();
  for (const candidate of nodesById.values()) {
    if (!candidate.drivesNodeId) continue;
    if (drivenByContainerNameByTargetId.has(candidate.drivesNodeId)) continue;
    drivenByContainerNameByTargetId.set(
      candidate.drivesNodeId,
      candidate.containerName,
    );
    drivenByNodeRoleByTargetId.set(candidate.drivesNodeId, candidate.nodeRole);
  }

  return infra.map((entity) => {
    let position: Position | undefined = layout[entity.containerName];
    if (!position) position = fallbackPositions.get(entity.containerName);
    if (!position) {
      position = findFreeGridPosition(occupied, grid);
      occupied.add(positionKey(position));
      fallbackPositions.set(entity.containerName, position);
    }

    const rpcTargetContainerName =
      entity.kind === "workbench" && entity.rpcTargetNodeId
        ? nodesById.get(entity.rpcTargetNodeId)?.containerName
        : undefined;
    const drivesNodeContainerName =
      entity.kind === "node" && entity.drivesNodeId
        ? nodesById.get(entity.drivesNodeId)?.containerName
        : undefined;
    const drivenByContainerName =
      entity.kind === "node"
        ? drivenByContainerNameByTargetId.get(entity.id)
        : undefined;
    const drivenByNodeRole =
      entity.kind === "node" && drivenByContainerName !== undefined
        ? drivenByNodeRoleByTargetId.get(entity.id)
        : undefined;

    return {
      id: entity.id,
      type: "infra",
      position: { x: position.x, y: position.y },
      data: {
        entity,
        rpcTargetContainerName,
        drivesNodeContainerName,
        drivenByContainerName,
        drivenByNodeRole,
        maxElBlockHeight,
      },
    };
  });
}

/**
 * 2つの InfraFlowNode が「見た目上変化していない」とみなせるか判定する
 * (`stabilizeNodes` に渡す比較関数。Issue #119)。
 *
 * `entity` は WorldState 側で内容に変化がない限り同一オブジェクト参照が
 * 保たれる(`world-state/store.ts` の `applyDiff` 参照)ため、参照比較だけで
 * 「実データが変わっていないか」を安価に判定できる。
 *
 * `maxElBlockHeight` は例外的に明示比較が必要（Issue #189）。
 * `rpcTargetContainerName`/`drivesNodeContainerName`/`drivenByContainerName`/
 * `drivenByNodeRole` は解決先ノードの containerName・nodeRole（実質不変）
 * から導かれるため、この関数が entity 参照のみで
 * 判定しても古い値を使い回す実害がほぼ無い。一方 `maxElBlockHeight` は
 * チェーン進行のたびに変わり続ける値であり、当のノード自身の entity が
 * 変化しない間（例: バックフィル中で blockHeight がまだ動いていない
 * フォロワーカード）は entity 参照だけの比較だと古い分母を使い回してしまい、
 * 同期ステージのプログレスバーが固まって見える。そのため明示的に比較対象に
 * 含める。
 */
export function isSameInfraNode(
  previous: InfraFlowNode,
  next: InfraFlowNode,
): boolean {
  return (
    previous.data.entity === next.data.entity &&
    previous.data.maxElBlockHeight === next.data.maxElBlockHeight &&
    previous.position.x === next.position.x &&
    previous.position.y === next.position.y
  );
}
