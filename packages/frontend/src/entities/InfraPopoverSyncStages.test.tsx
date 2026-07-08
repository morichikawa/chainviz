import type { SyncStageProgress } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { InfraPopoverSyncStages } from "./InfraPopoverSyncStages.js";

afterEach(cleanup);

const stages: SyncStageProgress[] = [
  { stage: "Headers", checkpoint: 128 },
  { stage: "Bodies", checkpoint: 64 },
  { stage: "UnknownFutureStage", checkpoint: 0 },
];

function renderSection(targetHeight: number, lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={{}}>
        <InfraPopoverSyncStages stages={stages} targetHeight={targetHeight} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("InfraPopoverSyncStages (ARCHITECTURE.md §7.6.5)", () => {
  it("renders all stages in array order with mapped display names", () => {
    renderSection(128);
    const rows = screen
      .getByText("同期ステージ")
      .closest(".infra-popover__sync-stages")
      ?.querySelectorAll(".infra-popover__sync-stage-row");
    expect(rows).toHaveLength(3);
    expect(rows?.[0].textContent).toContain("ヘッダ取得");
    expect(rows?.[0].textContent).toContain("128");
    expect(rows?.[1].textContent).toContain("ボディ取得");
  });

  it("falls back to the raw stage name for an unmapped stage (does not hide the row)", () => {
    renderSection(128);
    expect(screen.getByText("UnknownFutureStage")).toBeTruthy();
  });

  it("renders a progress bar per row when targetHeight > 0", () => {
    const { container } = renderSection(128);
    expect(
      container.querySelectorAll(".sync-progress-bar"),
    ).toHaveLength(stages.length);
  });

  it("omits progress bars when targetHeight is 0 (unresolvable target)", () => {
    const { container } = renderSection(0);
    expect(container.querySelectorAll(".sync-progress-bar")).toHaveLength(0);
    // checkpoint の数値自体は出続ける。
    expect(screen.getByText("128")).toBeTruthy();
  });

  it("localizes the heading and stage names to English", () => {
    renderSection(128, "en");
    expect(screen.getByText("Sync stages")).toBeTruthy();
    expect(screen.getByText("Fetch headers")).toBeTruthy();
  });

  it("wraps the heading label with a GlossaryTerm anchor for staged-sync", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider
          glossary={{
            "staged-sync": {
              key: "staged-sync",
              name: { ja: "ステージ型同期", en: "Staged sync" },
              definition: { ja: "def", en: "def" },
              layer: "d-internal",
              relatedTerms: [],
            },
          }}
        >
          <InfraPopoverSyncStages stages={stages} targetHeight={128} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(document.querySelector(".glossary-term")).not.toBeNull();
  });
});
