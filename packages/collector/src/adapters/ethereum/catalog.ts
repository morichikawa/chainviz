// profiles/ethereum/contracts/catalog.json の読み込み部分。
// カタログはコントラクトカタログキー（Solidity のコントラクト名そのまま。
// 例: "ChainvizToken"）→ 表示名・ABI・token メタ情報を持つデータファイル
// （docs/ARCHITECTURE.md §4「コントラクトカタログ」参照）。
//
// ABI はこのファイル・呼び出し元（アダプタ配下）でのみ保持し、ワールドステート
// （ContractEntity）には一切漏らさない（ChainAdapter 境界）。関数呼び出し・
// イベントログの復号（Issue #162）でこの ABI を使う想定。

import { readFileSync } from "node:fs";
import path from "node:path";

/** カタログ同梱のソースコード（catalog.json の source フィールド。Issue #321）。 */
export interface CatalogSource {
  /** 表示用のファイル名（例: "ChainvizToken.sol"）。 */
  fileName: string;
  /** ソースの言語を表す生の識別子（例: "solidity"）。解釈はフロント側の責務。 */
  language: string;
  /** ソースコード全文。 */
  code: string;
}

/** カタログ 1 件（catalog.json の値部分）。 */
export interface CatalogEntry {
  /** 人が読める表示名（ContractEntity.name にそのまま入る）。 */
  name: string;
  /** EVM の ABI（このファイル・関数呼び出し/イベント復号ロジックの内側でのみ使う）。 */
  abi: unknown[];
  /** トークンコントラクトの場合のみ。ContractEntity.token にそのまま入る。 */
  token?: { symbol: string; decimals: number };
  /**
   * カタログ同梱のソースコード（Issue #321）。ContractEntity.sourceCode に
   * そのまま転記される（contracts.ts の applyCatalog 参照）。build-catalog.sh
   * が同梱しなかった（または不正な形の）場合は undefined になり、カタログの
   * エントリ自体は生かしたまま「ソース無し」として扱う（下記 isValidSource 参照）。
   */
  source?: CatalogSource;
}

/** カタログキー（PascalCase のコントラクト名）→ CatalogEntry のマップ。 */
export type ContractCatalog = Record<string, CatalogEntry>;

/** JSON.parse 直後の未検証の値からカタログエントリらしきものを検証する。 */
function isValidEntry(value: unknown): value is CatalogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.name === "string" && Array.isArray(entry.abi);
}

/**
 * source フィールドが fileName/language/code の 3 つとも string であるかを
 * 検証する。token と異なりここで実際に検証する（設計メモの決定）: ソースは
 * 人間が読む全文テキストであり、想定外の形（例: code が文字列でない）を
 * そのままフロントへ渡すと表示が壊れるため。不正な場合はエントリ自体は
 * 落とさず、source だけ無い扱いにする（呼び出し側で理由をログに残す）。
 */
function isValidSource(value: unknown): value is CatalogSource {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.fileName === "string" &&
    typeof source.language === "string" &&
    typeof source.code === "string"
  );
}

/**
 * profiles/ethereum の絶対パス（profileDir）から contracts/catalog.json を読み、
 * ContractCatalog を返す。ファイルが無い・読めない・JSON として不正・想定した
 * 形（各エントリが name/abi を持つオブジェクト）でない場合は undefined を返す。
 *
 * 呼び出し側（EthereumAdapter）はカタログ無しでも起動を継続し、コントラクトの
 * デプロイ検知自体は続けるが、名前/token などカタログ由来の情報は付与しない
 * （「未知のコントラクト」として扱う。docs/ARCHITECTURE.md §4 の「復号機能のみ
 * 縮退して起動継続」の方針）。
 *
 * 読み込み・パース失敗はここで具体的な理由（ファイルパス・例外内容）をログに
 * 残す（CLAUDE.md「エラーを握りつぶさない」原則。log は既定で console.error だが
 * テストで差し替え可能）。
 */
export function readContractCatalog(
  profileDir: string,
  log: (message: string, detail: unknown) => void = (message, detail) =>
    console.error(message, detail),
): ContractCatalog | undefined {
  const filePath = path.join(profileDir, "contracts", "catalog.json");
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    log(
      `[ethereum] failed to read contract catalog at ${filePath}; contract decoding disabled:`,
      err,
    );
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    log(
      `[ethereum] failed to parse contract catalog at ${filePath} as JSON; contract decoding disabled:`,
      err,
    );
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    log(
      `[ethereum] contract catalog at ${filePath} is not a JSON object; contract decoding disabled:`,
      parsed,
    );
    return undefined;
  }

  const catalog: ContractCatalog = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isValidEntry(value)) {
      log(
        `[ethereum] contract catalog entry "${key}" at ${filePath} is missing name/abi; skipping it:`,
        value,
      );
      continue;
    }
    if (value.source !== undefined && !isValidSource(value.source)) {
      log(
        `[ethereum] contract catalog entry "${key}" at ${filePath} has a malformed source field; keeping the entry without source:`,
        value.source,
      );
      catalog[key] = { ...value, source: undefined };
      continue;
    }
    catalog[key] = value;
  }
  return catalog;
}
