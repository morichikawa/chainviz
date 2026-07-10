import type { ContractEntity, WorldStateEntity } from "@chainviz/shared";
import type { ContractCatalogEntry } from "../chain-profiles/ethereum/operationCatalog.js";
import { shortHex } from "../entities/transaction.js";

/**
 * 操作パネルの「コントラクト呼び出し」タブで選択できる、キャンバス上の
 * デプロイ済み・カタログ既知コントラクト（ARCHITECTURE.md §6.5「対象:
 * キャンバス上のデプロイ済み・カタログ既知のコントラクトのみ選択肢に出す」）。
 */
export interface DeployedContractCandidate {
  address: string;
  /** `<select>` に出す表示ラベル（表示名 + shortHex(address)）。 */
  label: string;
  catalog: ContractCatalogEntry;
  /**
   * トークン量入力の単位換算（Issue #219）に使うsymbol/decimals。
   * デプロイ済み実体の実測値（`ContractEntity.token`）を優先し、
   * 無ければカタログの静的値（`ContractCatalogEntry.token`）にフォール
   * バックする。どちらにも無ければ`undefined`（トークン単位入力を出さず、
   * 引数はunit指定があっても最小単位の生入力のまま扱われる）。
   */
  token?: { symbol: string; decimals: number };
}

/**
 * ワールドステートのエンティティ群から呼び出し可能なコントラクト候補を導出
 * する。`catalogKey` がカタログに存在しない（フロントの操作カタログに
 * まだ無いキー）、または `catalogKey` 自体が省略されている（未知の
 * コントラクト。§6.4）ものは対象外にする。並び順は address の辞書順。
 */
export function deriveDeployedContracts(
  entities: WorldStateEntity[],
  catalog: ContractCatalogEntry[],
): DeployedContractCandidate[] {
  const catalogByKey = new Map(
    catalog.map((entry) => [entry.catalogKey, entry] as const),
  );

  const contracts = entities.filter(
    (entity): entity is ContractEntity => entity.kind === "contract",
  );

  const candidates: DeployedContractCandidate[] = [];
  for (const contract of contracts) {
    if (contract.catalogKey === undefined) continue;
    const entry = catalogByKey.get(contract.catalogKey);
    if (!entry) continue;
    const name = contract.name ?? entry.catalogKey;
    candidates.push({
      address: contract.address,
      label: `${name} (${shortHex(contract.address)})`,
      catalog: entry,
      token: contract.token ?? entry.token,
    });
  }

  return candidates.sort((a, b) => a.address.localeCompare(b.address));
}
