import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { OperationTargetEdgePopover } from "./OperationTargetEdgePopover.js";

afterEach(cleanup);

// Issue #299: 見出しに LayerBadge（GlossaryTerm 経由で useGlossary を呼ぶ）を
// 追加したため、GlossaryProvider 無しでは例外になる（他の *Popover.test.tsx
// と同じ理由）。
function wrap(
  workbenchContainerName: string,
  targetContainerName: string,
  lang: "ja" | "en" = "ja",
) {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={{}}>
        <OperationTargetEdgePopover
          workbenchContainerName={workbenchContainerName}
          targetContainerName={targetContainerName}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("OperationTargetEdgePopover (Issue #215)", () => {
  it("has a tooltip role for accessibility", () => {
    wrap("chainviz-workbench-alice", "chainviz-reth-1");
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("shows the title", () => {
    wrap("chainviz-workbench-alice", "chainviz-reth-1");
    expect(screen.getByText("操作先（RPC 接続先）")).toBeTruthy();
  });

  it("shows the endpoints joined with an arrow, workbench first", () => {
    wrap("chainviz-workbench-alice", "chainviz-reth-1");
    expect(
      screen.getByText("chainviz-workbench-alice → chainviz-reth-1"),
    ).toBeTruthy();
  });

  it("includes the general-vs-chainviz-specific explanation and the bootnode disclaimer", () => {
    const { container } = wrap("chainviz-workbench-alice", "chainviz-reth-1");
    const hint = container.querySelector(
      ".operation-target-popover__hint",
    )?.textContent;
    expect(hint).toContain(
      "実際の Ethereum でもウォレットは決まった1つの RPC エンドポイントに接続します",
    );
    expect(hint).toContain("ブートノード役とは無関係です");
  });

  it("shows the English title and hint when the language is English", () => {
    const { container } = wrap(
      "chainviz-workbench-alice",
      "chainviz-reth-1",
      "en",
    );
    expect(screen.getByText("RPC target")).toBeTruthy();
    const hint = container.querySelector(
      ".operation-target-popover__hint",
    )?.textContent;
    expect(hint).toContain("unrelated to the bootnode role");
  });

  it("renders empty endpoint strings without throwing (defensive)", () => {
    const { container } = wrap("", "");
    expect(
      container.querySelector(".operation-target-popover__endpoints")
        ?.textContent,
    ).toBe(" → ");
  });
});
