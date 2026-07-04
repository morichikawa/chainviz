import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ToastStack } from "./Toast.js";
import type { Notification } from "./notificationStore.js";

afterEach(cleanup);

function renderStack(notifications: Notification[], onDismiss = vi.fn()) {
  render(
    <LanguageProvider initialLanguage="ja">
      <ToastStack notifications={notifications} onDismiss={onDismiss} />
    </LanguageProvider>,
  );
  return onDismiss;
}

describe("ToastStack", () => {
  it("renders nothing when there are no notifications", () => {
    renderStack([]);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("renders each notification message", () => {
    renderStack([
      { id: "n1", kind: "error", message: "追加に失敗しました" },
      { id: "n2", kind: "error", message: "削除に失敗しました" },
    ]);
    expect(screen.getByText("追加に失敗しました")).toBeTruthy();
    expect(screen.getByText("削除に失敗しました")).toBeTruthy();
  });

  it("invokes onDismiss with the notification id when the close button is clicked", () => {
    const onDismiss = renderStack([
      { id: "n1", kind: "error", message: "boom" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onDismiss).toHaveBeenCalledWith("n1");
  });
});
