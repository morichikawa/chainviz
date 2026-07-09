import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { GlossaryProvider } from "./GlossaryProvider.js";
import { GlossaryTerm } from "./GlossaryTerm.js";
import type { Glossary } from "./types.js";

afterEach(cleanup);

// Issue #198 の data-testid 計装が「属性が付いているだけ」でなく、実際に
// ホバー/フォーカスで開閉するタイミングに合わせて popover の testid が
// DOM に出入りすること、複数用語が同時に並ぶ状況で anchor/popover が一意に
// 識別できることを固定する（GlossaryTerm.test.tsx の基本ケースとは関心が
// 異なるため別ファイルに分離）。

const glossary: Glossary = {
  container: {
    key: "container",
    name: { ja: "コンテナ", en: "Container" },
    definition: { ja: "隔離された実行単位", en: "An isolated runtime unit" },
    layer: "a-infra",
    relatedTerms: [],
  },
  bootnode: {
    key: "bootnode",
    name: { ja: "ブートノード", en: "Bootnode" },
    definition: { ja: "参加の入口となるノード", en: "Entry point node" },
    layer: "b-network",
    relatedTerms: [],
  },
};

function wrap(node: ReactNode, initialLanguage: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={initialLanguage}>
      <GlossaryProvider glossary={glossary}>{node}</GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("GlossaryTerm testid timing (Issue #198)", () => {
  it("keeps the anchor testid present but omits the popover testid until opened", () => {
    wrap(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    // アンカーは常時存在。
    expect(screen.getByTestId("glossary-term-container")).toBeTruthy();
    // 閉じている間は popover の testid は DOM に存在しない。
    expect(screen.queryByTestId("glossary-popover-container")).toBeNull();
  });

  it("adds and removes the popover testid as the term is hovered and unhovered", () => {
    wrap(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    const anchor = screen.getByTestId("glossary-term-container");

    fireEvent.mouseEnter(anchor);
    expect(screen.getByTestId("glossary-popover-container")).toBeTruthy();

    fireEvent.mouseLeave(anchor);
    expect(screen.queryByTestId("glossary-popover-container")).toBeNull();
  });

  it("adds and removes the popover testid as the term is focused and blurred (keyboard path)", () => {
    wrap(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>);
    const anchor = screen.getByTestId("glossary-term-container");

    fireEvent.focus(anchor);
    expect(screen.getByTestId("glossary-popover-container")).toBeTruthy();

    fireEvent.blur(anchor);
    expect(screen.queryByTestId("glossary-popover-container")).toBeNull();
  });

  it("does not expose any glossary-term testid for an unknown term (plain-text fallback)", () => {
    // 用語が glossary に無い場合は下線もアンカーも付かないプレーン span を返す
    // ため、glossary-term-* の testid 自体が存在しない。
    wrap(<GlossaryTerm termKey="does-not-exist">謎の用語</GlossaryTerm>);
    expect(screen.queryByTestId("glossary-term-does-not-exist")).toBeNull();
    expect(screen.queryByTestId("glossary-popover-does-not-exist")).toBeNull();
  });
});

describe("GlossaryTerm testid uniqueness across multiple terms (Issue #198)", () => {
  it("identifies each anchor uniquely when several distinct terms are rendered together", () => {
    wrap(
      <>
        <GlossaryTerm termKey="container">コンテナ</GlossaryTerm>
        <GlossaryTerm termKey="bootnode">ブートノード</GlossaryTerm>
      </>,
    );
    expect(screen.getByTestId("glossary-term-container")).toBeTruthy();
    expect(screen.getByTestId("glossary-term-bootnode")).toBeTruthy();
  });

  it("opens only the hovered term's popover, keyed by its own termKey", () => {
    wrap(
      <>
        <GlossaryTerm termKey="container">コンテナ</GlossaryTerm>
        <GlossaryTerm termKey="bootnode">ブートノード</GlossaryTerm>
      </>,
    );
    fireEvent.mouseEnter(screen.getByTestId("glossary-term-container"));

    const popover = screen.getByTestId("glossary-popover-container");
    expect(popover.textContent).toContain("隔離された実行単位");
    // もう一方の popover は開いていない。
    expect(screen.queryByTestId("glossary-popover-bootnode")).toBeNull();
  });

  it("collides testids when the same termKey is rendered more than once (documents the caveat)", () => {
    // 同じ termKey を2箇所で使うと testid は一意にならない。getByTestId は
    // 例外を投げ、識別には getAllByTestId が必要になる。ロケータを組む側が
    // この前提を踏まえられるよう挙動を固定する。
    wrap(
      <>
        <GlossaryTerm termKey="container">コンテナA</GlossaryTerm>
        <GlossaryTerm termKey="container">コンテナB</GlossaryTerm>
      </>,
    );
    expect(() => screen.getByTestId("glossary-term-container")).toThrow();
    expect(screen.getAllByTestId("glossary-term-container")).toHaveLength(2);
  });

  it("opens each duplicate-key popover independently, yielding one popover per opened anchor", () => {
    wrap(
      <>
        <GlossaryTerm termKey="container">コンテナA</GlossaryTerm>
        <GlossaryTerm termKey="container">コンテナB</GlossaryTerm>
      </>,
    );
    const [first, second] = screen.getAllByTestId("glossary-term-container");

    fireEvent.mouseEnter(first);
    expect(screen.getAllByTestId("glossary-popover-container")).toHaveLength(1);

    fireEvent.mouseEnter(second);
    expect(screen.getAllByTestId("glossary-popover-container")).toHaveLength(2);
  });
});
