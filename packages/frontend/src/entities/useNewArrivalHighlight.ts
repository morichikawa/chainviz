import { useEffect, useRef, useState } from "react";

/**
 * 実カード到着からの新着強調をどれくらいの時間続けるか（Issue #123 UX設計
 * §4-4「実カード到着から約5秒間、カードのアウトラインを発光させる」）。
 * UI 上の演出時間という固定 UX 値であり、実行環境の状態から動的に導出する
 * 量ではない。
 */
export const NEW_ARRIVAL_HIGHLIGHT_DURATION_MS = 5000;

/**
 * インフラエンティティ（node / workbench）の id 列を監視し、新しく現れた id を
 * 一定時間だけ「新着」として強調表示するためのフック（Issue #123 UX設計
 * §4-4）。
 *
 * - `ready` が false の間は一切の判定を行わない（基準も確立しない）。呼び出し側
 *   （App.tsx）は、接続がまだ確立していない（＝最初のスナップショットが
 *   届いていない）間は `ready=false` を渡す。`ready` が初めて true になった
 *   時点の id 集合を「既知」の基準にし、以後それより新しく現れた id だけを
 *   新着とみなす。
 *
 *   この `ready` フラグが無いと、以下の理由で誤動作する（実際に発生し
 *   Playwright での目視確認で見つかった不具合）: world-state への接続は
 *   `useWorldState` 側の別の effect が非同期に行うため、マウント直後の
 *   最初のレンダーでは `entityIds` がまだ空で渡ってくる。「effect の初回
 *   呼び出しを基準にする」実装だと、この空の状態を基準にしてしまい、
 *   直後にスナップショットが届いた瞬間、初期表示のカード全部が「新着」と
 *   誤判定されてしまっていた。`entityIds` の中身だけでは「まだ接続前で
 *   空なのか」「接続済みで本当に0件なのか」を区別できないため、呼び出し側が
 *   知っている「接続済みかどうか」を明示的な引数として受け取る。
 * - 新着とみなした id は `durationMs` 経過後に自動で強調を解除する
 *   （useCommands のゴースト安全網タイマーと同じ、id ごとに独立したタイマー）。
 * - 純粋なデータ変換は持たない（「時間経過」という副作用に依存するため
 *   entities/*.ts の純粋関数には切り出せない）。
 */
export function useNewArrivalHighlight(
  entityIds: string[],
  ready: boolean,
  durationMs: number = NEW_ARRIVAL_HIGHLIGHT_DURATION_MS,
): Set<string> {
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  // null = まだ基準が確立していない（ready が初めて true になった時点で確立する）。
  const knownRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!ready) return; // 接続確立前は基準も判定も行わない

    const currentIds = new Set(entityIds);

    if (knownRef.current === null) {
      // ready になった直後の最初の呼び出しを基準にする（ハイライトしない）。
      knownRef.current = currentIds;
      return;
    }

    const known = knownRef.current;
    const arrived: string[] = [];
    for (const id of currentIds) {
      if (!known.has(id)) arrived.push(id);
    }
    knownRef.current = currentIds;
    if (arrived.length === 0) return;

    setHighlighted((current) => {
      const next = new Set(current);
      for (const id of arrived) next.add(id);
      return next;
    });

    const timers = timersRef.current;
    for (const id of arrived) {
      const timer = setTimeout(() => {
        timers.delete(id);
        setHighlighted((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, durationMs);
      timers.set(id, timer);
    }
  }, [entityIds, ready, durationMs]);

  // アンマウント時に残っているタイマーをまとめて破棄する。
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return highlighted;
}
