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
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <TxLifecyclePopover tx={t} />
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
});
