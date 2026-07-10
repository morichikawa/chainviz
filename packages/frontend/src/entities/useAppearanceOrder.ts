import { useEffect, useRef, useState } from "react";

/**
 * id 列を監視し、初めて見た id に単調増加のシーケンス番号を振っていく
 * フック（コントラクト一覧パネルの「出現順（新しいものが上）」表示に使う。
 * `docs/worklog/issue-211.md`「単位C」参照）。
 *
 * `useNewArrivalHighlight`（Issue #123）と同じ「id 集合の差分を検知する」
 * 骨格を使うが、狙いが違うため別モジュールに分ける:
 * - こちらは演出（一定時間だけ光らせる）を持たない。並び替えに使うだけの
 *   純粋な順序情報であり、時間経過で消えるタイマーが無い
 * - `ready` ゲートも持たない。最初のレンダーで渡された id 群にもその場で
 *   順序を振ってよい（`useNewArrivalHighlight` が最初のスナップショットを
 *   誤って「新着」と表示しないためのゲートを必要とするのとは事情が違う。
 *   一覧の並び順は「今ある行を何らかの順序で表示する」ことが目的で、
 *   誤検知による演出事故が起きない）
 *
 * 初回に渡された id 群は、その配列内の並び順どおりに 0, 1, 2, … を振る
 * （その時点で「本当の出現順」を示す情報がワールドステートに無いため。
 * `docs/worklog/issue-211.md`参照）。以後、新しく現れた id には既存の最大値
 * より大きい番号を振る。一度番号を振られた id は、途中で配列から消えて
 * 二度と現れなくても内部の記録からは消さない（メモリ上小さな Map が
 * 積み上がるだけで、実運用上問題になるほどの規模（デプロイされる
 * コントラクト数）を想定していない）。
 */
export function useAppearanceOrder(ids: string[]): ReadonlyMap<string, number> {
  const [order, setOrder] = useState<Map<string, number>>(() => new Map());
  const nextSeqRef = useRef(0);

  useEffect(() => {
    setOrder((current) => {
      let changed = false;
      const next = new Map(current);
      for (const id of ids) {
        if (next.has(id)) continue;
        next.set(id, nextSeqRef.current);
        nextSeqRef.current += 1;
        changed = true;
      }
      // 変化が無ければ同じ参照を返す(React はこれを見て再レンダーを起こさない)。
      return changed ? next : current;
    });
  }, [ids]);

  return order;
}
