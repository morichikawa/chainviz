import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { GhostNodeCard } from "./GhostNodeCard.js";
import { createGhostNode } from "./ghostNode.js";

afterEach(cleanup);

function renderGhost(
  data: ReturnType<typeof createGhostNode>["data"],
  language: "ja" | "en" = "ja",
) {
  const props = { data } as unknown as Parameters<typeof GhostNodeCard>[0];
  render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage={language}>
        <GhostNodeCard {...props} />
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

describe("GhostNodeCard", () => {
  it("renders a node ghost with the node kind label and pending status", () => {
    renderGhost({ commandId: "cmd-1", kind: "node", label: "ethereum" });
    const card = screen.getByTestId("ghost-card-cmd-1");
    expect(card.className).toContain("ghost-card");
    expect(card.className).toContain("ghost-card--node");
    expect(screen.getByText("ノード")).toBeTruthy();
    expect(screen.getByText("起動中…")).toBeTruthy();
    expect(screen.getByText("ethereum")).toBeTruthy();
  });

  it("renders a workbench ghost with the workbench kind label", () => {
    renderGhost({ commandId: "cmd-2", kind: "workbench", label: "Carol" });
    const card = screen.getByTestId("ghost-card-cmd-2");
    expect(card.className).toContain("ghost-card--workbench");
    expect(screen.getByText("ワークベンチ")).toBeTruthy();
    expect(screen.getByText("Carol")).toBeTruthy();
  });

  it("renders the English labels when the language is en", () => {
    renderGhost({ commandId: "cmd-3", kind: "node", label: "ethereum" }, "en");
    expect(screen.getByText("Node")).toBeTruthy();
    expect(screen.getByText("Starting…")).toBeTruthy();
  });

  it("marks the spinner decorative (aria-hidden) so it is not announced", () => {
    renderGhost({ commandId: "cmd-4", kind: "node", label: "ethereum" });
    const card = screen.getByTestId("ghost-card-cmd-4");
    const spinner = card.querySelector(".ghost-card__spinner");
    expect(spinner).not.toBeNull();
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders an empty label without crashing (whitespace-only / empty)", () => {
    expect(() =>
      renderGhost({ commandId: "cmd-5", kind: "workbench", label: "" }),
    ).not.toThrow();
    // ラベルが空でもカード自体は描画される。
    expect(screen.getByTestId("ghost-card-cmd-5")).toBeTruthy();
  });

  it("does not render any delete/remove control (ghosts are not directly cancelable)", () => {
    renderGhost({ commandId: "cmd-6", kind: "node", label: "ethereum" });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
