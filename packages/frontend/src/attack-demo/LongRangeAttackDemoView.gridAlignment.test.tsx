// 「3段（正規・checkpoint・攻撃者）が同じブロック番号で同じ列に並ぶ」
// 「共有区間（#0・#1）は本当に同じハッシュとして描かれている」ことを、
// 関数の戻り値ではなく実際に描かれた DOM のインラインスタイル・表示文字列で
// 確認する補強テスト（Issue #415 テスト強化）。
// 列計算そのものの不変条件は longRangeAttackDemo.gridInvariants.test.ts、
// 操作フローは LongRangeAttackDemoView.checkpointSequence.test.tsx が扱う
// （CLAUDE.md の1ファイル1責務）。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { LongRangeAttackDemoView } from "./LongRangeAttackDemoView.js";
import { ATTACKER_CHAIN, CANONICAL_CHAIN, DIVERGE_AT } from "./longRangeAttackDemo.js";

afterEach(cleanup);

const CANONICAL_NUMBERS = CANONICAL_CHAIN.map((block) => block.number);
const ATTACKER_NUMBERS = ATTACKER_CHAIN.map((block) => block.number);
const SHARED_NUMBERS = CANONICAL_NUMBERS.filter((number) => number < DIVERGE_AT);
const DIVERGED_NUMBERS = CANONICAL_NUMBERS.filter((number) => number >= DIVERGE_AT);

function renderView() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <LongRangeAttackDemoView />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

/** タイル要素を包む grid セル（`grid-row`/`grid-column` を持つ親）。 */
function cellOf(testId: string): HTMLElement {
  return screen.getByTestId(testId).parentElement as HTMLElement;
}

function columnOf(testId: string): string {
  return cellOf(testId).style.gridColumn;
}

function rowOf(testId: string): number {
  return Number(cellOf(testId).style.gridRow);
}

/** タイル内に表示されている完全なハッシュ（`title` 属性）。 */
function fullHashOf(testId: string): string | null {
  return screen
    .getByTestId(testId)
    .querySelector(".long-range-demo__tile-hash")
    ?.getAttribute("title") as string | null;
}

/** タイル内に表示されている短縮ハッシュ（画面に見える文字列）。 */
function shownHashOf(testId: string): string | undefined {
  return screen.getByTestId(testId).querySelector(".long-range-demo__tile-hash")?.textContent ?? undefined;
}

describe("LongRangeAttackDemoView: the three rows share one column grid", () => {
  it("puts the canonical tile, the checkpoint chip and the attacker tile of a block number in the same column", () => {
    renderView();
    for (const number of CANONICAL_NUMBERS) {
      const canonicalColumn = columnOf(`long-range-demo-canonical-tile-${number}`);
      expect(canonicalColumn).not.toBe("");
      expect(columnOf(`long-range-demo-checkpoint-${number}`)).toBe(canonicalColumn);
      expect(columnOf(`long-range-demo-attacker-tile-${number}`)).toBe(canonicalColumn);
    }
  });

  it("stacks the rows in reading order: canonical → checkpoint chips → attacker", () => {
    renderView();
    const canonicalRow = rowOf(`long-range-demo-canonical-tile-0`);
    const chipRow = rowOf(`long-range-demo-checkpoint-0`);
    const attackerRow = rowOf(`long-range-demo-attacker-tile-0`);
    expect(canonicalRow).toBeLessThan(chipRow);
    expect(chipRow).toBeLessThan(attackerRow);
  });

  it("reserves column 1 for the row labels", () => {
    renderView();
    expect(screen.getByTestId("long-range-demo-canonical-label").style.gridColumn).toBe("1");
    expect(screen.getByTestId("long-range-demo-attacker-label").style.gridColumn).toBe("1");
  });

  it("never lets a connector share a column with any tile", () => {
    renderView();
    const tileColumns = new Set(
      ATTACKER_NUMBERS.map((number) => columnOf(`long-range-demo-attacker-tile-${number}`)),
    );
    for (const number of ATTACKER_NUMBERS.slice(0, -1)) {
      const link = screen.getByTestId(`long-range-demo-attacker-link-${number}`);
      expect(tileColumns.has(link.style.gridColumn)).toBe(false);
    }
  });

  it("shows one checkpoint chip per canonical block and none for the attacker's extra tip", () => {
    renderView();
    const attackerTip = ATTACKER_NUMBERS[ATTACKER_NUMBERS.length - 1]!;
    for (const number of CANONICAL_NUMBERS) {
      expect(screen.getByTestId(`long-range-demo-checkpoint-${number}`)).toBeTruthy();
    }
    expect(screen.queryByTestId(`long-range-demo-checkpoint-${attackerTip}`)).toBeNull();
    expect(screen.queryByTestId(`long-range-demo-canonical-tile-${attackerTip}`)).toBeNull();
  });

  it("places the attacker's extra tip tile in its own column past the canonical tip", () => {
    renderView();
    const canonicalTip = CANONICAL_NUMBERS[CANONICAL_NUMBERS.length - 1]!;
    const attackerTip = ATTACKER_NUMBERS[ATTACKER_NUMBERS.length - 1]!;
    expect(Number(columnOf(`long-range-demo-attacker-tile-${attackerTip}`))).toBe(
      Number(columnOf(`long-range-demo-canonical-tile-${canonicalTip}`)) + 2,
    );
  });
});

