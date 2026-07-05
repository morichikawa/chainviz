import type { TransactionEntity } from "@chainviz/shared";
import { useEffect, useRef, useState } from "react";
import { type TxStatus, detectTxSettlements, txStatusMap } from "./transaction.js";

/**
 * tx が確定した瞬間の「確定フラッシュ」演出を出しておく時間（ms）。
 * pending → included/failed への遷移を検知してからこの時間だけ、対象 tx を
 * 「確定演出中」の集合に載せる。純粋な遷移検知は `transaction.ts` が持ち、
 * ここは実時間へのスケジューリングと後片付けだけを担う（useBlockPulses と同型）。
 */
export const TX_SETTLE_FLASH_MS = 1400;

/**
 * トランザクションの status 更新を監視し、`pending` から確定へ変わった tx を
 * 一定時間だけ「確定演出中」として返すフック。返り値の Set に入っている間、
 * ウォレットカードはその tx チップに確定フラッシュを当てる。
 */
export function useTxLifecycle(
  txs: TransactionEntity[],
  flashMs: number = TX_SETTLE_FLASH_MS,
): ReadonlySet<string> {
  const [settling, setSettling] = useState<Set<string>>(() => new Set());

  // 直近に観測した hash -> status。遷移検知の基準にする。
  const prevRef = useRef<Map<string, TxStatus>>(new Map());
  // hash ごとの解除タイマー。連続確定でも上書きして最後の1本だけ残す。
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const next = txStatusMap(txs);
    const settled = detectTxSettlements(prevRef.current, next);
    prevRef.current = next;
    if (settled.length === 0) return;

    setSettling((cur) => {
      const updated = new Set(cur);
      for (const hash of settled) updated.add(hash);
      return updated;
    });

    const timers = timersRef.current;
    for (const hash of settled) {
      const existing = timers.get(hash);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timers.delete(hash);
        setSettling((cur) => {
          if (!cur.has(hash)) return cur;
          const updated = new Set(cur);
          updated.delete(hash);
          return updated;
        });
      }, flashMs);
      timers.set(hash, timer);
    }
  }, [txs, flashMs]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return settling;
}
