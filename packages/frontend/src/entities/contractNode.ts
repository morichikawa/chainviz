import type {
  ContractEntity,
  TransactionEntity,
  WorldStateEntity,
} from "@chainviz/shared";
import type { Node } from "@xyflow/react";
import {
  type ContractActivityChip,
  deriveContractActivity,
  sameContractActivity,
} from "./contractActivity.js";
import type { GridOptions } from "./infraNode.js";
import { DEFAULT_GRID, defaultGridPosition } from "./infraNode.js";
import type { LayoutMap } from "../layout/layoutStore.js";

/**
 * C層拡張のコントラクトカードをキャンバス上に描くための型・変換
 * （ARCHITECTURE.md §6.2/§6.3/§6.6）。インフラカード（infraNode.ts）・
 * ウォレットカード（walletNode.ts）と対になる。
 */

export interface ContractNodeData extends Record<string, unknown> {
  entity: ContractEntity;
  /** カードに載せる「直近の呼び出し・イベント」チップ列（§6.6。新しい順・最大6件）。 */
  activity: ContractActivityChip[];
  /**
   * 実カード到着からの一定時間だけ true になる新着強調フラグ（infraNode.ts
   * の InfraNodeData と同じ仕組み。Issue #123 の配置ルールをコントラクト行にも
   * 適用する。ARCHITECTURE.md §6.2）。contractsToFlowNodes 自体はこの値を
   * 持たず、呼び出し側（App.tsx）が useNewArrivalHighlight の結果を後付けする。
   */
  isNew?: boolean;
  /**
   * tx確定時の確定フラッシュ演出中の種別（§6.6「確定時のコントラクトへの
   * パルス」）。isNew と同じく時間経過に依存する派生状態のため、
   * contractsToFlowNodes 自体はこの値を持たず、呼び出し側（App.tsx）が
   * useContractSettlementEffects の結果を後付けする。
   */
  flashKind?: "success" | "failed";
  /**
   * 現在キャンバス上に存在するウォレットのアドレス集合（Issue #315）。
   * `ContractCard`/`ContractPopover` の「発行済み NFT」節で、台帳
   * （`entity.nftTokens`）の所有者アドレスを対応するウォレットの表記
   * （EIP-55 になりうる）へ揃える（`resolveContractNftLedger`）ために使う。
   * `WalletNodeData.contractsByAddress`（逆方向の照合）と対になる。
   *
   * `isNew`/`flashKind` と同じく optional にしている（`contractsToFlowNodes`
   * は常に値を入れるが、既存の他ファイル（`canvasNode.test.ts` 等）が
   * この型のノードデータを直接組み立てている箇所まで書き換えずに済むよう、
   * 消費側（`ContractCard`）で未指定時は空 Set 扱いにフォールバックする）。
   */
  walletAddresses?: ReadonlySet<string>;
}

export type ContractFlowNode = Node<ContractNodeData, "contract">;

/** React Flow の nodeTypes で使うコントラクトカードの型名。 */
export const CONTRACT_NODE_TYPE = "contract";

/**
 * コントラクトカードの既定グリッド。インフラ行（originY=0）・ウォレット行
 * （originY=520）に続く3段目の帯として、ウォレット行のカード実測高さと
 * 重ならない値を1040に設定する（ARCHITECTURE.md §6.2 の目安値）。
 */
export const CONTRACT_GRID: GridOptions = {
  ...DEFAULT_GRID,
  originY: 1040,
};

export function isContractEntity(
  entity: WorldStateEntity,
): entity is ContractEntity {
  return entity.kind === "contract";
}

export interface ContractNodeContext {
  layout: LayoutMap;
  /**
   * 「直近の呼び出し・イベント」チップ列（§6.6）の導出元になる tx 一覧。
   * 省略時は空配列（活動チップなし）。
   */
  transactions?: TransactionEntity[];
  /**
   * tx の `blockHash` から `BlockEntity.number` を引くための索引
   * （活動チップの並び順に使う。`deriveContractActivity` 参照）。省略時は
   * 空 Map（すべて最古扱いになり、tx hash の辞書順にフォールバックする）。
   */
  blockNumberByHash?: ReadonlyMap<string, number>;
  /**
   * 現在キャンバス上に存在するウォレットのアドレス集合（Issue #315。
   * `ContractNodeData.walletAddresses` 参照）。省略時は空 Set
   * （「発行済み NFT」節の所有者ラベルはすべて台帳の生の表記のまま出す）。
   */
  walletAddresses?: ReadonlySet<string>;
  grid?: GridOptions;
}

/**
 * ワールドステートのエンティティ群からコントラクトカードの React Flow
 * ノード配列を作る。
 *
 * - contract のみを対象にする。
 * - 位置は安定 ID（address。ウォレットと同じくチェーン側の状態なので
 *   Docker コンテナ ID のように再起動で変わる識別子は使わない）をキーに
 *   layout から引く。未保存なら既定グリッドへ。
 * - 並び順を安定させるため address でソートしてからグリッド添字を割り当てる。
 * - `activity`（§6.6のチップ列）は `ctx.transactions` から都度導出する
 *   （`ContractEntity` 自体には専用フィールドを追加しない設計）。
 */
export function contractsToFlowNodes(
  entities: WorldStateEntity[],
  ctx: ContractNodeContext,
): ContractFlowNode[] {
  const grid = ctx.grid ?? CONTRACT_GRID;
  const transactions = ctx.transactions ?? [];
  const blockNumberByHash = ctx.blockNumberByHash ?? new Map<string, number>();
  const walletAddresses = ctx.walletAddresses ?? new Set<string>();
  const contracts = entities
    .filter(isContractEntity)
    .sort((a, b) => a.address.localeCompare(b.address));

  return contracts.map((entity, index) => {
    const saved = ctx.layout[entity.address];
    const position = saved ?? defaultGridPosition(index, grid);
    const activity = deriveContractActivity(
      entity.address,
      transactions,
      blockNumberByHash,
    );
    return {
      id: entity.address,
      type: CONTRACT_NODE_TYPE,
      position: { x: position.x, y: position.y },
      data: { entity, activity, walletAddresses },
    };
  });
}

/**
 * 2つの ContractFlowNode が「見た目上変化していない」とみなせるか判定する
 * (`stabilizeNodes` に渡す比較関数。infraNode.ts の isSameInfraNode と同じ
 * 狙い。Issue #119)。`isNew`/`flashKind` はここでは比較対象にしない
 * （infraNode.ts の InfraNodeData と同じ理由。時間経過に依存する派生状態の
 * ため、呼び出し側 App.tsx が stabilizeNodes の後段で別途反映する）。
 * `activity` は `deriveContractActivity` が毎回新しい配列を組み立てるため、
 * 内容比較（`sameContractActivity`）で行う。
 */
export function isSameContractNode(
  previous: ContractFlowNode,
  next: ContractFlowNode,
): boolean {
  return (
    previous.data.entity === next.data.entity &&
    previous.data.walletAddresses === next.data.walletAddresses &&
    previous.position.x === next.position.x &&
    previous.position.y === next.position.y &&
    sameContractActivity(previous.data.activity, next.data.activity)
  );
}
