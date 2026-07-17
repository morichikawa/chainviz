// SidePanelHost の glossary kind への振り分け（Issue #313）。contractSource
// kind の振り分け・ダングリングガードは SidePanelHost.test.tsx が担う
// （CLAUDE.md のテスト分割方針）。ここでは、glossary kind 追加によって
// contractSource 専用のダングリングガードが誤爆しないこと（実際に見つかった
// バグの回帰テスト）・termKey の受け渡し・排他制御・レイヤーレンズ連携の
// 配線を確認する。
import type { ContractEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerFilter } from "../entities/canvasLayers.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "./SidePanelContext.js";
import { SidePanelHost } from "./SidePanelHost.js";

afterEach(cleanup);

const CONTRACT_ADDRESS = `0x${"d".repeat(40)}`;

const glossary: Glossary = {
  container: {
    key: "container",
    name: { ja: "コンテナ", en: "Container" },
    definition: { ja: "隔離された実行単位", en: "An isolated runtime unit" },
    layer: "a-infra",
    relatedTerms: [],
  },
};

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: CONTRACT_ADDRESS,
    chainType: "ethereum",
    ...overrides,
  };
}

/** テストから3種類の open() 呼び出しを個別に発火できるプローブ。 */
function OpenButtons() {
  const { open } = useSidePanel();
  return (
    <>
      <button
        type="button"
        data-testid="trigger-glossary-with-term"
        onClick={() => open({ kind: "glossary", termKey: "container" })}
      >
        open glossary(container)
      </button>
      <button
        type="button"
        data-testid="trigger-glossary-no-term"
        onClick={() => open({ kind: "glossary" })}
      >
        open glossary()
      </button>
      <button
        type="button"
        data-testid="trigger-contract-source"
        onClick={() => open({ kind: "contractSource", address: CONTRACT_ADDRESS })}
      >
        open contractSource
      </button>
    </>
  );
}

interface HostOptions {
  contractsByAddress?: Map<string, ContractEntity>;
  onLayerFilterChange?: (layer: LayerFilter) => void;
  layerFilter?: LayerFilter;
}

/**
 * SidePanelHost を含むツリー全体を組む。rerender に同じ形のツリーを渡すと
 * React は同一位置の `SidePanelProvider` を再利用するため、contractsByAddress
 * だけを差し替えても「開いたままのパネル（Context 上の view）」が保持される。
 * これによりダングリングガードの時系列遷移をテストできる。
 */
function fullTree(options: HostOptions) {
  return (
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={glossary}>
        <SidePanelProvider>
          <OpenButtons />
          <SidePanelHost
            contractsByAddress={options.contractsByAddress ?? new Map()}
            layerFilter={options.layerFilter ?? "all"}
            onLayerFilterChange={options.onLayerFilterChange ?? (() => {})}
          />
        </SidePanelProvider>
      </GlossaryProvider>
    </LanguageProvider>
  );
}

function renderHost(options: HostOptions) {
  return render(fullTree(options));
}

