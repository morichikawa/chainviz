import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import type { CommandActions } from "../commands/useCommands.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { OperationDataProvider } from "./OperationDataContext.js";
import { OperationPanel } from "./OperationPanel.js";
import type { DeployedContractCandidate } from "./deployedContracts.js";
import type { WalletCandidate } from "./walletCandidates.js";

afterEach(cleanup);

function renderPanel(
  actionsOverride: Partial<CommandActions> = {},
  onClose = vi.fn(),
  data: { walletCandidates?: WalletCandidate[]; deployedContracts?: DeployedContractCandidate[] } = {},
) {
  const actions: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    runWorkbenchOperation: vi.fn(),
    ...actionsOverride,
  };
  render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <CommandActionsProvider actions={actions}>
          <OperationDataProvider
            value={{
              walletCandidates: data.walletCandidates ?? [],
              deployedContracts: data.deployedContracts ?? [],
            }}
          >
            <OperationPanel workbenchId="workbench-alice" onClose={onClose} />
          </OperationDataProvider>
        </CommandActionsProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
  return { actions, onClose };
}

describe("OperationPanel (ARCHITECTURE.md §6.5)", () => {
  it("opens on the transfer tab by default", () => {
    renderPanel();
    expect(screen.getByTestId("operation-transfer-to")).toBeTruthy();
  });

  it("switches to the deploy tab", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("operation-tab-deploy"));
    expect(screen.getByTestId("operation-deploy-contract")).toBeTruthy();
  });

  it("switches to the call tab", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("operation-tab-call"));
    expect(screen.getByText("呼び出せるコントラクトがまだありません。先に「デプロイ」タブからデプロイしてください")).toBeTruthy();
  });

  it("marks the active tab with aria-selected", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("operation-tab-deploy"));
    expect(screen.getByTestId("operation-tab-deploy").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("operation-tab-transfer").getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("submitting the transfer form dispatches runWorkbenchOperation and closes the panel", () => {
    const { actions, onClose } = renderPanel();
    fireEvent.change(screen.getByTestId("operation-transfer-to"), {
      target: { value: "0xbob" },
    });
    fireEvent.change(screen.getByTestId("operation-transfer-amount"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByText("送金する"));
    expect(actions.runWorkbenchOperation).toHaveBeenCalledWith("workbench-alice", {
      type: "transfer",
      to: "0xbob",
      amount: "1000000000000000000",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submitting the deploy form dispatches deployContract and closes the panel", () => {
    const { actions, onClose } = renderPanel();
    fireEvent.click(screen.getByTestId("operation-tab-deploy"));
    fireEvent.change(screen.getByTestId("operation-deploy-contract"), {
      target: { value: "Counter" },
    });
    fireEvent.click(screen.getByText("デプロイする"));
    expect(actions.runWorkbenchOperation).toHaveBeenCalledWith("workbench-alice", {
      type: "deployContract",
      contractKey: "Counter",
      constructorArgs: [],
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when Escape is pressed", () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking outside the panel", () => {
    const { onClose } = renderPanel();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the panel", () => {
    const { onClose } = renderPanel();
    fireEvent.pointerDown(screen.getByTestId("operation-panel-workbench-alice"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes via the × close button", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByTestId("operation-panel-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
