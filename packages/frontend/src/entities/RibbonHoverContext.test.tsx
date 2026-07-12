import type { TransactionEntity } from "@chainviz/shared";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { RibbonHoverProvider, useRibbonHover } from "./RibbonHoverContext.js";

function tx(overrides: Partial<TransactionEntity> & { hash: string }): TransactionEntity {
  return {
    kind: "transaction",
    from: "0xAAA",
    to: "0xBBB",
    status: "included",
    ...overrides,
  };
}

function wrapper(transactions: TransactionEntity[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RibbonHoverProvider transactions={transactions}>
        {children}
      </RibbonHoverProvider>
    );
  };
}

describe("RibbonHoverContext", () => {
  it("throws when used outside a RibbonHoverProvider", () => {
    expect(() => renderHook(() => useRibbonHover())).toThrow(
      /RibbonHoverProvider/,
    );
  });

  it("starts with no hovered block and no highlighted addresses", () => {
    const { result } = renderHook(() => useRibbonHover(), {
      wrapper: wrapper([]),
    });
    expect(result.current.hoveredBlockHash).toBeNull();
    expect(result.current.highlightedAddresses.size).toBe(0);
  });

  it("forward: setHoveredBlockHash highlights addresses of tx in that block", () => {
    const txs = [
      tx({ hash: "0x1", blockHash: "0xb1", from: "0xAAA", to: "0xBBB" }),
      tx({ hash: "0x2", blockHash: "0xb2", from: "0xCCC", to: "0xDDD" }),
    ];
    const { result } = renderHook(() => useRibbonHover(), {
      wrapper: wrapper(txs),
    });

    act(() => result.current.setHoveredBlockHash("0xb1"));
    expect(result.current.hoveredBlockHash).toBe("0xb1");
    expect(result.current.highlightedAddresses).toEqual(
      new Set(["0xaaa", "0xbbb"]),
    );
  });

  it("reverse: setHoveredTxHash resolves the tx's blockHash and highlights the same set", () => {
    const txs = [
      tx({ hash: "0x1", blockHash: "0xb1", from: "0xAAA", to: "0xBBB" }),
    ];
    const { result } = renderHook(() => useRibbonHover(), {
      wrapper: wrapper(txs),
    });

    act(() => result.current.setHoveredTxHash("0x1"));
    expect(result.current.hoveredBlockHash).toBe("0xb1");
    expect(result.current.highlightedAddresses).toEqual(
      new Set(["0xaaa", "0xbbb"]),
    );
  });

  it("reverse: setHoveredTxHash with a pending tx (no blockHash) clears the hover", () => {
    const txs = [tx({ hash: "0x1", status: "pending", blockHash: undefined })];
    const { result } = renderHook(() => useRibbonHover(), {
      wrapper: wrapper(txs),
    });

    act(() => result.current.setHoveredTxHash("0x1"));
    expect(result.current.hoveredBlockHash).toBeNull();
    expect(result.current.highlightedAddresses.size).toBe(0);
  });

  it("reverse: setHoveredTxHash with an unknown tx hash clears the hover (no crash)", () => {
    const { result } = renderHook(() => useRibbonHover(), {
      wrapper: wrapper([]),
    });
    act(() => result.current.setHoveredTxHash("0xnope"));
    expect(result.current.hoveredBlockHash).toBeNull();
  });

  it("setHoveredBlockHash(null) / setHoveredTxHash(null) clears the hover", () => {
    const txs = [tx({ hash: "0x1", blockHash: "0xb1" })];
    const { result } = renderHook(() => useRibbonHover(), {
      wrapper: wrapper(txs),
    });
    act(() => result.current.setHoveredBlockHash("0xb1"));
    expect(result.current.hoveredBlockHash).toBe("0xb1");
    act(() => result.current.setHoveredTxHash(null));
    expect(result.current.hoveredBlockHash).toBeNull();
    expect(result.current.highlightedAddresses.size).toBe(0);
  });
});
