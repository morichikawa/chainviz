import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useNotifications } from "./useNotifications.js";

afterEach(cleanup);

describe("useNotifications", () => {
  it("adds notifications with unique ids and returns them", () => {
    const { result } = renderHook(() => useNotifications());

    let firstId = "";
    let secondId = "";
    act(() => {
      firstId = result.current.notify({ kind: "error", message: "a" });
    });
    act(() => {
      secondId = result.current.notify({ kind: "info", message: "b" });
    });

    expect(firstId).not.toBe(secondId);
    expect(result.current.notifications.map((n) => n.message)).toEqual(["a", "b"]);
  });

  it("dismisses a notification by id", () => {
    const { result } = renderHook(() => useNotifications());

    let id = "";
    act(() => {
      id = result.current.notify({ kind: "error", message: "a" });
    });
    act(() => {
      result.current.dismiss(id);
    });

    expect(result.current.notifications).toEqual([]);
  });

  it("assigns unique ids to duplicate messages and keeps both", () => {
    const { result } = renderHook(() => useNotifications());

    let firstId = "";
    let secondId = "";
    act(() => {
      firstId = result.current.notify({ kind: "error", message: "same" });
    });
    act(() => {
      secondId = result.current.notify({ kind: "error", message: "same" });
    });

    expect(firstId).not.toBe(secondId);
    expect(result.current.notifications.map((n) => n.message)).toEqual([
      "same",
      "same",
    ]);
  });

  it("keeps ids unique after dismissing so a repeated message re-appears", () => {
    const { result } = renderHook(() => useNotifications());

    let firstId = "";
    act(() => {
      firstId = result.current.notify({ kind: "error", message: "boom" });
    });
    act(() => {
      result.current.dismiss(firstId);
    });

    // 手動クローズ後、同じ内容の通知が再度来ても新しい id が振られて再表示される。
    let secondId = "";
    act(() => {
      secondId = result.current.notify({ kind: "error", message: "boom" });
    });

    expect(secondId).not.toBe(firstId);
    expect(result.current.notifications).toEqual([
      { id: secondId, kind: "error", message: "boom" },
    ]);
  });

  it("stacks a large burst of notifications with monotonically unique ids", () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      for (let i = 0; i < 50; i++) {
        result.current.notify({ kind: "error", message: `m${i}` });
      }
    });

    const ids = result.current.notifications.map((n) => n.id);
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    expect(result.current.notifications[0].message).toBe("m0");
    expect(result.current.notifications[49].message).toBe("m49");
  });

  it("keeps notify/dismiss references stable across renders", () => {
    const { result, rerender } = renderHook(() => useNotifications());
    const firstNotify = result.current.notify;
    const firstDismiss = result.current.dismiss;
    rerender();
    expect(result.current.notify).toBe(firstNotify);
    expect(result.current.dismiss).toBe(firstDismiss);
  });

  it("ignores a dismiss for an unknown id", () => {
    const { result } = renderHook(() => useNotifications());
    act(() => {
      result.current.notify({ kind: "error", message: "a" });
    });
    act(() => {
      result.current.dismiss("does-not-exist");
    });
    expect(result.current.notifications.map((n) => n.message)).toEqual(["a"]);
  });
});
