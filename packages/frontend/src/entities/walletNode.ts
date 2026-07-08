import type {
  ContractEntity,
  TransactionEntity,
  WalletEntity,
  WorldStateEntity,
} from "@chainviz/shared";
import type { Node } from "@xyflow/react";
import type { GridOptions } from "./infraNode.js";
import { DEFAULT_GRID, defaultGridPosition } from "./infraNode.js";
import { resolveWalletTransactions } from "./transaction.js";
import type { LayoutMap } from "../layout/layoutStore.js";

/**
 * C層のウォレット（EOA / スマートアカウント）をキャンバス上のカードとして
 * 描くための型・変換。インフラカード（infraNode.ts）と対になる。
 */

export interface WalletNodeData extends Record<string, unknown> {
  entity: WalletEntity;
  /** カードに載せる直近 tx（新しい順、実在するものだけ解決済み）。 */
  transactions: TransactionEntity[];
  /** いま確定フラッシュ演出中の tx hash 集合（useTxLifecycle 由来）。 */
  settlingHashes: string[];
  /**
   * 所有ワークベンチが現存するか。false の場合、元の所有者が削除された
   * （ownerWorkbenchId が null）ことを示す。ウォレット自体のカードは残す
   * （CONCEPT.md「ノード/ワークベンチを削除したときの過去データの扱い」）。
   */
  ownerPresent: boolean;
  /**
   * アドレス -> ContractEntity の索引。WalletPopover の tx 一覧に「呼び出し
   * 内容」（関数名＋引数プレビュー＋宛先コントラクト名）を追記するために使う
   * （ARCHITECTURE.md §6.6、Issue #166）。カード自体の tx チップ表示には
   * 使わない（そちらは tx 単体の情報だけで完結する `txChipLabel` 参照）。
   */
  contractsByAddress: ReadonlyMap<string, ContractEntity>;
}

export type WalletFlowNode = Node<WalletNodeData, "wallet">;

/** React Flow の nodeTypes で使うウォレットカードの型名。 */
export const WALLET_NODE_TYPE = "wallet";

/**
 * ウォレットカードの既定グリッド。インフラカード（原点 y=0）と重ならないよう、
 * 一段下（originY）に並べる。手でドラッグした位置は layout に保存され、以後は
 * そちらが優先される。
 */
export const WALLET_GRID: GridOptions = {
  ...DEFAULT_GRID,
  originY: 520,
};

export function isWalletEntity(
  entity: WorldStateEntity,
): entity is WalletEntity {
  return entity.kind === "wallet";
}

/** 1 Ether を表す wei（10^18）。 */
const WEI_PER_ETHER = 1_000_000_000_000_000_000n;

/**
 * wei 建ての残高（整数文字列）を Ether 表記へ変換する。BigInt で小数誤差なく
 * 計算し、小数第4位までを表示する。数値として解釈できない入力はそのまま返す。
 */
export function formatEther(weiString: string, fractionDigits = 4): string {
  let wei: bigint;
  try {
    wei = BigInt(weiString);
  } catch {
    return weiString;
  }
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / WEI_PER_ETHER;
  const frac = abs % WEI_PER_ETHER;
  // 10^18 でゼロ埋めした小数部の先頭 fractionDigits 桁を取る。
  const fracFull = frac.toString().padStart(18, "0");
  const fracShown = fracFull.slice(0, fractionDigits);
  const sign = negative ? "-" : "";
  return `${sign}${whole.toString()}.${fracShown}`;
}

export interface WalletNodeContext {
  layout: LayoutMap;
  /** hash -> TransactionEntity の索引（indexTransactions の出力）。 */
  txByHash: ReadonlyMap<string, TransactionEntity>;
  /** 確定演出中の tx hash 集合。 */
  settling: ReadonlySet<string>;
  /** 現在キャンバスに存在するインフラノードの id 集合（所有者の生存判定用）。 */
  presentInfraIds: ReadonlySet<string>;
  /**
   * アドレス -> ContractEntity の索引（WalletPopover の呼び出し内容表示に
   * 使う。§6.6）。省略時は空 Map（呼び出し内容の宛先名はすべて短縮アドレス
   * 表示にフォールバックする）。
   */
  contractsByAddress?: ReadonlyMap<string, ContractEntity>;
  grid?: GridOptions;
}

/**
 * ワールドステートのエンティティ群からウォレットカードの React Flow ノード配列を
 * 作る。
 *
 * - wallet のみを対象にする。
 * - 位置は安定 ID（address）をキーに layout から引く。未保存なら既定グリッドへ。
 * - 並び順を安定させるため address でソートしてからグリッド添字を割り当てる。
 */
export function walletsToFlowNodes(
  entities: WorldStateEntity[],
  ctx: WalletNodeContext,
): WalletFlowNode[] {
  const grid = ctx.grid ?? WALLET_GRID;
  const contractsByAddress = ctx.contractsByAddress ?? new Map<string, ContractEntity>();
  const wallets = entities
    .filter(isWalletEntity)
    .sort((a, b) => a.address.localeCompare(b.address));

  return wallets.map((entity, index) => {
    const saved = ctx.layout[entity.address];
    const position = saved ?? defaultGridPosition(index, grid);
    const transactions = resolveWalletTransactions(entity, ctx.txByHash);
    const settlingHashes = transactions
      .filter((tx) => ctx.settling.has(tx.hash))
      .map((tx) => tx.hash);
    const ownerPresent =
      entity.ownerWorkbenchId !== null &&
      ctx.presentInfraIds.has(entity.ownerWorkbenchId);
    return {
      id: entity.address,
      type: WALLET_NODE_TYPE,
      position: { x: position.x, y: position.y },
      data: { entity, transactions, settlingHashes, ownerPresent, contractsByAddress },
    };
  });
}

/** 参照の同一性のみで配列を比較する(順序も含めて完全一致か)。 */
function sameByReference<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

/**
 * 2つの WalletFlowNode が「見た目上変化していない」とみなせるか判定する
 * (`stabilizeNodes` に渡す比較関数。infraNode.ts の isSameInfraNode と同じ
 * 狙い。Issue #119)。
 *
 * `transactions` / `settlingHashes` は `walletsToFlowNodes` が毎回新しい配列を
 * 組み立てるため配列自体の参照比較はできないが、要素(TransactionEntity /
 * tx hash 文字列)は内容が変わらない限り安定するため、要素ごとの参照比較で
 * 判定する。
 */
export function isSameWalletNode(
  previous: WalletFlowNode,
  next: WalletFlowNode,
): boolean {
  return (
    previous.data.entity === next.data.entity &&
    previous.data.ownerPresent === next.data.ownerPresent &&
    previous.data.contractsByAddress === next.data.contractsByAddress &&
    previous.position.x === next.position.x &&
    previous.position.y === next.position.y &&
    sameByReference(previous.data.transactions, next.data.transactions) &&
    sameByReference(previous.data.settlingHashes, next.data.settlingHashes)
  );
}
