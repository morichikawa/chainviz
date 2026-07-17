// SidePanelContext（Issue #321。汎用サイドパネル機構の状態管理）のテスト。
// シェル（SidePanel.tsx）・振り分け（SidePanelHost.tsx）は別ファイルに分ける
// （CLAUDE.md のテスト分割方針）。
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SidePanelProvider,
  useOptionalSidePanel,
  useSidePanel,
} from "./SidePanelContext.js";

afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return <SidePanelProvider>{children}</SidePanelProvider>;
}

describe("useSidePanel", () => {
  it("throws when used outside a SidePanelProvider (fails closed, not silently undefined)", () => {
    expect(() => renderHook(() => useSidePanel())).toThrow(
      /SidePanelProvider/,
    );
  });

  it("starts with no view open", () => {
    const { result } = renderHook(() => useSidePanel(), { wrapper });
    expect(result.current.view).toBeNull();
  });

  it("open() sets the view; close() clears it back to null", () => {
    const { result } = renderHook(() => useSidePanel(), { wrapper });
    act(() => {
      result.current.open({ kind: "contractSource", address: "0xabc" });
    });
    expect(result.current.view).toEqual({
      kind: "contractSource",
      address: "0xabc",
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.view).toBeNull();
  });

  it("open() replaces the currently open view (exclusive: at most one panel at a time)", () => {
    const { result } = renderHook(() => useSidePanel(), { wrapper });
    act(() => {
      result.current.open({ kind: "contractSource", address: "0x111" });
    });
    act(() => {
      result.current.open({ kind: "contractSource", address: "0x222" });
    });
    expect(result.current.view).toEqual({
      kind: "contractSource",
      address: "0x222",
    });
  });

  it("close() is harmless when no panel is open", () => {
    const { result } = renderHook(() => useSidePanel(), { wrapper });
    expect(() => {
      act(() => {
        result.current.close();
      });
    }).not.toThrow();
    expect(result.current.view).toBeNull();
  });
});

describe("useOptionalSidePanel (Issue #313)", () => {
  it("returns null outside a SidePanelProvider instead of throwing", () => {
    const { result } = renderHook(() => useOptionalSidePanel());
    expect(result.current).toBeNull();
  });

  it("returns the same live context value as useSidePanel() inside a SidePanelProvider", () => {
    const { result } = renderHook(() => useOptionalSidePanel(), { wrapper });
    expect(result.current).not.toBeNull();
    act(() => {
      result.current?.open({ kind: "glossary" });
    });
    expect(result.current?.view).toEqual({ kind: "glossary" });
  });
});
