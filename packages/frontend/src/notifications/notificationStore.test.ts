import { describe, expect, it } from "vitest";
import {
  type Notification,
  addNotification,
  dismissNotification,
} from "./notificationStore.js";

describe("notificationStore", () => {
  it("appends a notification without mutating the input list", () => {
    const list: Notification[] = [];
    const next = addNotification(list, "n1", { kind: "error", message: "boom" });
    expect(next).toEqual([{ id: "n1", kind: "error", message: "boom" }]);
    expect(list).toEqual([]);
  });

  it("keeps existing notifications and appends to the end", () => {
    const list = addNotification([], "n1", { kind: "error", message: "a" });
    const next = addNotification(list, "n2", { kind: "info", message: "b" });
    expect(next.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("removes only the notification with the given id", () => {
    const list = addNotification(
      addNotification([], "n1", { kind: "error", message: "a" }),
      "n2",
      { kind: "error", message: "b" },
    );
    const next = dismissNotification(list, "n1");
    expect(next.map((n) => n.id)).toEqual(["n2"]);
  });

  it("returns an equivalent list when dismissing an unknown id", () => {
    const list = addNotification([], "n1", { kind: "error", message: "a" });
    expect(dismissNotification(list, "missing")).toEqual(list);
  });

  it("keeps duplicate messages as distinct entries when ids differ", () => {
    const list = addNotification([], "n1", { kind: "error", message: "boom" });
    const next = addNotification(list, "n2", { kind: "error", message: "boom" });
    expect(next).toEqual([
      { id: "n1", kind: "error", message: "boom" },
      { id: "n2", kind: "error", message: "boom" },
    ]);
  });

  it("appends a large number of notifications in order without mutation", () => {
    let list: Notification[] = [];
    for (let i = 0; i < 200; i++) {
      const prev = list;
      list = addNotification(list, `n${i}`, { kind: "info", message: `m${i}` });
      // 毎回新しい配列を返し、元を破壊しない。
      expect(list).not.toBe(prev);
    }
    expect(list).toHaveLength(200);
    expect(list[0].id).toBe("n0");
    expect(list[199].id).toBe("n199");
  });

  it("removes every entry sharing an id (defensive against duplicate ids)", () => {
    const list: Notification[] = [
      { id: "dup", kind: "error", message: "a" },
      { id: "keep", kind: "info", message: "b" },
      { id: "dup", kind: "error", message: "c" },
    ];
    expect(dismissNotification(list, "dup").map((n) => n.id)).toEqual(["keep"]);
  });

  it("returns an empty list unchanged when dismissing from it", () => {
    expect(dismissNotification([], "n1")).toEqual([]);
  });
});
