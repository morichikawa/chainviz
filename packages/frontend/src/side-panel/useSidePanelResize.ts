/**
 * サイドパネルの幅リサイズ操作（Issue #362、docs/worklog/issue-362.md）。
 *
 * ドラッグは `setPointerCapture` を使わず window リスナー方式にする
 * （jsdom は `setPointerCapture` を実装しておらず、window リスナー方式の
 * ほうがテストで素直に発火できるため）。パネルは `position: absolute;
 * right: 0` で右ドックしているため、ハンドルを左へドラッグ（clientX が
 * 減る）すると幅が広がる: `新しい幅 = 開始幅 + (開始X − 現在X)`。
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { KeyValueStorage } from "../platform/storage.js";
import {
  clampSidePanelWidth,
  loadSidePanelWidth,
  saveSidePanelWidth,
  sidePanelMaxWidth,
  SIDE_PANEL_MIN_WIDTH,
} from "./sidePanelWidth.js";

/** キーボード操作（←→キー）1打鍵あたりの変化量。 */
const KEYBOARD_STEP = 24;

function getViewportWidth(): number {
  return typeof window !== "undefined" ? window.innerWidth : SIDE_PANEL_MIN_WIDTH;
}

interface DragState {
  startX: number;
  startWidth: number;
}

/** ハンドル要素にそのまま spread できる、a11y 属性 + イベントハンドラ一式。 */
export interface SidePanelResizeHandleProps {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-valuenow": number;
  "aria-valuemin": number;
  "aria-valuemax": number;
  tabIndex: number;
  onPointerDown: (event: ReactPointerEvent) => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
}

export interface UseSidePanelResizeResult {
  /** 現在の幅（px）。 */
  width: number;
  /** ドラッグ中かどうか（ハンドルの視覚フィードバックに使う）。 */
  resizing: boolean;
  handleProps: SidePanelResizeHandleProps;
}

/**
 * サイドパネルの幅リサイズの状態管理一式。`storage` は呼び出し側
 * （`SidePanel.tsx`）が `LanguageProvider` と同じパターンで一度だけ解決
 * してから渡す想定（このフック自体は既定値解決を持たない）。
 */
export function useSidePanelResize(storage: KeyValueStorage): UseSidePanelResizeResult {
  const [width, setWidth] = useState<number>(() =>
    loadSidePanelWidth(storage, getViewportWidth()),
  );
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!resizing) return;

    function resolveWidth(clientX: number, drag: DragState): number {
      return clampSidePanelWidth(drag.startWidth + (drag.startX - clientX), getViewportWidth());
    }

    function handlePointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      setWidth(resolveWidth(event.clientX, drag));
    }

    function handlePointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (drag) {
        const next = resolveWidth(event.clientX, drag);
        setWidth(next);
        saveSidePanelWidth(storage, next);
      }
      dragRef.current = null;
      setResizing(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizing, storage]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent) => {
      dragRef.current = { startX: event.clientX, startWidth: width };
      setResizing(true);
    },
    [width],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      let delta = 0;
      if (event.key === "ArrowLeft") delta = KEYBOARD_STEP;
      else if (event.key === "ArrowRight") delta = -KEYBOARD_STEP;
      else return;
      event.preventDefault();
      setWidth((current) => {
        const next = clampSidePanelWidth(current + delta, getViewportWidth());
        saveSidePanelWidth(storage, next);
        return next;
      });
    },
    [storage],
  );

  const viewportWidth = getViewportWidth();

  return {
    width,
    resizing,
    handleProps: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-valuenow": Math.round(width),
      "aria-valuemin": SIDE_PANEL_MIN_WIDTH,
      "aria-valuemax": Math.round(sidePanelMaxWidth(viewportWidth)),
      tabIndex: 0,
      onPointerDown: handlePointerDown,
      onKeyDown: handleKeyDown,
    },
  };
}
