import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { TransactionEntity } from "@chainviz/shared";
import { deriveBlockRelatedAddresses } from "./blockRelations.js";

/**
 * チェーンリボンのタイルホバー連動ハイライト（Issue #298 第2段階。
 * ARCHITECTURE.md §9.1）用の React Context。
 *
 * `OperationDataContext.tsx` と同じ理由（React Flow ノードの内側から
 * キャンバス全体の一時的な状態へアクセスする）でノードの `data` には
 * 含めない。ホバーは高頻度・短命な派生状態であり、これを wallet/contract
 * ノードの `data` に埋め込むと `isSameWalletNode`/`isSameContractNode`
 * の比較（Issue #119 対策）の前提が崩れてしまう（対象外の値の変化のたびに
 * 「変化した」と誤判定される）ため、Context 経由でホバー時にだけ読みに行く。
 *
 * 双方向のホバー連動は「今ホバーされているブロックの hash」という単一の
 * 状態に一本化する:
 * - タイル → ウォレット/コントラクト（順方向）: リボンのタイルをホバーすると
 *   `setHoveredBlockHash(tile.block.hash)` を呼ぶ。`highlightedAddresses`
 *   （そのブロックの tx から導出したアドレス集合）を各カードが自分の
 *   address と突き合わせてハイライトする。
 * - tx チップ → タイル（逆方向）: ウォレット/コントラクトの tx/活動チップを
 *   ホバーすると `setHoveredTxHash(tx.hash)` を呼ぶ。ここで tx を
 *   blockHash へ解決し、内部的には順方向と同じ `hoveredBlockHash` を
 *   立てる（結果としてリボンのタイルも、他のカードも同時にハイライトされる）。
 */
export interface RibbonHoverValue {
  /** 現在ハイライト対象になっているブロックの hash（無ければ null）。 */
  hoveredBlockHash: string | null;
  /** リボンのタイルホバーから呼ぶ。 */
  setHoveredBlockHash: (hash: string | null) => void;
  /** ウォレット/コントラクトの tx・活動チップのホバーから呼ぶ。 */
  setHoveredTxHash: (txHash: string | null) => void;
  /** `hoveredBlockHash` のブロックに関連するアドレス（小文字正規化済み）。 */
  highlightedAddresses: ReadonlySet<string>;
}

const EMPTY_ADDRESSES: ReadonlySet<string> = new Set();

const RibbonHoverContext = createContext<RibbonHoverValue | null>(null);

export interface RibbonHoverProviderProps {
  /** ハイライト対象アドレスの導出元（App.tsx の C層 tx 一覧をそのまま渡す）。 */
  transactions: TransactionEntity[];
  children: ReactNode;
}

export function RibbonHoverProvider({
  transactions,
  children,
}: RibbonHoverProviderProps) {
  const [hoveredBlockHash, setHoveredBlockHash] = useState<string | null>(null);

  const txByHash = useMemo(() => {
    const map = new Map<string, TransactionEntity>();
    for (const tx of transactions) map.set(tx.hash, tx);
    return map;
  }, [transactions]);

  const setHoveredTxHash = useCallback(
    (txHash: string | null) => {
      if (txHash === null) {
        setHoveredBlockHash(null);
        return;
      }
      const tx = txByHash.get(txHash);
      // blockHash 未確定（pending）の tx は対応するタイルが無いためハイライト
      // しない（null に落とす。既存の「観測できなかったものは出さない」流儀）。
      setHoveredBlockHash(tx?.blockHash ?? null);
    },
    [txByHash],
  );

  const highlightedAddresses = useMemo(
    () =>
      hoveredBlockHash
        ? deriveBlockRelatedAddresses(hoveredBlockHash, transactions)
        : EMPTY_ADDRESSES,
    [hoveredBlockHash, transactions],
  );

  const value = useMemo<RibbonHoverValue>(
    () => ({
      hoveredBlockHash,
      setHoveredBlockHash,
      setHoveredTxHash,
      highlightedAddresses,
    }),
    [hoveredBlockHash, setHoveredTxHash, highlightedAddresses],
  );

  return (
    <RibbonHoverContext.Provider value={value}>
      {children}
    </RibbonHoverContext.Provider>
  );
}

/** Provider 配下でチェーンリボンのホバー連動状態を取り出す。 */
export function useRibbonHover(): RibbonHoverValue {
  const ctx = useContext(RibbonHoverContext);
  if (!ctx) {
    throw new Error("useRibbonHover must be used within a RibbonHoverProvider");
  }
  return ctx;
}
