// Issue #427 の DOM 側ガード。親ブロック行は、親が保持窓内に無い1個目の
// ブロック（`navigation.parent === undefined`）では `<div class="infra-field">`、
// 親がある2個目以降では `<button class="block-detail-view__parent-link infra-field ...">`
// と、要素の種類が変わる。この2つの見た目を揃えるために button 側は
// `.infra-field` を併用して font-size / flex レイアウトを共有している。
//
// styles.css 側の回帰テスト（blockDetailParentLinkFont.css.test.ts /
// blockDetailParentLinkButtonDefaults.css.test.ts）は「CSS が正しいこと」
// しか見ていないため、button から `infra-field` クラスが落ちる変更が入ると
// CSS テストは緑のまま Issue #427 と同じ症状（button だけ
// `.side-panel__body` の大きい font-size を継承する）が再発する。
// ここではレンダリング結果のクラス構成・子要素構成が2分岐で一致することを
// 固定する。
//
// 前後ナビゲーション・フィールドの表示内容そのものは
// BlockDetailView.test.tsx が担当する（1ファイル1責務）。
import type { BlockEntity, ContractEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockNavigation } from "../entities/blockDetail.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { BlockDetailView, type BlockDetailViewProps } from "./BlockDetailView.js";

afterEach(cleanup);

const TARGET_HASH = `0x${"a".repeat(64)}`;
const PARENT_HASH = `0x${"b".repeat(64)}`;

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 42,
    parentHash: PARENT_HASH,
    timestamp: 1_700_000_000,
    receivedAt: {},
    ...overrides,
  };
}

function renderView(navigation: BlockNavigation) {
  const target = block({ hash: TARGET_HASH });
  const blocksByHash = new Map<string, BlockEntity>([[TARGET_HASH, target]]);
  if (navigation.parent) blocksByHash.set(navigation.parent.hash, navigation.parent);
  const props: BlockDetailViewProps = {
    block: target,
    navigation,
    receivedOrder: [],
    visibleTransactions: [],
    totalTxCount: 0,
    overflowCount: 0,
    contractsByAddress: new Map<string, ContractEntity>(),
    blocksByHash,
    onNavigate: vi.fn(),
  };
  const { container } = render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <BlockDetailView {...props} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
  return container;
}

const noParent: BlockNavigation = { parent: undefined, child: undefined, isLatest: false };
const withParent: BlockNavigation = {
  parent: block({ hash: PARENT_HASH, number: 41 }),
  child: undefined,
  isLatest: false,
};

/** 親hash行の要素（button 分岐 / div 分岐のどちらでも取れる）。 */
function parentRow(container: HTMLElement): HTMLElement {
  const button = container.querySelector<HTMLElement>(".block-detail-view__parent-link");
  if (button) return button;
  // div 分岐: 親hashの全文を値に持つ `.infra-field` を探す。
  const rows = [...container.querySelectorAll<HTMLElement>(".infra-field")];
  const row = rows.find(
    (el) => el.querySelector(".infra-field__value")?.textContent === PARENT_HASH,
  );
  if (!row) throw new Error("parent hash row not found");
  return row;
}

describe("BlockDetailView: parent row parity between the button and non-button branches", () => {
  it("renders the parent row as a <button> that also carries .infra-field when a parent exists", () => {
    // `.infra-field` が外れると font-size の供給源が消え、Issue #427 の
    // 症状（サイドパネル本文の 16px を継承して行だけ大きくなる）が戻る。
    const row = parentRow(renderView(withParent));
    expect(row.tagName).toBe("BUTTON");
    expect(row.classList.contains("block-detail-view__parent-link")).toBe(true);
    expect(row.classList.contains("infra-field")).toBe(true);
  });

  it("renders the parent row as a plain .infra-field element when there is no parent", () => {
    const row = parentRow(renderView(noParent));
    expect(row.tagName).toBe("DIV");
    expect(row.classList.contains("infra-field")).toBe(true);
    expect(row.classList.contains("block-detail-view__parent-link")).toBe(false);
  });

  it("uses the same label/value child structure in both branches", () => {
    // 子要素の構造が揃っていて初めて `.infra-field` の
    // `display: flex; justify-content: space-between` が同じ見た目になる。
    for (const nav of [noParent, withParent]) {
      const row = parentRow(renderView(nav));
      expect(row.querySelectorAll(":scope > .infra-field__label").length).toBe(1);
      expect(row.querySelectorAll(":scope > .infra-field__value").length).toBe(1);
      expect(row.querySelector(".infra-field__value")?.textContent).toBe(PARENT_HASH);
      cleanup();
    }
  });

  it("keeps the button out of the canvas drag handler via the nodrag class", () => {
    // `nodrag` はキャンバス側のドラッグ抑止用クラスで見た目には効かないが、
    // className 文字列をまとめて書き換える変更で一緒に落ちやすいため固定する。
    const row = parentRow(renderView(withParent));
    expect(row.classList.contains("nodrag")).toBe(true);
  });

  it("does not add the parent-link class to the other .infra-field rows", () => {
    // hash 行・timestamp 行までボタン化リセットの影響を受けていないこと。
    const container = renderView(withParent);
    const rows = [...container.querySelectorAll(".infra-field")];
    expect(rows.length).toBeGreaterThan(1);
    const linked = rows.filter((el) => el.classList.contains("block-detail-view__parent-link"));
    expect(linked.length).toBe(1);
  });

  it("uses the accessible-by-default <button> only for the navigable branch", () => {
    // 親が無い場合はクリックできない見た目にする（`<div>` のまま）ことで、
    // 「押せそうなのに押せない」行が生まれないようにしている。
    renderView(noParent);
    expect(screen.queryByTestId(`block-detail-parent-link-${TARGET_HASH}`)).toBeNull();
    cleanup();
    renderView(withParent);
    expect(screen.getByTestId(`block-detail-parent-link-${TARGET_HASH}`).tagName).toBe("BUTTON");
  });
});
