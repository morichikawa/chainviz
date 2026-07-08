import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { DeployEdgePopover } from "./DeployEdgePopover.js";

afterEach(cleanup);

function wrap(deployerAddress: string, lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={{}}>
        <DeployEdgePopover deployerAddress={deployerAddress} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("DeployEdgePopover", () => {
  it("has a tooltip role for accessibility", () => {
    wrap(`0x${"a".repeat(40)}`);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("shows the shortened deployer address inside the sentence", () => {
    wrap(`0x${"a".repeat(40)}`);
    expect(
      screen.getByText(`0xaaaaaa…aaaa がデプロイしたコントラクト`),
    ).toBeTruthy();
  });

  it("shows the English sentence when the language is English", () => {
    wrap(`0x${"a".repeat(40)}`, "en");
    expect(
      screen.getByText(`Contract deployed by 0xaaaaaa…aaaa`),
    ).toBeTruthy();
  });
});
