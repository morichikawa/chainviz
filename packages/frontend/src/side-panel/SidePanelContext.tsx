import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { SidePanelView } from "./sidePanelView.js";

interface SidePanelContextValue {
  /** 現在表示中のパネル。無ければ null（既定）。 */
  view: SidePanelView | null;
  /** パネルを開く。表示中のパネルがあれば置き換える（同時1枚・排他）。 */
  open: (view: SidePanelView) => void;
  /** パネルを閉じる。閉じている状態で呼んでも無害。 */
  close: () => void;
}

const SidePanelContext = createContext<SidePanelContextValue | null>(null);

/**
 * 汎用サイドパネル機構の状態管理（Issue #321。
 * docs/ARCHITECTURE.md §12.2）。`ContractCard` のようにパネルの
 * トリガーを持つコンポーネントと、実際にパネルを描画する
 * `SidePanelHost`（世界の状態から表示対象を引ける位置に置く）の両方から
 * `useSidePanel()` で同じ状態を参照できるようにするための Context。
 * `RibbonHoverProvider` / `OperationDataProvider` と同じ「App.tsx が
 * Canvas を包む位置に置く」パターン。
 */
export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<SidePanelView | null>(null);
  const open = useCallback((next: SidePanelView) => setView(next), []);
  const close = useCallback(() => setView(null), []);
  const value = useMemo<SidePanelContextValue>(
    () => ({ view, open, close }),
    [view, open, close],
  );
  return (
    <SidePanelContext.Provider value={value}>
      {children}
    </SidePanelContext.Provider>
  );
}

export function useSidePanel(): SidePanelContextValue {
  const ctx = useContext(SidePanelContext);
  if (!ctx) {
    throw new Error("useSidePanel must be used within a SidePanelProvider");
  }
  return ctx;
}
