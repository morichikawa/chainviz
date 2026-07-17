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

// このファイルは contractSource 周りの振り分け・ダングリングガードのみを
// 見る。commsLog 側は別ファイル（SidePanelHost.commsLog.test.tsx）でテスト
// するため、ここでは何もしない最小のダミー値を渡す。
const noopCommsLog = {
  visibleEntries: [],
  filters: { categories: {} as never, nodeId: null },
  toggleCategory: () => {},
  setNodeFilter: () => {},
};

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
          <SidePanelHost
            contractsByAddress={contractsByAddress}
            commsLog={noopCommsLog}
            commsLogNodeOptions={[]}
          />
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

  it("closes an already-open panel when its target entity is removed on a later render (dangling transition)", () => {
    // パネル表示中に対象コントラクトが world state から消えるという時系列の
    // 遷移そのものを確認する（開いた時点では存在 → 次のレンダーで消滅）。
    // 「開いた瞬間から存在しない」ケースだけでなく、この遷移でも
    // ダングリングガードが働いてパネルが閉じることを固定する。
    const target = contract({ name: "ChainvizToken" });
    const withEntity = new Map([[target.address, target]]);
    const { rerender } = render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <OpenButton address={target.address} />
            <SidePanelHost
              contractsByAddress={withEntity}
              commsLog={noopCommsLog}
              commsLogNodeOptions={[]}
            />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();

    // 対象エンティティが消えた状態で再レンダー。
    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <OpenButton address={target.address} />
            <SidePanelHost
              contractsByAddress={new Map()}
              commsLog={noopCommsLog}
              commsLogNodeOptions={[]}
            />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.queryByTestId("side-panel")).toBeNull();
  });

  it("replaces the panel content when a second address is opened while the first is showing (exclusive)", () => {
    // 複数のコントラクトカードから連続してソース表示を開いた場合、前のパネルが
    // 置き換わり、常に最後に開いたコントラクトだけが表示されることを確認する。
    const first = contract({
      name: "ChainvizToken",
      address: `0x${"a".repeat(40)}`,
    });
    const second = contract({
      name: "Counter",
      address: `0x${"b".repeat(40)}`,
    });
    const map = new Map([
      [first.address, first],
      [second.address, second],
    ]);
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <OpenButton address={first.address} />
            <OpenButton address={second.address} />
            <SidePanelHost
              contractsByAddress={map}
              commsLog={noopCommsLog}
              commsLogNodeOptions={[]}
            />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    const [openFirst, openSecond] = screen.getAllByText("open");
    fireEvent.click(openFirst);
    expect(screen.getByText("ChainvizToken")).toBeTruthy();
    fireEvent.click(openSecond);
    // 2 枚目に置き換わり、1 枚目のコントラクト名は残っていない。
    expect(screen.getByText("Counter")).toBeTruthy();
    expect(screen.queryByText("ChainvizToken")).toBeNull();
    expect(screen.getAllByTestId("side-panel")).toHaveLength(1);
  });
});
