// SidePanelView の複数 kind（contractSource / commsLog）を相互に切り替えた
// ときの排他表示と、contractSource 専用ダングリングガードが他 kind へ
// 漏れないことを固定するテスト。単一 kind ごとの振り分けは
// SidePanelHost.test.tsx / SidePanelHost.commsLog.test.tsx が見るため、
// ここでは「kind をまたぐ遷移」という関心事に絞る（CLAUDE.md 分割方針）。
//
// 注: このブランチの SidePanelView は contractSource / commsLog の2 kind。
// 用語集（glossary）はサイドパネルの kind ではなくインラインの
// GlossaryTerm アンカーで表現されているため、パネル kind としての
// 相互作用テストの対象は上記2種になる。
import type { ContractEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "./SidePanelContext.js";
import { SidePanelHost } from "./SidePanelHost.js";

afterEach(cleanup);

const noopCommsLog = {
  visibleEntries: [],
  filters: { categories: {} as never, nodeId: null },
  toggleCategory: () => {},
  setNodeFilter: () => {},
};

function contract(address: string, name: string): ContractEntity {
  return { kind: "contract", address, chainType: "ethereum", name };
}

/** contractSource / commsLog の両方を開けるプローブ。 */
function Probe({ address }: { address: string }) {
  const { open } = useSidePanel();
  return (
    <>
      <button type="button" onClick={() => open({ kind: "contractSource", address })}>
        open-contract
      </button>
      <button type="button" onClick={() => open({ kind: "commsLog" })}>
        open-comms
      </button>
    </>
  );
}

function renderHost(contractsByAddress: Map<string, ContractEntity>, address: string) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <SidePanelProvider>
          <Probe address={address} />
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

describe("SidePanelHost: switching between kinds (exclusive)", () => {
  it("replaces a contract source panel with the comms log when the comms log is opened", () => {
    const target = contract(`0x${"a".repeat(40)}`, "ChainvizToken");
    renderHost(new Map([[target.address, target]]), target.address);

    fireEvent.click(screen.getByText("open-contract"));
    expect(screen.getByTestId("contract-source-view")).toBeTruthy();

    fireEvent.click(screen.getByText("open-comms"));
    expect(screen.getByTestId("comms-log-view")).toBeTruthy();
    expect(screen.queryByTestId("contract-source-view")).toBeNull();
    expect(screen.getAllByTestId("side-panel")).toHaveLength(1);
  });

  it("replaces the comms log with a contract source panel when a contract is opened", () => {
    const target = contract(`0x${"b".repeat(40)}`, "Counter");
    renderHost(new Map([[target.address, target]]), target.address);

    fireEvent.click(screen.getByText("open-comms"));
    expect(screen.getByTestId("comms-log-view")).toBeTruthy();

    fireEvent.click(screen.getByText("open-contract"));
    expect(screen.getByTestId("contract-source-view")).toBeTruthy();
    expect(screen.queryByTestId("comms-log-view")).toBeNull();
  });
});

describe("SidePanelHost: dangling guard isolation across kinds", () => {
  it("opens the comms log cleanly after a contractSource was closed by the dangling guard", () => {
    // 先に「存在しないアドレス」で contractSource を開くと、ダングリング
    // ガードで即座に閉じる。その直後に commsLog を開いても、直前の
    // ダングリング状態が漏れて即閉じすることが無い（3 kind 目追加時に
    // 再発しやすい種類のバグの回帰確認）。
    renderHost(new Map(), "0xnonexistent");

    fireEvent.click(screen.getByText("open-contract"));
    expect(screen.queryByTestId("side-panel")).toBeNull(); // ダングリングで閉じる

    fireEvent.click(screen.getByText("open-comms"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("comms-log-view")).toBeTruthy();
  });

  it("keeps the comms log open even when the contract catalog is empty on a later render", () => {
    // commsLog 表示中に contractsByAddress が空へ変わっても（commsLog は
    // どのコントラクトも指さないため）ダングリングと判定されて閉じては
    // ならない。時系列の遷移で確認する。
    const target = contract(`0x${"c".repeat(40)}`, "Token");
    const withEntity = new Map([[target.address, target]]);
    const { rerender } = render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <Probe address={target.address} />
            <SidePanelHost
              contractsByAddress={withEntity}
              commsLog={noopCommsLog}
              commsLogNodeOptions={[]}
            />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByText("open-comms"));
    expect(screen.getByTestId("comms-log-view")).toBeTruthy();

    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <Probe address={target.address} />
            <SidePanelHost
              contractsByAddress={new Map()}
              commsLog={noopCommsLog}
              commsLogNodeOptions={[]}
            />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByTestId("comms-log-view")).toBeTruthy();
    expect(screen.getByTestId("side-panel")).toBeTruthy();
  });
});