describe("SidePanelHost: glossary kind (Issue #313)", () => {
  it("renders the glossary panel with a localized title", () => {
    renderHost({});
    fireEvent.click(screen.getByTestId("trigger-glossary-no-term"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("glossary-panel")).toBeTruthy();
    expect(screen.getByText("用語集")).toBeTruthy();
  });

  it(
    "does not close itself via the contractSource dangling guard " +
      "(regression: contract lookup is undefined for a non-contractSource view, " +
      "which previously made the dangling check always true regardless of kind)",
    () => {
      renderHost({ contractsByAddress: new Map() });
      fireEvent.click(screen.getByTestId("trigger-glossary-with-term"));
      expect(screen.getByTestId("side-panel")).toBeTruthy();
      expect(screen.getByTestId("glossary-panel-term-container")).toBeTruthy();
    },
  );

  it("passes termKey through so the target row starts expanded", () => {
    renderHost({});
    fireEvent.click(screen.getByTestId("trigger-glossary-with-term"));
    const header = screen
      .getByTestId("glossary-panel-term-container")
      .querySelector(".glossary-panel__row-header");
    expect(header?.getAttribute("aria-expanded")).toBe("true");
  });

  it("is exclusive with contractSource: opening glossary replaces an open contract source panel", () => {
    const target = contract({ name: "ChainvizToken" });
    renderHost({ contractsByAddress: new Map([[target.address, target]]) });
    fireEvent.click(screen.getByTestId("trigger-contract-source"));
    expect(screen.getByTestId("contract-source-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-glossary-no-term"));
    expect(screen.queryByTestId("contract-source-view")).toBeNull();
    expect(screen.getByTestId("glossary-panel")).toBeTruthy();
  });

  it("is exclusive the other way: opening contractSource replaces an open glossary panel", () => {
    const target = contract({ name: "ChainvizToken" });
    renderHost({ contractsByAddress: new Map([[target.address, target]]) });
    fireEvent.click(screen.getByTestId("trigger-glossary-no-term"));
    expect(screen.getByTestId("glossary-panel")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-contract-source"));
    expect(screen.queryByTestId("glossary-panel")).toBeNull();
    expect(screen.getByTestId("contract-source-view")).toBeTruthy();
  });

  it("wires the layer chip inside the panel to onLayerFilterChange", () => {
    const onLayerFilterChange = vi.fn();
    renderHost({ onLayerFilterChange });
    fireEvent.click(screen.getByTestId("trigger-glossary-with-term"));
    fireEvent.click(screen.getByTestId("glossary-panel-layer-chip"));
    expect(onLayerFilterChange).toHaveBeenCalledWith("a");
  });

  it("reflects the externally-provided layerFilter as the chip's active state", () => {
    // レンズが a 層を選択中の状態でパネルを開くと、a-infra 用語のチップは
    // 最初から active（aria-pressed=true）で表示される。既存のレンズ状態が
    // パネルへ正しく流れ込むことを host レベルで確認する。
    renderHost({ layerFilter: "a" });
    fireEvent.click(screen.getByTestId("trigger-glossary-with-term"));
    expect(
      screen.getByTestId("glossary-panel-layer-chip").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it(
    "keeps the glossary panel open across world-state churn " +
      "(regression: the pre-fix dangling guard ignored kind and closed on every " +
      "render where contract lookup was undefined)",
    () => {
      const { rerender } = renderHost({ contractsByAddress: new Map() });
      fireEvent.click(screen.getByTestId("trigger-glossary-no-term"));
      expect(screen.getByTestId("glossary-panel")).toBeTruthy();

      // world state が更新された（無関係なコントラクトが増えた）ことを模して
      // contractsByAddress を差し替えて再レンダー。glossary は world state に
      // 依存しないので開いたままであるべき。
      const other = contract({ name: "ChainvizToken" });
      rerender(fullTree({ contractsByAddress: new Map([[other.address, other]]) }));
      expect(screen.getByTestId("glossary-panel")).toBeTruthy();
    },
  );

  it(
    "does not close the glossary panel when a contract entity is removed from world state " +
      "while glossary is showing (Issue #321 no-degrade: dangling guard is contractSource-only)",
    () => {
      const target = contract({ name: "ChainvizToken" });
      const { rerender } = renderHost({
        contractsByAddress: new Map([[target.address, target]]),
      });
      fireEvent.click(screen.getByTestId("trigger-glossary-no-term"));
      expect(screen.getByTestId("glossary-panel")).toBeTruthy();

      // コントラクトが world state から消えても glossary view は無関係。
      rerender(fullTree({ contractsByAddress: new Map() }));
      expect(screen.getByTestId("glossary-panel")).toBeTruthy();
    },
  );

  it("closes when switching from glossary to a contractSource whose address has no entity (cross-kind dangling)", () => {
    // glossary → contractSource(参照切れ) の遷移で、contractSource 固有の
    // ダングリングガードが正しく発火してパネルが閉じることを確認する
    // （kind ゲートが contractSource 側の防御を無効化していないこと）。
    renderHost({ contractsByAddress: new Map() });
    fireEvent.click(screen.getByTestId("trigger-glossary-no-term"));
    expect(screen.getByTestId("glossary-panel")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-contract-source"));
    expect(screen.queryByTestId("glossary-panel")).toBeNull();
    expect(screen.queryByTestId("contract-source-view")).toBeNull();
    expect(screen.queryByTestId("side-panel")).toBeNull();
  });

  it("opens the glossary panel cleanly after a dangling contractSource auto-closed", () => {
    // 参照切れ contractSource でパネルが自動クローズした後に glossary を開く
    // 順序でも、正しく用語集パネルが出る（ダングリング後の状態リセット）。
    renderHost({ contractsByAddress: new Map() });
    fireEvent.click(screen.getByTestId("trigger-contract-source"));
    expect(screen.queryByTestId("side-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("trigger-glossary-no-term"));
    expect(screen.getByTestId("glossary-panel")).toBeTruthy();
  });
});
