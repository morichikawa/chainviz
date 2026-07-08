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

  describe("layer-specific name + connection target subtitle (Issue #123)", () => {
    it("shows the execution-layer name instead of the raw chainProfile label", () => {
      renderGhost({
        commandId: "cmd-7",
        kind: "node",
        label: "ethereum",
        layer: "execution",
      });
      expect(screen.getByText("新しいノード (reth)")).toBeTruthy();
      expect(screen.queryByText("ethereum")).toBeNull();
    });

    it("shows the consensus-layer name", () => {
      renderGhost({
        commandId: "cmd-8",
        kind: "node",
        label: "ethereum",
        layer: "consensus",
      });
      expect(screen.getByText("新しいノード (beacon)")).toBeTruthy();
    });

    it("shows the English layer names", () => {
      renderGhost(
        { commandId: "cmd-9", kind: "node", label: "ethereum", layer: "execution" },
        "en",
      );
      expect(screen.getByText("New node (reth)")).toBeTruthy();
    });

    it("appends the resolved connection target to the subtitle for a node ghost", () => {
      renderGhost({
        commandId: "cmd-10",
        kind: "node",
        label: "ethereum",
        layer: "execution",
        targetContainerName: "chainviz-ethereum-reth1",
      });
      expect(
        screen.getByText("起動中… chainviz-ethereum-reth1 と接続予定"),
      ).toBeTruthy();
    });

    it("appends the resolved RPC target to the subtitle for a workbench ghost", () => {
      renderGhost({
        commandId: "cmd-11",
        kind: "workbench",
        label: "Carol",
        targetContainerName: "chainviz-ethereum-reth1",
      });
      expect(
        screen.getByText("起動中… 操作先: chainviz-ethereum-reth1"),
      ).toBeTruthy();
    });

    it("falls back to the plain pending subtitle when no connection target resolves (Issue #123 §4-5)", () => {
      renderGhost({
        commandId: "cmd-12",
        kind: "node",
        label: "ethereum",
        layer: "consensus",
      });
      expect(screen.getByText("起動中…")).toBeTruthy();
    });

    it("falls back to the raw label as the name when layer is absent (legacy/defensive)", () => {
      renderGhost({ commandId: "cmd-13", kind: "node", label: "ethereum" });
      expect(screen.getByText("ethereum")).toBeTruthy();
    });
  });

  describe("contract ghost (ARCHITECTURE.md §6.5 deploy placeholder)", () => {
    it("renders the contract kind label and a 'deploying…' name with the label interpolated", () => {
      renderGhost({
        commandId: "cmd-deploy-1",
        kind: "contract",
        label: "ChainvizToken",
        catalogKey: "ChainvizToken",
      });
      const card = screen.getByTestId("ghost-card-cmd-deploy-1");
      expect(card.className).toContain("ghost-card--contract");
      expect(screen.getByText("コントラクト")).toBeTruthy();
      expect(screen.getByText("デプロイ中… ChainvizToken")).toBeTruthy();
    });

    it("renders the English deploying label", () => {
      renderGhost(
        {
          commandId: "cmd-deploy-2",
          kind: "contract",
          label: "Counter",
          catalogKey: "Counter",
        },
        "en",
      );
      expect(screen.getByText("Contract")).toBeTruthy();
      expect(screen.getByText("Deploying… Counter")).toBeTruthy();
    });

    it("does not render a subtitle line for a contract ghost (no connection target concept)", () => {
      renderGhost({
        commandId: "cmd-deploy-3",
        kind: "contract",
        label: "Counter",
        catalogKey: "Counter",
      });
      const card = screen.getByTestId("ghost-card-cmd-deploy-3");
      expect(card.querySelector(".infra-card__subtitle")).toBeNull();
    });
  });
});
