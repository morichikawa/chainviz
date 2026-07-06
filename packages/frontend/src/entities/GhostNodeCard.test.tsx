import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { GhostNodeCard } from "./GhostNodeCard.js";
import { createGhostNode } from "./ghostNode.js";

afterEach(cleanup);

function renderGhost(data: ReturnType<typeof createGhostNode>["data"]) {
  const props = { data } as unknown as Parameters<typeof GhostNodeCard>[0];
  render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
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
});
