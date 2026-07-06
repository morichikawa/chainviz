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
