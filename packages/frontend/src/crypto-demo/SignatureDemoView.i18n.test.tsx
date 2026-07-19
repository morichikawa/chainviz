// SignatureDemoView の文言・i18n観点(ja/en 両方で主要な文言キーが表示される
// こと)。操作フロー自体は SignatureDemoView.test.tsx が扱う(CLAUDE.md の
// 1ファイル1責務)。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SignatureDemoView } from "./SignatureDemoView.js";

afterEach(cleanup);

describe("SignatureDemoView: ja", () => {
  it("renders the Japanese labels", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SignatureDemoView />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(
      screen.getByText(
        "ここは学習用の砂場です。実際のチェーンには影響しません。ワークベンチから送金するとき、裏側ではこれが起きています。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("ワークベンチ（署名する側）")).toBeTruthy();
    expect(screen.getByText("ノード（検証する側）")).toBeTruthy();
    expect(screen.getByText("秘密鍵（砂場専用）")).toBeTruthy();
    expect(
      screen.getByText("実際の秘密鍵は画面に出しません。これは砂場専用の使い捨ての鍵です。"),
    ).toBeTruthy();
    expect(screen.getAllByText("secp256k1 で署名").length).toBe(1);
    expect(screen.getByText("署名からアドレスを復元（ecrecover）")).toBeTruthy();
    expect(screen.getByText("最初に戻す")).toBeTruthy();
  });
});

describe("SignatureDemoView: en", () => {
  it("renders the English labels", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <GlossaryProvider glossary={{}}>
          <SignatureDemoView />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(
      screen.getByText(
        "This is a learning sandbox. It does not affect the real chain. This is what happens behind the scenes when you send a transfer from the workbench.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Workbench (the signer)")).toBeTruthy();
    expect(screen.getByText("Node (the verifier)")).toBeTruthy();
    expect(screen.getByText("Private key (sandbox only)")).toBeTruthy();
    expect(screen.getByText("Signed with secp256k1")).toBeTruthy();
    expect(screen.getByText("Recover the address from the signature (ecrecover)")).toBeTruthy();
    expect(screen.getByText("Reset")).toBeTruthy();
  });
});
