// SidePanelHost（Issue #321。SidePanelView.kind ごとの振り分け + ダングリング
// ガード）のテスト。シェル自体・状態管理は別ファイルでテストする
// （CLAUDE.md のテスト分割方針）。
import type { ContractEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "./SidePanelContext.js";
import { SidePanelHost } from "./SidePanelHost.js";

afterEach(cleanup);

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"d".repeat(40)}`,
    chainType: "ethereum",
    ...overrides,
  };
}

/** テストから `open`/`close` を呼べるようにする、外に公開する薄いプローブ。 */
function OpenButton({ address }: { address: string }) {
  const { open } = useSidePanel();
  return (
    <button
      type="button"
      onClick={() => open({ kind: "contractSource", address })}
    >
      open
    </button>
  );
}

function renderHost(
  contractsByAddress: Map<string, ContractEntity>,
  address: string,
) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <SidePanelProvider>
          <OpenButton address={address} />
          <SidePanelHost contractsByAddress={contractsByAddress} />
        </SidePanelProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("SidePanelHost", () => {
  it("renders nothing when no panel is open", () => {
    renderHost(new Map(), "0xabc");
    expect(screen.queryByTestId("side-panel")).toBeNull();
  });

  it("renders the contract source panel for a known address", () => {
    const target = contract({ name: "ChainvizToken" });
    renderHost(new Map([[target.address, target]]), target.address);
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("contract-source-view")).toBeTruthy();
    expect(screen.getByText("ChainvizToken")).toBeTruthy();
  });

  it("closes the panel automatically when the target address has no matching entity (dangling guard)", () => {
    // 通常は起きない(コントラクトは削除されない設計)が、対象アドレスが
    // world state に存在しない状態で開かれた場合の防御を確認する。
    renderHost(new Map(), "0xnonexistent");
    fireEvent.click(screen.getByText("open"));
    expect(screen.queryByTestId("side-panel")).toBeNull();
  });
});
