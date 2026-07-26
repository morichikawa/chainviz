// Issue #413 テスト強化: 用語データ（YAML）と UI 文言（messages.ts）が別
// ファイルであることに起因する「静かな食い違い」を固定する。Issue #420 の
// internalLinkKinds.glossaryConsistency.test.ts と同じ狙い。
//
// 1. アンカーに表示するテキスト（`*.term` の3分割キー）が、その用語の名前と
//    ずれていないこと。ずれると「フロントランニング」と書かれたアンカーを
//    ホバーしたら別名の用語が出る、という状態になる
// 2. 新設6語の定義文が「chainviz のどこで見えるか」として挙げている UI の
//    表示名が、実際の UI 文言と一致していること（片方だけ改名されると、
//    存在しない欄を案内する説明文が残る）
import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages.js";
import { loadRealGlossary } from "./realGlossaryFixture.js";

const glossary = loadRealGlossary();

/**
 * 用語 YAML の定義文は折りたたみブロックスカラー（`>-`）で書かれており、行の
 * 折り返し位置に半角空白が入る。日本語は語間に空白を置かないため、この空白は
 * 文中の任意の位置に現れうる（repo 全体の既存エントリも同様）。日本語の語句を
 * 部分一致で探す用途では空白を落として比較する。
 */
function withoutSpaces(text: string): string {
  return text.replace(/ /g, "");
}

/** アンカーの `*.term` 文言キーと、その参照先の用語キーの対応。 */
const ANCHOR_LABEL_KEYS = [
  { termKey: "eclipseAttack", messageKey: "legend.eclipseHint.term" },
  { termKey: "doubleSpend", messageKey: "tx.lifecycle.doubleSpendHint.term" },
  { termKey: "frontRunning", messageKey: "mempoolPanel.frontRunningHint.term" },
] as const;

describe("anchor label vs. glossary term name (Issue #413)", () => {
  it.each(ANCHOR_LABEL_KEYS)(
    "$messageKey matches the ja name of $termKey",
    ({ termKey, messageKey }) => {
      expect(messages[messageKey].ja).toBe(glossary[termKey].name.ja);
    },
  );

  it.each(ANCHOR_LABEL_KEYS)(
    "$messageKey matches the en name of $termKey (ignoring sentence-position case)",
    ({ termKey, messageKey }) => {
      // 英語のアンカーは文中に置くため先頭を小文字にしている（例:
      // "eclipse attack" と "Eclipse attack"）。大文字小文字だけの差は許す。
      expect(messages[messageKey].en.toLowerCase()).toBe(
        glossary[termKey].name.en.toLowerCase(),
      );
    },
  );
});

describe("attack term definitions vs. the UI labels they cite (Issue #413)", () => {
  it("reorg cites the actual 'following tip' field label", () => {
    // reorg の定義文は InfraPopover の該当欄を名指しで案内している
    // （フォーク色分け。ARCHITECTURE.md §9）。`field.headTip` を改名したら
    // 定義文も直す必要がある。
    const entry = glossary.reorg;
    expect(withoutSpaces(entry.definition.ja)).toContain(
      withoutSpaces(messages["field.headTip"].ja),
    );
    expect(entry.definition.en).toContain(messages["field.headTip"].en);
  });

  it("doubleSpend cites the actual 'included' tx status label", () => {
    const entry = glossary.doubleSpend;
    expect(withoutSpaces(entry.definition.ja)).toContain(
      withoutSpaces(messages["tx.status.included"].ja),
    );
    expect(entry.definition.en.toLowerCase()).toContain(
      messages["tx.status.included"].en.toLowerCase(),
    );
  });

  it("frontRunning cites the actual mempool panel title", () => {
    const entry = glossary.frontRunning;
    expect(withoutSpaces(entry.definition.ja)).toContain(
      withoutSpaces(messages["mempoolPanel.title"].ja),
    );
    expect(entry.definition.en.toLowerCase()).toContain(
      messages["mempoolPanel.title"].en.toLowerCase(),
    );
  });
});

describe("sandbox-dependent definitions stay consistent with what exists (Issue #413)", () => {
  // 51%攻撃・ロングレンジ攻撃・Eclipse攻撃の3語は「独立シミュレーション
  // 砂場で体験できる」と説明している（Issue #414/#415/#416 で実装予定。
  // docs/worklog/issue-413.md の申し送り）。砂場そのものは本 Issue 時点では
  // 存在しないため、定義文が「チェーン上で再現できる」と読める書き方に
  // 逆戻りしていないことだけを固定する。
  it.each(["fiftyOnePercentAttack", "longRangeAttack", "eclipseAttack"] as const)(
    "%s explains that it is explored in a standalone sandbox, not on the live chain",
    (key) => {
      const entry = glossary[key];
      expect(withoutSpaces(entry.definition.ja)).toContain("独立シミュレーション砂場");
      expect(entry.definition.en.toLowerCase()).toContain("standalone simulation sandbox");
    },
  );

  it("does not promise a sandbox for doubleSpend / frontRunning", () => {
    // この2語は既存可視化の組み合わせで体感する方針（設計メモ §2）。
    // 砂場を作らないと明記しているため、砂場前提の文面が混ざっていないこと。
    for (const key of ["doubleSpend", "frontRunning"] as const) {
      expect(withoutSpaces(glossary[key].definition.ja)).not.toContain(
        "独立シミュレーション砂場",
      );
      expect(glossary[key].definition.en.toLowerCase()).not.toContain(
        "standalone simulation sandbox",
      );
    }
  });
});
