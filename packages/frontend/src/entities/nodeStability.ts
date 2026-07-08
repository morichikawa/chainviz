import type { Node } from "@xyflow/react";

/**
 * ノード配列の要素を、内容が変わっていないものは前回と同一オブジェクト参照に
 * 差し替える純粋関数(Issue #119)。
 *
 * React Flow は内部で「渡されたノードオブジェクトの参照が前回と同じか」
 * (`@xyflow/system` の `adoptUserNodes` 内の参照比較)によって、そのノードの
 * `measured`(実測 width/height)を引き継げるかを判定している。
 * `entitiesToFlowNodes` / `walletsToFlowNodes` はワールドステート更新の
 * たびに全ノードを新しいオブジェクトとして作り直すため、内容が何も
 * 変わっていないノードまで毎回「参照が変わった」と判定され、`measured` が
 * リセットされて一瞬 visibility: hidden の再計測サイクルに入ってしまう
 * (ノードカードのちらつきの原因)。
 *
 * `id` をキーに前回のノードと突き合わせ、`isSameContent` が true を返す要素は
 * 前回のオブジェクトをそのまま返す。配列全体が完全に前回と同一(要素の参照・
 * 並び順とも変化なし)だった場合は、配列自体も前回の参照を返す(呼び出し元の
 * `useMemo` チェーンや、React Flow へ渡す `nodes` prop を受け取る側の
 * `useEffect` の依存配列比較でも下流の再計算を避けられる)。
 */
export function stabilizeNodes<TNode extends Node>(
  nextNodes: TNode[],
  previousNodes: TNode[],
  isSameContent: (previous: TNode, next: TNode) => boolean,
): TNode[] {
  if (previousNodes.length === 0) return nextNodes;

  const previousById = new Map(previousNodes.map((node) => [node.id, node]));
  let identical = previousNodes.length === nextNodes.length;

  const stabilized = nextNodes.map((next, index) => {
    const previous = previousById.get(next.id);
    if (previous && isSameContent(previous, next)) {
      if (identical && previousNodes[index] !== previous) identical = false;
      return previous;
    }
    identical = false;
    return next;
  });

  return identical ? previousNodes : stabilized;
}

/** 配列の各要素が同じ位置に同じ参照で並んでいるか(参照比較のみ)。 */
export function sameByReference<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

/**
 * `next` の全要素が `previous` と参照レベルで完全一致(`sameByReference`)する
 * なら `previous` をそのまま返し、そうでなければ `next` を返す純粋関数
 * (Issue #166 差し戻し対応)。
 *
 * `entities.filter(...)` のように呼ぶたびに新しい配列を作る変換の出力を、
 * 中身の要素が実質変わっていない場合に限り配列自体の参照まで安定させたい
 * ときに使う。`stabilizeNodes` と違い要素自体は作り直さない（要素の同一性は
 * 呼び出し元の元データ側に委ねる）。
 *
 * 使用例(Issue #166): App.tsx の `contracts`（`entities.filter(isContractEntity)`
 * の出力）をこの関数で安定化すると、そこから作る `contractsByAddress`
 * （`useMemo(() => new Map(...), [contracts])`）の Map インスタンスまで参照が
 * 安定する。これにより walletNode.ts の `isSameWalletNode` が
 * `contractsByAddress` の参照比較で誤って「変化した」と判定し、Issue #119 の
 * 参照安定化（ウォレットカードの不要な再レンダー防止）を無効化する問題を防ぐ。
 */
export function stabilizeArrayReference<T>(next: T[], previous: T[]): T[] {
  return sameByReference(next, previous) ? previous : next;
}
