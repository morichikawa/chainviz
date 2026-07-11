import type { ContractEntity, TransactionEntity } from "@chainviz/shared";
import { useEffect, useRef, useState } from "react";
import {
  addContractCallPulse,
  buildContractCallPulseEdge,
  CONTRACT_CALL_PULSE_DURATION_MS,
  type ContractCallPulse,
  type ContractCallPulseFlowEdge,
  removeContractCallPulse,
} from "./contractCallPulseEdge.js";
import { resolveContractSettlementEvents } from "./contractSettlement.js";
import {
  detectTxSettlements,
  indexTransactions,
  txStatusMap,
  type TxStatus,
} from "./transaction.js";
import { TX_SETTLE_FLASH_MS } from "./useTxLifecycle.js";

/** コントラクトカードへ当てる確定フラッシュの種別。tx が失敗していれば失敗色。 */
export type ContractFlashKind = "success" | "failed";

export interface ContractSettlementEffects {
  /** 現在描画中のウォレット→コントラクトパルスエッジ。 */
  pulseEdges: ContractCallPulseFlowEdge[];
  /** コントラクトアドレス -> 現在の確定フラッシュ種別。フラッシュ中でなければ未登録。 */
  flashing: ReadonlyMap<string, ContractFlashKind>;
}

/**
 * tx確定を監視し、(1) 対象コントラクトへウォレットからの揮発パルスを1本
 * 走らせ、(2) パルス完了のタイミングでコントラクトカードへ確定フラッシュを
 * 当てる（ARCHITECTURE.md §6.6「確定時のコントラクトへのパルス」）。
 *
 * - ウォレットカードが不在（追跡外アドレスからの呼び出し）ならパルスを
 *   省き、フラッシュのみ即座に当てる。
 * - 対象コントラクトが不在なら何もしない（ダングリングガード。判定自体は
 *   `resolveContractSettlementEvents` が担う）。
 * - 遷移検知は `useTxLifecycle` と同じ `detectTxSettlements`
 *   （pending → included/failed）を使うため、pending を経ずに確定を
 *   観測した tx は対象外になる制約も共通（既存の仕様どおり）。
 */
export function useContractSettlementEffects(
  transactions: TransactionEntity[],
  contracts: ContractEntity[],
  presentWalletIds: ReadonlySet<string>,
): ContractSettlementEffects {
  const [pulseEdges, setPulseEdges] = useState<ContractCallPulseFlowEdge[]>([]);
  const [flashing, setFlashing] = useState<Map<string, ContractFlashKind>>(
    () => new Map(),
  );

  // 直近に観測した hash -> status。遷移検知の基準にする（useTxLifecycle と同型）。
  const prevStatusRef = useRef<Map<string, TxStatus>>(new Map());
  const pulseTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const flashTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const seqRef = useRef(0);

  useEffect(() => {
    const nextStatus = txStatusMap(transactions);
    const settled = detectTxSettlements(prevStatusRef.current, nextStatus);
    prevStatusRef.current = nextStatus;
    if (settled.length === 0) return;

    const txByHash = indexTransactions(transactions);
    const events = resolveContractSettlementEvents(settled, txByHash, contracts);
    if (events.length === 0) return;

    const presentContractIds = new Set(contracts.map((c) => c.address));
    const pulseTimers = pulseTimersRef.current;
    const flashTimers = flashTimersRef.current;

    const applyFlash = (contractAddress: string, kind: ContractFlashKind) => {
      setFlashing((cur) => {
        const updated = new Map(cur);
        updated.set(contractAddress, kind);
        return updated;
      });
      const existing = flashTimers.get(contractAddress);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        flashTimers.delete(contractAddress);
        setFlashing((cur) => {
          if (!cur.has(contractAddress)) return cur;
          const updated = new Map(cur);
          updated.delete(contractAddress);
          return updated;
        });
      }, TX_SETTLE_FLASH_MS);
      flashTimers.set(contractAddress, timer);
    };

    for (const event of events) {
      const kind: ContractFlashKind = event.failed ? "failed" : "success";
      // ウォレット・コントラクトの存在判定（大文字小文字を無視した照合を
      // 含む）は buildContractCallPulseEdge 自身に委ねる（Issue #232:
      // 以前はここで `presentWalletIds.has(event.fromAddress)` を単純な
      // 文字列一致で事前判定しており、チェックサム表記と生の表記の食い違い
      // で常にウォレット不在と誤判定していた）。
      const base = buildContractCallPulseEdge(
        event.fromAddress,
        event.contractAddress,
        presentWalletIds,
        presentContractIds,
      );

      if (!base) {
        // ウォレットが不在（またはビルド不能）→ パルスを省きフラッシュのみ。
        applyFlash(event.contractAddress, kind);
        continue;
      }

      const seq = seqRef.current++;
      const pulse: ContractCallPulse = {
        key: `contract-call-pulse-${seq}`,
        durationMs: CONTRACT_CALL_PULSE_DURATION_MS,
      };
      setPulseEdges((cur) => addContractCallPulse(cur, base, pulse));

      const timer = setTimeout(() => {
        pulseTimers.delete(timer);
        setPulseEdges((cur) => removeContractCallPulse(cur, base.id, pulse.key));
        applyFlash(event.contractAddress, kind);
      }, pulse.durationMs);
      pulseTimers.add(timer);
    }
  }, [transactions, contracts, presentWalletIds]);

  useEffect(() => {
    const pulseTimers = pulseTimersRef.current;
    const flashTimers = flashTimersRef.current;
    return () => {
      for (const timer of pulseTimers) clearTimeout(timer);
      pulseTimers.clear();
      for (const timer of flashTimers.values()) clearTimeout(timer);
      flashTimers.clear();
    };
  }, []);

  return { pulseEdges, flashing };
}
