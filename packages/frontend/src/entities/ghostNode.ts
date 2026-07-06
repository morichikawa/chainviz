import type { Node } from "@xyflow/react";
import { DEFAULT_GRID, type GridOptions, defaultGridPosition } from "./infraNode.js";

/**
 * `addNode` / `addWorkbench` コマンド送信後、実エンティティが world-state の
 * diff として届くまでの間キャンバスへ一時的に置く「仮カード（ゴーストノード）」の
 * 型・純粋関数（Issue #102）。
 *
 * Docker コンテナの起動には数秒かかり、その間ユーザーには何の変化も見えず
 * 「押しても反応が無い」ように見えてしまう。実カード（InfraNodeCard）と同じ
 * 位置管理の仕組み（安定 ID ベースの layout）にはまだ乗せられない
 * （IP・コンテナ名がまだ存在しない）ため、既存カードと重ならない適当なグリッド
 * 位置へ暫定的に置き、実エンティティが届き次第 useCommands 側が取り除く。
 */

/** ゴーストが表す対象の種別。addNode / addWorkbench のどちらから生まれたか。 */
export type GhostKind = "node" | "workbench";

export interface GhostNodeData extends Record<string, unknown> {
  /** このゴーストを生んだコマンドの id。commandResult / 実体到着との突き合わせに使う。 */
  commandId: string;
  kind: GhostKind;
  /** カードのサブタイトルに出す補助情報（chainProfile / ワークベンチ名）。 */
  label: string;
}

/** React Flow の nodeTypes で使うゴーストカードの型名。 */
export const GHOST_NODE_TYPE = "ghost";

export type GhostFlowNode = Node<GhostNodeData, "ghost">;

/**
 * 実体が届くまでの安全網タイムアウト（ms）。
 *
 * 通常経路では commandResult(ok:false) かエンティティの到着（entityAdded）で
 * ゴーストは消える。このタイムアウトは「その両方が来ない」異常系（例:
 * commandResult 自体を取りこぼす、diff が別の理由で欠落する等）でゴーストが
 * 消えなくなることを防ぐ最終防衛ラインに過ぎない。実行環境の状態（チェーンの
 * 稼働時間・ブロック数など）に依存する値ではなく、単に「UI 上の仮カードを
 * いつまでも表示し続けない」ための固定 UX 値なので、これが早めに発火しても
 * 実害はない（実カードは到着した diff からそのまま描画されるだけで、ゴーストの
 * 消去タイミングとは独立している）。コンテナ起動が恒常的にこれより長くかかる
 * 環境が出てきた場合は見直すこと。
 */
export const GHOST_TIMEOUT_MS = 60_000;

/** 仮カードを並べる既定グリッド。インフラカードと同じ原点・間隔を使う。 */
export const GHOST_GRID: GridOptions = DEFAULT_GRID;

export interface CreateGhostNodeParams {
  commandId: string;
  kind: GhostKind;
  label: string;
  /** 何番目のゴースト/インフラカードとして置くか（グリッド位置の算出に使う）。 */
  index: number;
  grid?: GridOptions;
}

/** ゴーストノード 1 件分の React Flow ノードを組み立てる。 */
export function createGhostNode({
  commandId,
  kind,
  label,
  index,
  grid = GHOST_GRID,
}: CreateGhostNodeParams): GhostFlowNode {
  const position = defaultGridPosition(index, grid);
  return {
    id: `ghost-${commandId}`,
    type: GHOST_NODE_TYPE,
    position,
    // 位置が未確定の暫定カードなので、ドラッグでレイアウトに焼き付けさせない。
    draggable: false,
    selectable: false,
    data: { commandId, kind, label },
  };
}

/** commandId が一致するゴーストを取り除いた新しい配列を返す（純粋関数）。 */
export function removeGhostByCommandId(
  ghosts: GhostFlowNode[],
  commandId: string,
): GhostFlowNode[] {
  return ghosts.filter((ghost) => ghost.data.commandId !== commandId);
}

/**
 * 指定した種別のゴーストのうち、最も古い（＝配列内で先頭にある）ものを 1 件だけ
 * 取り除いた新しい配列を返す（純粋関数）。
 *
 * 実エンティティの到着イベント（entityAdded）は commandId を持たないため、
 * どのコマンドに対応する到着かを厳密には特定できない。同種のコマンドは
 * 送った順に処理される前提で、先に送った（＝先に表示した）ゴーストから
 * 実体化したとみなす FIFO の近似で十分（この対応付けを厳密にしたい場合は
 * collector 側で commandId をエンティティに紐付ける必要があり、shared の
 * スキーマ変更を伴うため本 Issue のスコープ外）。
 */
export function removeOldestGhostByKind(
  ghosts: GhostFlowNode[],
  kind: GhostKind,
): GhostFlowNode[] {
  const index = ghosts.findIndex((ghost) => ghost.data.kind === kind);
  if (index === -1) return ghosts;
  return [...ghosts.slice(0, index), ...ghosts.slice(index + 1)];
}
