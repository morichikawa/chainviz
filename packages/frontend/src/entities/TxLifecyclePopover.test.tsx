import type { TransactionEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { TxLifecyclePopover } from "./TxLifecyclePopover.js";

afterEach(cleanup);

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0xdeadbeef00000000",
    from: "0xa",
    to: "0xb",
    status: "pending",
    ...overrides,
  };
}

function wrap(t: TransactionEntity) {
  // PopoverPortal(Issue #245)の必須 prop anchorRef 用の detached 要素。
  const anchorRef = { current: document.createElement("div") };
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <TxLifecyclePopover anchorRef={anchorRef} tx={t} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("TxLifecyclePopover (ARCHITECTURE.md §6.11, Issue #212 単位D)", () => {
  it("shows the shortened hash and status badge in the header", () => {
    const t = tx({ status: "included" });
    wrap(t);
    expect(screen.getByTestId(`tx-lifecycle-popover-${t.hash}`)).toBeTruthy();
    expect(screen.getByText("0xdeadbe…0000")).toBeTruthy();
    expect(screen.getByText("取り込み済み")).toBeTruthy();
  });

  it("marks signed/sent as done, mempool as active, and inclusion as not yet reached for a pending tx", () => {
    const t = tx({ status: "pending" });
    wrap(t);
    expect(
      screen.getByTestId(`tx-lifecycle-stage-${t.hash}-signed`).getAttribute(
        "data-stage-state",
      ),
    ).toBe("done");
    expect(
      screen.getByTestId(`tx-lifecycle-stage-${t.hash}-sent`).getAttribute(
        "data-stage-state",
      ),
    ).toBe("done");
    expect(
      screen.getByTestId(`tx-lifecycle-stage-${t.hash}-mempool`).getAttribute(
        "data-stage-state",
      ),
    ).toBe("active");
    expect(
      screen.getByTestId(`tx-lifecycle-stage-${t.hash}-included`).getAttribute(
        "data-stage-state",
      ),
    ).toBe("pending");
  });

  it("marks every stage as done for an included tx", () => {
    const t = tx({ status: "included" });
    wrap(t);
    for (const key of ["signed", "sent", "mempool", "included"]) {
      expect(
        screen.getByTestId(`tx-lifecycle-stage-${t.hash}-${key}`).getAttribute(
          "data-stage-state",
        ),
      ).toBe("done");
    }
  });

  it("shows the failed-specific description only for the inclusion stage of a failed tx", () => {
    const t = tx({ status: "failed" });
    wrap(t);
    const includedStage = screen.getByTestId(
      `tx-lifecycle-stage-${t.hash}-included`,
    );
    expect(includedStage.getAttribute("data-stage-state")).toBe("failed");
    expect(includedStage.textContent).toContain(
      "実行が失敗として記録されました（ブロックには取り込まれています）",
    );
    const mempoolStage = screen.getByTestId(
      `tx-lifecycle-stage-${t.hash}-mempool`,
    );
    expect(mempoolStage.getAttribute("data-stage-state")).toBe("done");
  });

  it("does not claim signing is 'in progress' — signed/sent are always shown as already completed facts, never as an observed real-time state", () => {
    const t = tx({ status: "pending" });
    wrap(t);
    const signedStage = screen.getByTestId(`tx-lifecycle-stage-${t.hash}-signed`);
    // 「今署名中」という進行中(active)マークは絶対に出さない。
    expect(signedStage.getAttribute("data-stage-state")).not.toBe("active");
    expect(signedStage.getAttribute("data-stage-state")).toBe("done");
  });

  it("does not describe the not-yet-reached inclusion stage of a pending tx as already completed (Issue #212 QA差し戻し)", () => {
    const t = tx({ status: "pending" });
    wrap(t);
    const includedStage = screen.getByTestId(
      `tx-lifecycle-stage-${t.hash}-included`,
    );
    expect(includedStage.getAttribute("data-stage-state")).toBe("pending");
    // ○マーク(未到達)と矛盾する完了断定の過去形説明文を出さない。
    expect(includedStage.textContent).not.toContain(
      "ブロックに取り込まれ、全ノードに複製されて確定しました",
    );
    // 未到達専用の、完了を断定しない説明文を出す。
    expect(includedStage.textContent).toContain(
      "ブロックに取り込まれると、全ノードに複製されて確定します",
    );
  });
});

/** stage li の中のマーク文字を取り出す。 */
function stageMark(hash: string, key: string): string {
  const li = screen.getByTestId(`tx-lifecycle-stage-${hash}-${key}`);
  return (
    li.querySelector(".tx-lifecycle-popover__stage-mark")?.textContent ?? ""
  );
}

describe("TxLifecyclePopover marks match the derived stage state", () => {
  it("uses ✓ for done, ● for active, ○ for not-yet-reached on a pending tx", () => {
    const t = tx({ status: "pending" });
    wrap(t);
    expect(stageMark(t.hash, "signed")).toBe("✓");
    expect(stageMark(t.hash, "sent")).toBe("✓");
    expect(stageMark(t.hash, "mempool")).toBe("●");
    expect(stageMark(t.hash, "included")).toBe("○");
  });

  it("uses ✓ for all four stages on an included tx", () => {
    const t = tx({ status: "included" });
    wrap(t);
    for (const key of ["signed", "sent", "mempool", "included"]) {
      expect(stageMark(t.hash, key)).toBe("✓");
    }
  });

  it("uses ✕ only on the inclusion stage of a failed tx (earlier stages stay ✓)", () => {
    const t = tx({ status: "failed" });
    wrap(t);
    expect(stageMark(t.hash, "signed")).toBe("✓");
    expect(stageMark(t.hash, "sent")).toBe("✓");
    expect(stageMark(t.hash, "mempool")).toBe("✓");
    expect(stageMark(t.hash, "included")).toBe("✕");
  });

  it("marks the mark span aria-hidden so screen readers rely on the text label, not the glyph", () => {
    const t = tx({ status: "pending" });
    wrap(t);
    const li = screen.getByTestId(`tx-lifecycle-stage-${t.hash}-mempool`);
    const mark = li.querySelector(".tx-lifecycle-popover__stage-mark");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("TxLifecyclePopover header status badge", () => {
  it("shows the pending badge text for a pending tx", () => {
    wrap(tx({ status: "pending" }));
    expect(screen.getByText("保留中（mempool）")).toBeTruthy();
  });

  it("shows the failed badge text for a failed tx", () => {
    wrap(tx({ status: "failed" }));
    expect(screen.getByText("失敗")).toBeTruthy();
  });

  it("carries the status in the badge className so CSS can color it", () => {
    const t = tx({ status: "failed" });
    wrap(t);
    // PopoverPortal(Issue #245)で body 直下に描画されるため、RTL の
    // container ではなく取得済みのポップオーバー要素から検索する。
    const popover = screen.getByTestId(`tx-lifecycle-popover-${t.hash}`);
    expect(popover.querySelector(".wallet-tx-chip--failed")).toBeTruthy();
  });
});

describe("TxLifecyclePopover hash rendering boundaries", () => {
  it("renders a short hash verbatim (shorter than the shorten threshold)", () => {
    const t = tx({ hash: "0x1", status: "included" });
    wrap(t);
    // testid は完全な hash を使うので取得でき、ヘッダ表示は短縮せずそのまま。
    const popover = screen.getByTestId(`tx-lifecycle-popover-${t.hash}`);
    const header = popover.querySelector(".tx-lifecycle-popover__hash");
    expect(header?.textContent).toBe("0x1");
  });

  it("does not throw and keeps distinct testids when two tx share the same short hash prefix", () => {
    const a = tx({ hash: "0xdeadbeefaaaa1111", status: "pending" });
    const b = tx({ hash: "0xdeadbeefbbbb2222", status: "included" });
    wrap(a);
    wrap(b);
    expect(screen.getByTestId(`tx-lifecycle-popover-${a.hash}`)).toBeTruthy();
    expect(screen.getByTestId(`tx-lifecycle-popover-${b.hash}`)).toBeTruthy();
  });
});

describe("TxLifecyclePopover 'sent' stage glossary anchor (Issue #215)", () => {
  it("anchors the 'sent' stage label to the rpc-endpoint term (now that it exists)", () => {
    const t = tx({ status: "included" });
    const anchorRef = { current: document.createElement("div") };
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider
          glossary={{
            "rpc-endpoint": {
              key: "rpc-endpoint",
              name: { ja: "RPCエンドポイント", en: "RPC endpoint" },
              definition: { ja: "窓口となるノードのAPI", en: "gateway node API" },
              layer: "a-infra",
              relatedTerms: [],
            },
          }}
        >
          <TxLifecyclePopover anchorRef={anchorRef} tx={t} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByTestId("glossary-term-rpc-endpoint")).toBeTruthy();
  });
});
