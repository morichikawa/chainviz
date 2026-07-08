import type { SyncStageProgress } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { InfraNodeCardSyncProgress } from "./InfraNodeCardSyncProgress.js";

afterEach(cleanup);

const stages: SyncStageProgress[] = [
  { stage: "Headers", checkpoint: 128 },
  { stage: "Bodies", checkpoint: 64 },
  { stage: "SenderRecovery", checkpoint: 0 },
];

function renderRow(targetHeight: number, lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={{}}>
        <InfraNodeCardSyncProgress stages={stages} targetHeight={targetHeight} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("InfraNodeCardSyncProgress (ARCHITECTURE.md §7.6.5 card row)", () => {
  it("shows the first stage whose checkpoint is behind the target, with target in the text", () => {
    renderRow(128);
    expect(screen.getByText(/同期中: ボディ取得 64\/128/)).toBeTruthy();
  });

  it("renders exactly one progress bar", () => {
    const { container } = renderRow(128);
    expect(container.querySelectorAll(".sync-progress-bar")).toHaveLength(1);
  });

  it("omits the target and the progress bar when targetHeight is 0", () => {
    const { container } = renderRow(0);
    expect(screen.getByText(/同期中: ヘッダ取得 128/)).toBeTruthy();
    expect(container.querySelectorAll(".sync-progress-bar")).toHaveLength(0);
  });

  it("returns null (renders nothing) when stages is empty", () => {
    const { container } = render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <InfraNodeCardSyncProgress stages={[]} targetHeight={128} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("localizes to English", () => {
    renderRow(128, "en");
    expect(screen.getByText(/Syncing: Fetch bodies 64\/128/)).toBeTruthy();
  });

  it("wraps the row text with a GlossaryTerm anchor for staged-sync", () => {
    renderRow(128);
    expect(document.querySelector(".glossary-term")).not.toBeNull();
  });
});