describe("LongRangeAttackDemoView: shared prefix vs diverged blocks as rendered", () => {
  it.each(SHARED_NUMBERS)("renders block #%i with the identical hash on both rows", (number) => {
    renderView();
    const canonicalHash = fullHashOf(`long-range-demo-canonical-tile-${number}`);
    expect(canonicalHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fullHashOf(`long-range-demo-attacker-tile-${number}`)).toBe(canonicalHash);
    // 画面に見える短縮表示も一致すること（同じ列に同じ文字列が並ぶ、という
    // 「ここまでは同じ歴史」の見え方そのもの）。
    expect(shownHashOf(`long-range-demo-attacker-tile-${number}`)).toBe(
      shownHashOf(`long-range-demo-canonical-tile-${number}`),
    );
  });

  it.each(DIVERGED_NUMBERS)("renders block #%i with different hashes on the two rows", (number) => {
    renderView();
    expect(fullHashOf(`long-range-demo-attacker-tile-${number}`)).not.toBe(
      fullHashOf(`long-range-demo-canonical-tile-${number}`),
    );
    expect(shownHashOf(`long-range-demo-attacker-tile-${number}`)).not.toBe(
      shownHashOf(`long-range-demo-canonical-tile-${number}`),
    );
  });

  it("marks the attacker's tiles as forked starting exactly at the divergence point", () => {
    renderView();
    for (const number of ATTACKER_NUMBERS) {
      const forked = screen
        .getByTestId(`long-range-demo-attacker-tile-${number}`)
        .className.includes("--fork");
      expect(forked).toBe(number >= DIVERGE_AT);
    }
  });

  it("draws the dashed connector only at the divergence point of the attacker row", () => {
    renderView();
    for (const number of ATTACKER_NUMBERS.slice(0, -1)) {
      const broken = screen
        .getByTestId(`long-range-demo-attacker-link-${number}`)
        .className.includes("--broken");
      expect(broken).toBe(number === DIVERGE_AT - 1);
    }
  });

  it("keeps every canonical connector solid", () => {
    renderView();
    for (const number of CANONICAL_NUMBERS.slice(0, -1)) {
      expect(
        screen.getByTestId(`long-range-demo-canonical-link-${number}`).className,
      ).not.toContain("--broken");
    }
    // 末尾のブロックからは線が伸びない（タイル数 - 1 本）。
    expect(
      screen.queryByTestId(
        `long-range-demo-canonical-link-${CANONICAL_NUMBERS[CANONICAL_NUMBERS.length - 1]}`,
      ),
    ).toBeNull();
  });

  it("attaches the rival note to the attacker's first rewritten block only", () => {
    renderView();
    // 注記が「分岐後の最初のブロック」のセルの中にあること（セルの同一性で
    // 見る。列番号の比較だけでは同じセルを2通りに読んでいるだけになる）。
    const noteCell = screen.getByTestId("long-range-demo-rival-note").parentElement as HTMLElement;
    expect(
      noteCell.contains(screen.getByTestId(`long-range-demo-attacker-tile-${DIVERGE_AT}`)),
    ).toBe(true);
    // 他のブロックのセルには注記が無い（画面全体で1つだけ）。
    expect(screen.getAllByTestId("long-range-demo-rival-note").length).toBe(1);
    for (const number of ATTACKER_NUMBERS.filter((value) => value !== DIVERGE_AT)) {
      const cell = cellOf(`long-range-demo-attacker-tile-${number}`);
      expect(cell.querySelector('[data-testid="long-range-demo-rival-note"]')).toBeNull();
    }
  });
});
