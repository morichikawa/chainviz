import type { ContractEntity, ContractSourceCode } from "@chainviz/shared";
import { useMemo } from "react";
import { resolveSourceLines } from "../chain-profiles/ethereum/sourceTokenizer.js";
import { shortHex } from "../entities/transaction.js";
import { withTermAnchor } from "../glossary/withTermAnchor.js";
import { useLanguage } from "../i18n/LanguageProvider.js";

export interface ContractSourceViewProps {
  contract: ContractEntity;
}

/**
 * サイドパネル（kind: "contractSource"）の中身（Issue #321。
 * docs/worklog/issue-321.md §12.3）。カタログ同梱のソース
 * （`ContractEntity.sourceCode`）があれば行番号付き・シンタックスハイライト
 * 付きで全文を表示し、無ければ「ソースコードが手元に無いため表示できない」
 * ことを明示する。未知のコントラクト（`name` 省略）にも同じ説明を出す
 * （ボタンを隠すより「なぜ見られないか」を学べる方が学習アプリとして価値が
 * あるという設計判断。ARCHITECTURE.md §6.4 と同じ方針）。
 *
 * ダングリングガード（対象アドレスのエンティティが world state から消えた
 * 場合にパネルを閉じる処理）は呼び出し側の `SidePanelHost` が担う。
 * このコンポーネント自体は渡された `contract` をそのまま表示するだけの
 * 純粋な表示コンポーネント。
 */
export function ContractSourceView({ contract }: ContractSourceViewProps) {
  const { t } = useLanguage();
  const name = contract.name ?? t("contract.unknown");

  return (
    <div data-testid="contract-source-view">
      <div className="contract-source-view__header">
        <span className="contract-source-view__name">{name}</span>
        <span className="contract-source-view__address">
          {shortHex(contract.address)}
        </span>
      </div>
      {contract.sourceCode === undefined ? (
        <p
          className="contract-source-view__unavailable"
          data-testid="contract-source-unavailable"
        >
          {withTermAnchor(t("contractSource.unavailable"), "ABI", "abi")}
        </p>
      ) : (
        <SourceCodeBlock sourceCode={contract.sourceCode} />
      )}
    </div>
  );
}

function SourceCodeBlock({ sourceCode }: { sourceCode: ContractSourceCode }) {
  const lines = useMemo(
    () => resolveSourceLines(sourceCode.code, sourceCode.language),
    [sourceCode.code, sourceCode.language],
  );

  return (
    <div className="contract-source-view__file">
      <div className="contract-source-view__filename">{sourceCode.fileName}</div>
      <pre className="contract-source-view__code" data-testid="contract-source-code">
        {lines.map((line, lineIndex) => (
          // 行の並びはソース全文が変わるたびに丸ごと作り直されるため
          // （ドラッグ等で個別行が並び替わることは無い）、行番号をキーに
          // 使っても問題ない。
          <div className="contract-source-view__line" key={lineIndex}>
            <span className="contract-source-view__line-number">
              {lineIndex + 1}
            </span>
            <code className="contract-source-view__line-content">
              {line.length === 0
                ? " " // 空行でも行の高さを保つ（no-break space）。
                : line.map((token, tokenIndex) => (
                    <span
                      key={tokenIndex}
                      className={
                        token.kind === "plain"
                          ? undefined
                          : `contract-source-view__token contract-source-view__token--${token.kind}`
                      }
                    >
                      {token.text}
                    </span>
                  ))}
            </code>
          </div>
        ))}
      </pre>
    </div>
  );
}
