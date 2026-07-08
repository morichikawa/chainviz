import type { Node } from "@xyflow/react";
import { clientCategory } from "./clientCategory.js";
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

/**
 * ゴーストが表す対象の種別。addNode / addWorkbench / runWorkbenchOperation
 * (deployContract) のどれから生まれたか（ARCHITECTURE.md §6.5「デプロイの
 * みコントラクト行へ仮カードを置く」）。
 */
export type GhostKind = "node" | "workbench" | "contract";

/**
 * ゴーストが node の場合、EL/CL のどちらを表すか（Issue #123 UX設計 §4-2）。
 * addNode は reth + beacon の 2 コンテナを追加するため、ゴーストも 2 枚に
 * 分けてそれぞれの層を持たせる。workbench ゴーストにはこのフィールドは無い。
 */
export type GhostLayer = "execution" | "consensus";

export interface GhostNodeData extends Record<string, unknown> {
  /** このゴーストを生んだコマンドの id。commandResult / 実体到着との突き合わせに使う。 */
  commandId: string;
  kind: GhostKind;
  /** カードのサブタイトルに出す補助情報（chainProfile / ワークベンチ名）。 */
  label: string;
  /** kind === "node" のときだけ意味を持つ、EL/CL の別（Issue #123）。 */
  layer?: GhostLayer;
  /**
   * このゴーストが接続予定のノードの containerName（ツールチップ・サブタイトル
   * 表示用。Issue #123 UX設計 §4-2）。ブートノード / RPC 接続先を解決できない
   * 場合は省略する（§4-5 フォールバック）。
   */
  targetContainerName?: string;
  /**
   * 接続予定エッジの終点にする、接続予定先ノードの安定 ID。
   * `targetContainerName` と同時に解決される（同じノードの別表現）。
   */
  targetNodeId?: string;
  /**
   * kind === "contract" のときだけ意味を持つ、デプロイ先のカタログキー
   * （`WorkbenchOperation.deployContract.contractKey` と同じ値）。実体到着
   * （entityAdded の `ContractEntity.catalogKey`）との突き合わせに使う
   * （`removeGhostForArrivedEntity` 参照）。
   */
  catalogKey?: string;
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
  /** kind === "node" のときの EL/CL 別（Issue #123）。 */
  layer?: GhostLayer;
  /** 接続予定先ノードの containerName / 安定 ID（解決できなければ省略）。 */
  targetContainerName?: string;
  targetNodeId?: string;
  /** kind === "contract" のときのカタログキー（GhostNodeData 参照）。 */
  catalogKey?: string;
}

/**
 * ゴーストノード 1 件分の React Flow ノードを組み立てる。
 *
 * kind === "node" の addNode は reth 用・beacon 用の 2 枚のゴーストになる
 * ため、`node-${commandId}` だけでは id が重複する。id には `layer` も
 * 含めて一意にする（workbench には layer が無いので従来どおり）。
 */
export function createGhostNode({
  commandId,
  kind,
  label,
  index,
  grid = GHOST_GRID,
  layer,
  targetContainerName,
  targetNodeId,
  catalogKey,
}: CreateGhostNodeParams): GhostFlowNode {
  const position = defaultGridPosition(index, grid);
  const id = layer ? `ghost-${commandId}-${layer}` : `ghost-${commandId}`;
  return {
    id,
    type: GHOST_NODE_TYPE,
    position,
    // 位置が未確定の暫定カードなので、ドラッグでレイアウトに焼き付けさせない。
    draggable: false,
    selectable: false,
    data: {
      commandId,
      kind,
      label,
      layer,
      targetContainerName,
      targetNodeId,
      catalogKey,
    },
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

/** `removeGhostForArrivedEntity` に渡す、実体到着イベント側の最小限の形。 */
export type ArrivedInfraEntity =
  | { kind: "node"; clientType?: string }
  | { kind: "workbench" }
  | {
      kind: "contract";
      /** 到着した `ContractEntity.catalogKey`（未照合なら省略）。 */
      catalogKey?: string;
    };

/**
 * 実エンティティ（entityAdded）の到着に対応する 1 枚のゴーストを取り除いた
 * 新しい配列を返す（純粋関数。Issue #123 UX設計 §4-3 ルール2。デプロイの
 * 仮カードは ARCHITECTURE.md §6.5「entityAdded（contract）の catalogKey
 * 一致で置換し、対応が取れないときは FIFO 近似」）。
 *
 * addNode が reth 用・beacon 用の 2 枚のゴーストを生むようになったため、
 * `removeOldestGhostByKind`（kind だけの FIFO）では届いた実体がどちらの
 * ゴーストに対応するか区別できない。到着した node の `clientType` から
 * EL/CL の層を判定し、同じ層のゴーストのうち最も古いものを優先して消す。
 * 同じ層のゴーストが無い場合（旧スナップショット・層不明の生成物など）は
 * kind だけの FIFO へフォールバックする（ゴーストが消えなくなる事故を防ぐ）。
 *
 * kind === "contract" は、到着した `catalogKey` に一致するデプロイ中の
 * ゴーストがあればそれを優先して消す。一致するものが無い（catalogKey が
 * 省略された・複数の同時デプロイで既に別のゴーストが消費された等）場合は
 * kind だけの FIFO へフォールバックする。
 */
export function removeGhostForArrivedEntity(
  ghosts: GhostFlowNode[],
  entity: ArrivedInfraEntity,
): GhostFlowNode[] {
  if (entity.kind === "workbench") {
    return removeOldestGhostByKind(ghosts, "workbench");
  }

  if (entity.kind === "contract") {
    if (entity.catalogKey !== undefined) {
      const index = ghosts.findIndex(
        (ghost) =>
          ghost.data.kind === "contract" &&
          ghost.data.catalogKey === entity.catalogKey,
      );
      if (index !== -1) {
        return [...ghosts.slice(0, index), ...ghosts.slice(index + 1)];
      }
    }
    return removeOldestGhostByKind(ghosts, "contract");
  }

  const category = clientCategory(entity.clientType ?? "");
  if (category === "execution" || category === "consensus") {
    const index = ghosts.findIndex(
      (ghost) => ghost.data.kind === "node" && ghost.data.layer === category,
    );
    if (index !== -1) {
      return [...ghosts.slice(0, index), ...ghosts.slice(index + 1)];
    }
  }
  return removeOldestGhostByKind(ghosts, "node");
}
