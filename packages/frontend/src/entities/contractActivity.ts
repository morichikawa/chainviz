import type { DecodedArgument, TransactionEntity } from "@chainviz/shared";
import { DEFAULT_RECENT_TX_LIMIT, shortHex } from "./transaction.js";

/**
 * コントラクトカードの「直近の呼び出し・イベント」チップ列（ARCHITECTURE.md
 * §6.6）の導出。ワールドステートの tx から `contractAddress` 照合で導出し、
 * `ContractEntity` 自体には専用フィールドを持たせない（§6.6 の決定）。
 */

export type ContractActivityChipKind = "call" | "event";

export interface ContractActivityChip {
  /** React key 用の一意なキー（tx hash + 種別 + 添字）。 */
  key: string;
  kind: ContractActivityChipKind;
  /** 表示ラベル（復号済みなら関数名/イベント名、そうでなければ生の識別子の短縮表示）。 */
  label: string;
  /** カタログで復号できたか。false なら「復号できません」ホバーを出す。 */
  decoded: boolean;
  /** ホバーで見せる引数一覧（`DecodedArgument` の `name: value`）。 */
  args: DecodedArgument[];
  /** 由来 tx のハッシュ。 */
  txHash: string;
}

/**
 * tx の確定順を近似する並べ替えキー。`blockHash` から `BlockEntity.number` を
 * 引ければそれを使い（実データに基づく真の確定順）、引けない場合は -1 に
 * 落として最も古い扱いにする（tx entities の到着順など「観測時刻に依存する
 * 固定値」には頼らない。ARCHITECTURE.md 品質ゲート「今この瞬間に観測できる
 * 状態に依存した固定値をロジックに埋め込まない」に対応）。
 */
function settlementRank(
  tx: TransactionEntity,
  blockNumberByHash: ReadonlyMap<string, number>,
): number {
  if (tx.blockHash === undefined) return -1;
  return blockNumberByHash.get(tx.blockHash) ?? -1;
}

/**
 * 指定コントラクトに関わる確定済み tx から、活動チップ列を導出する
 * （新しい順・上限 `limit` 件。既定値はウォレットの tx チップと同じ）。
 *
 * - 未確定（`pending`）の tx は対象外（§6.6: 確定済みのみ）。
 * - 呼び出しチップ: `tx.contractCall.contractAddress === contractAddress` の
 *   tx から 1 件。`functionName` が復号できていれば使い、できなければ
 *   `rawFunctionId` を短縮して使う。
 * - イベントチップ: `tx.contractEvents` のうち `contractAddress` が一致する
 *   要素ごとに 1 件（1 tx に複数あり得る）。
 * - 並び順は `blockHash` から引ける `BlockEntity.number` の降順、引けない
 *   もの同士は tx hash の辞書順で安定させる。
 */
export function deriveContractActivity(
  contractAddress: string,
  transactions: readonly TransactionEntity[],
  blockNumberByHash: ReadonlyMap<string, number>,
  limit = DEFAULT_RECENT_TX_LIMIT,
): ContractActivityChip[] {
  const settled = transactions.filter((tx) => tx.status !== "pending");
  const ranked = settled
    .map((tx) => ({ tx, rank: settlementRank(tx, blockNumberByHash) }))
    .sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return a.tx.hash.localeCompare(b.tx.hash);
    });

  const chips: ContractActivityChip[] = [];
  for (const { tx } of ranked) {
    if (tx.contractCall?.contractAddress === contractAddress) {
      const decoded = tx.contractCall.functionName !== undefined;
      const label = decoded
        ? tx.contractCall.functionName!
        : shortHex(tx.contractCall.rawFunctionId ?? tx.hash);
      chips.push({
        key: `${tx.hash}-call`,
        kind: "call",
        label,
        decoded,
        args: tx.contractCall.args ?? [],
        txHash: tx.hash,
      });
    }

    const events = tx.contractEvents ?? [];
    events.forEach((event, index) => {
      if (event.contractAddress !== contractAddress) return;
      const decoded = event.eventName !== undefined;
      const label = decoded
        ? event.eventName!
        : shortHex(event.rawEventId ?? tx.hash);
      chips.push({
        key: `${tx.hash}-event-${index}`,
        kind: "event",
        label,
        decoded,
        args: event.args ?? [],
        txHash: tx.hash,
      });
    });
  }

  return chips.slice(0, limit);
}

function sameArg(a: DecodedArgument, b: DecodedArgument): boolean {
  return a.name === b.name && a.value === b.value;
}

function sameChip(a: ContractActivityChip, b: ContractActivityChip): boolean {
  return (
    a.key === b.key &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.decoded === b.decoded &&
    a.txHash === b.txHash &&
    a.args.length === b.args.length &&
    a.args.every((arg, i) => sameArg(arg, b.args[i]))
  );
}

/**
 * 2つの活動チップ列が内容として同じか判定する（`isSameContractNode` から
 * 使う値比較。`deriveContractActivity` は毎回新しいオブジェクトを組み立てる
 * ため、参照比較ではなく内容比較にする。Issue #119 のちらつき対策）。
 */
export function sameContractActivity(
  a: readonly ContractActivityChip[],
  b: readonly ContractActivityChip[],
): boolean {
  return a.length === b.length && a.every((chip, i) => sameChip(chip, b[i]));
}
