import type { ReactNode } from "react";
import { GlossaryTerm } from "./GlossaryTerm.js";

/**
 * UI 文言（`{ja, en}` 形式）は1つの完結した文のまま保ち、表示側でその中の
 * 該当語（`term`）だけを `GlossaryTerm` に差し替えるためのヘルパー。元は
 * `ContractPopover.tsx` の `withAbiAnchor`（未知コントラクトの説明文中の
 * 「ABI」だけに用語解説アンカーを付ける処理）だったが、Issue #321 で
 * コントラクトソースビューの「ソースコードが手元に無い」説明文にも同じ
 * 流儀を使うため、対象語・用語キーを引数化して汎用化した。
 *
 * 文言に `term` という部分文字列が含まれない場合（訳文の変更などで
 * 一致しなくなった場合）は、アンカーを付けずそのままの文を返す防御的
 * フォールバック。`term` が文中に複数回現れても最初の1箇所のみを
 * アンカー化する（既存の `withAbiAnchor` と同じ挙動）。
 */
export function withTermAnchor(
  text: string,
  term: string,
  termKey: string,
): ReactNode {
  const idx = text.indexOf(term);
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const after = text.slice(idx + term.length);
  return (
    <>
      {before}
      <GlossaryTerm termKey={termKey}>{term}</GlossaryTerm>
      {after}
    </>
  );
}
