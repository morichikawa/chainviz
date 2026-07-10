import type { ContractEntity, TransactionEntity } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_CALL_PULSE_DURATION_MS } from "./contractCallPulseEdge.js";
import { useContractSettlementEffects } from "./useContractSettlementEffects.js";
import { TX_SETTLE_FLASH_MS } from "./useTxLifecycle.js";

const ALICE = "0xalice";
const TOKEN = "0xtoken";

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0xhash",
    from: ALICE,
    to: TOKEN,
    status: "pending",
    ...overrides,
  };
}

function contract(address = TOKEN): ContractEntity {
  return { kind: "contract", address, chainType: "ethereum" };
}

function callTx(status: TransactionEntity["status"]): TransactionEntity {
  return tx({
    status,
    blockHash: status === "pending" ? undefined : "0xb1",
    contractCall: { contractAddress: TOKEN, functionName: "transfer" },
  });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useContractSettlementEffects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts with no pulse edges and no flashing", () => {
    const { result } = renderHook(() =>
      useContractSettlementEffects([], [], new Set()),
    );
    expect(result.current.pulseEdges).toEqual([]);
    expect(result.current.flashing.size).toBe(0);
  });

  it("does nothing while the tx is still pending", () => {
    const { result } = renderHook(() =>
      useContractSettlementEffects([callTx("pending")], [contract()], new Set([ALICE])),
    );
    advance(0);
    expect(result.current.pulseEdges).toEqual([]);
    expect(result.current.flashing.size).toBe(0);
  });

  it("streams a wallet->contract pulse when a call tx settles and the wallet is present", () => {
    const { result, rerender } = renderHook(
      ({ txs }) =>
        useContractSettlementEffects(txs, [contract()], new Set([ALICE])),
      { initialProps: { txs: [callTx("pending")] } },
    );
    advance(0);
    rerender({ txs: [callTx("included")] });
    advance(0);

    expect(result.current.pulseEdges).toHaveLength(1);
    expect(result.current.pulseEdges[0]).toMatchObject({
      source: ALICE,
      target: TOKEN,
    });
    // フラッシュはパルス完了後に当たる。まだ完了していない時点では未登録。
    expect(result.current.flashing.get(TOKEN)).toBeUndefined();
  });

  it("removes the pulse and applies a success flash once the pulse duration elapses", () => {
    const { result, rerender } = renderHook(
      ({ txs }) =>
        useContractSettlementEffects(txs, [contract()], new Set([ALICE])),
      { initialProps: { txs: [callTx("pending")] } },
    );
    advance(0);
    rerender({ txs: [callTx("included")] });
    advance(0);
    expect(result.current.pulseEdges).toHaveLength(1);

    advance(CONTRACT_CALL_PULSE_DURATION_MS);
    expect(result.current.pulseEdges).toHaveLength(0);
    expect(result.current.flashing.get(TOKEN)).toBe("success");
  });

  it("clears the flash after TX_SETTLE_FLASH_MS", () => {
    const { result, rerender } = renderHook(
      ({ txs }) =>
        useContractSettlementEffects(txs, [contract()], new Set([ALICE])),
      { initialProps: { txs: [callTx("pending")] } },
    );
    advance(0);
    rerender({ txs: [callTx("included")] });
    advance(0);
    advance(CONTRACT_CALL_PULSE_DURATION_MS);
    expect(result.current.flashing.get(TOKEN)).toBe("success");

    advance(TX_SETTLE_FLASH_MS);
    expect(result.current.flashing.has(TOKEN)).toBe(false);
  });

  it("uses a failed flash kind for a tx that settles as failed", () => {
    const { result, rerender } = renderHook(
      ({ txs }) =>
        useContractSettlementEffects(txs, [contract()], new Set([ALICE])),
      { initialProps: { txs: [callTx("pending")] } },
    );
    advance(0);
    rerender({ txs: [callTx("failed")] });
    advance(0);
    advance(CONTRACT_CALL_PULSE_DURATION_MS);
    expect(result.current.flashing.get(TOKEN)).toBe("failed");
  });

  it("skips the pulse and flashes immediately when the wallet is not present (dangling)", () => {
    const { result, rerender } = renderHook(
      ({ txs }) =>
        useContractSettlementEffects(txs, [contract()], new Set()), // ウォレット不在
      { initialProps: { txs: [callTx("pending")] } },
    );
    advance(0);
    rerender({ txs: [callTx("included")] });
    advance(0);

    expect(result.current.pulseEdges).toEqual([]);
    expect(result.current.flashing.get(TOKEN)).toBe("success");
  });

  it("does nothing when the target contract is not present (dangling)", () => {
    const { result, rerender } = renderHook(
      ({ txs }) => useContractSettlementEffects(txs, [], new Set([ALICE])), // コントラクト不在
      { initialProps: { txs: [callTx("pending")] } },
    );
    advance(0);
    rerender({ txs: [callTx("included")] });
    advance(0);
    advance(CONTRACT_CALL_PULSE_DURATION_MS);

    expect(result.current.pulseEdges).toEqual([]);
    expect(result.current.flashing.size).toBe(0);
  });

  it("triggers a pulse+flash for a deploy tx (createdContractAddress)", () => {
    const deployTx = (status: TransactionEntity["status"]) =>
      tx({
        status,
        to: null,
        blockHash: status === "pending" ? undefined : "0xb1",
        createdContractAddress: TOKEN,
        contractCall: undefined,
      });
    const { result, rerender } = renderHook(
      ({ txs }) =>
        useContractSettlementEffects(txs, [contract()], new Set([ALICE])),
      { initialProps: { txs: [deployTx("pending")] } },
    );
    advance(0);
    rerender({ txs: [deployTx("included")] });
    advance(0);
    expect(result.current.pulseEdges).toHaveLength(1);
    advance(CONTRACT_CALL_PULSE_DURATION_MS);
    expect(result.current.flashing.get(TOKEN)).toBe("success");
  });

  it("does not re-trigger for a tx observed as already included (never pending)", () => {
    // detectTxSettlements と同じ制約: pending を経ずに確定を観測した tx は
    // 「遷移」として検知されない（useTxLifecycle と同じ仕様）。
    const { result } = renderHook(() =>
      useContractSettlementEffects(
        [callTx("included")],
        [contract()],
        new Set([ALICE]),
      ),
    );
    advance(0);
    expect(result.current.pulseEdges).toEqual([]);
    expect(result.current.flashing.size).toBe(0);
  });

  it("handles multiple concurrent settlements across distinct contracts", () => {
    const TOKEN2 = "0xtoken2";
    const other = (status: TransactionEntity["status"]) =>
      tx({
        hash: "0xother",
        status,
        to: TOKEN2,
        blockHash: status === "pending" ? undefined : "0xb1",
        contractCall: { contractAddress: TOKEN2, functionName: "mint" },
      });
    const { result, rerender } = renderHook(
      ({ txs }) =>
        useContractSettlementEffects(
          txs,
          [contract(TOKEN), contract(TOKEN2)],
          new Set([ALICE]),
        ),
      { initialProps: { txs: [callTx("pending"), other("pending")] } },
    );
    advance(0);
    rerender({ txs: [callTx("included"), other("included")] });
    advance(0);
    expect(result.current.pulseEdges).toHaveLength(2);
    advance(CONTRACT_CALL_PULSE_DURATION_MS);
    expect(result.current.flashing.get(TOKEN)).toBe("success");
    expect(result.current.flashing.get(TOKEN2)).toBe("success");
  });

  it("stacks two pulses on one edge when two txs to the same contract settle in one tick", () => {
    const callN = (hash: string, status: TransactionEntity["status"]) =>
      tx({
        hash,
        status,
        blockHash: status === "pending" ? undefined : "0xb1",
        contractCall: { contractAddress: TOKEN, functionName: "transfer" },
      });
    const { result, rerender } = renderHook(
      ({ txs }) =>
        useContractSettlementEffects(txs, [contract()], new Set([ALICE])),
      {
        initialProps: {
          txs: [callN("0xh1", "pending"), callN("0xh2", "pending")],
        },
      },
    );
    advance(0);
    rerender({ txs: [callN("0xh1", "included"), callN("0xh2", "included")] });
    advance(0);

    // 同じウォレット→同じコントラクトなのでエッジは1本、パルスは2本。
    expect(result.current.pulseEdges).toHaveLength(1);
    expect(result.current.pulseEdges[0].data?.pulses).toHaveLength(2);

    advance(CONTRACT_CALL_PULSE_DURATION_MS);
    // 両パルスが渡り切るとエッジごと消え、フラッシュが当たる。
    expect(result.current.pulseEdges).toEqual([]);
    expect(result.current.flashing.get(TOKEN)).toBe("success");
  });

  it("resets the flash timer when the same contract settles again while already flashing", () => {
    // ウォレット不在にしてフラッシュを即時に当て、フラッシュ実行中に別tx確定が
    // 来たときにタイマーが張り直されることを確認する（重複・競合の扱い）。
    const callN = (hash: string, status: TransactionEntity["status"]) =>
      tx({
        hash,
        status,
        blockHash: status === "pending" ? undefined : "0xb1",
        contractCall: { contractAddress: TOKEN, functionName: "transfer" },
      });
    const { result, rerender } = renderHook(
      ({ txs }) => useContractSettlementEffects(txs, [contract()], new Set()),
      { initialProps: { txs: [callN("0xh1", "pending")] } },
    );
    advance(0);
    rerender({ txs: [callN("0xh1", "included")] });
    advance(0);
    expect(result.current.flashing.get(TOKEN)).toBe("success");

    // フラッシュ期限の直前まで進める。
    advance(TX_SETTLE_FLASH_MS - 100);
    expect(result.current.flashing.get(TOKEN)).toBe("success");

    // 2 本目の tx が同じコントラクトで確定 → フラッシュタイマーを張り直す。
    rerender({ txs: [callN("0xh1", "included"), callN("0xh2", "pending")] });
    advance(0);
    rerender({ txs: [callN("0xh1", "included"), callN("0xh2", "included")] });
    advance(0);

    // 元のタイマーが切れるはずだった時点を越えてもフラッシュは継続している。
    advance(100);
    expect(result.current.flashing.get(TOKEN)).toBe("success");

    // 張り直したタイマーが切れるとフラッシュは消える。
    advance(TX_SETTLE_FLASH_MS - 100);
    expect(result.current.flashing.has(TOKEN)).toBe(false);
  });

  it("upgrades an active success flash to failed when a failed tx settles for the same contract", () => {
    const callN = (
      hash: string,
      status: TransactionEntity["status"],
    ): TransactionEntity =>
      tx({
        hash,
        status,
        blockHash: status === "pending" ? undefined : "0xb1",
        contractCall: { contractAddress: TOKEN, functionName: "transfer" },
      });
    const { result, rerender } = renderHook(
      ({ txs }) => useContractSettlementEffects(txs, [contract()], new Set()),
      { initialProps: { txs: [callN("0xh1", "pending")] } },
    );
    advance(0);
    rerender({ txs: [callN("0xh1", "included")] });
    advance(0);
    expect(result.current.flashing.get(TOKEN)).toBe("success");

    rerender({ txs: [callN("0xh1", "included"), callN("0xh2", "pending")] });
    advance(0);
    rerender({ txs: [callN("0xh1", "included"), callN("0xh2", "failed")] });
    advance(0);
    // 直近の確定が失敗なら、実行中のフラッシュ種別も失敗色へ更新される。
    expect(result.current.flashing.get(TOKEN)).toBe("failed");
  });

  it("clears pending timers on unmount without throwing", () => {
    const { rerender, unmount } = renderHook(
      ({ txs }) =>
        useContractSettlementEffects(txs, [contract()], new Set([ALICE])),
      { initialProps: { txs: [callTx("pending")] } },
    );
    advance(0);
    rerender({ txs: [callTx("included")] });
    advance(0);
    unmount();
    expect(() => advance(CONTRACT_CALL_PULSE_DURATION_MS + TX_SETTLE_FLASH_MS)).not.toThrow();
  });

  it("streams a wallet->contract pulse even when tx.from differs in case from the tracked wallet id (Issue #232)", () => {
    // tx.from はチェーン側の生の表記(小文字)、presentWalletIds(WalletEntity.address)
    // はEIP-55チェックサム表記になりうる想定の再現。
    const CHECKSUMMED_ALICE = "0xAlIcE";
    const callFrom = (status: TransactionEntity["status"]) =>
      tx({
        status,
        from: ALICE, // 生の表記(小文字)
        blockHash: status === "pending" ? undefined : "0xb1",
        contractCall: { contractAddress: TOKEN, functionName: "transfer" },
      });
    const { result, rerender } = renderHook(
      ({ txs }) =>
        useContractSettlementEffects(
          txs,
          [contract()],
          new Set([CHECKSUMMED_ALICE]), // 表記の異なるウォレットid
        ),
      { initialProps: { txs: [callFrom("pending")] } },
    );
    advance(0);
    rerender({ txs: [callFrom("included")] });
    advance(0);

    // ウォレットは(表記違いだが)実際には存在するため、フラッシュのみへ
    // フォールバックせずパルスエッジが描かれるべき。
    expect(result.current.pulseEdges).toHaveLength(1);
    expect(result.current.pulseEdges[0]).toMatchObject({
      source: CHECKSUMMED_ALICE,
      target: TOKEN,
    });
  });
});
