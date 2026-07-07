// コントラクトのデプロイ検知をチェーン非依存の ContractEntity へ正規化しつつ、
// コントラクトカタログ（Ethereum 固有の ABI 等を保持するデータ）との照合を行う
// 純粋なトラッカー。receipt の contractAddress（Issue #160 で正規化済み）から
// 得られた情報だけを扱い、JSON-RPC の取得自体は呼び出し側（アダプタ）が行う。
//
// カタログとの照合は2経路（docs/ARCHITECTURE.md §4 参照）:
// - runWorkbenchOperation の deployContract 経由のデプロイは、コマンド処理側
//   （EthereumNodeLifecycle）がデプロイ先アドレスとカタログキーの対応を
//   EthereumAdapter.registerContractDeployment 経由で registerDeployment に
//   登録するため確実に照合できる（Issue #161/#163 の統合）。デプロイ検知
//   （ブロック取り込み観測）とこの登録のどちらが先に届いても正しく合流するよう、
//   両方の順序を扱う
// - 手動 forge create 等、登録の無いデプロイは「未知のコントラクト」（address の
//   みを持つ ContractEntity）として扱う。デプロイ済みバイトコードとの照合による
//   特定はここでは行わない（ARCHITECTURE.md の決定: 必須にしない）

import type { ChainType, ContractEntity } from "@chainviz/shared";
import type { ContractCatalog } from "./catalog.js";

/** receipt から得られる、コントラクト作成 tx の最小情報。 */
export interface ContractDeployment {
  address: string;
  deployerAddress: string;
  createdByTxHash: string;
}

/**
 * コントラクトアドレスを小文字へ正規化する。同一コントラクトのアドレスでも
 * 入力元によって表記が食い違う（実測: reth の eth_getBlockReceipts の
 * contractAddress は全小文字、forge create の "Deployed to:" 行は EIP-55
 * チェックサム表記で大小混在）ため、ContractTracker が Map キー・
 * ContractEntity.address として扱う表記をここで一本化する。tx.to 等の
 * RPC 由来アドレスも同様に小文字表記であるため、フロント側で他のアドレス
 * フィールドと突き合わせる際の表記もこれで揃う。
 */
function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export class ContractTracker {
  private readonly contracts = new Map<string, ContractEntity>();
  // まだデプロイを検知していないアドレスに対して先に登録されたカタログキー
  // （deployContract がデプロイ先アドレスを知った時点で、ブロック取り込みの
  // 検知より先に registerDeployment が呼ばれるケースに対応する）。
  private readonly pendingCatalogKeys = new Map<string, string>();

  constructor(
    private readonly chainType: ChainType,
    private readonly catalog: ContractCatalog | undefined,
    private readonly log: (message: string, detail?: unknown) => void = (
      message,
      detail,
    ) => console.warn(message, detail),
  ) {}

  /**
   * ブロック取り込みで検知したコントラクト作成を記録する。同一アドレスを
   * 既に追跡済みなら null を返す（デプロイは一度きりの出来事で、複数ノードが
   * 同一ブロックを重複通知しても以後は変化しない）。初出なら
   * ContractEntity を生成し、保留中のカタログキー登録（pendingCatalogKeys）が
   * あればその場で適用して返す。
   */
  recordDeployment(deployment: ContractDeployment): ContractEntity | null {
    const address = normalizeAddress(deployment.address);
    if (this.contracts.has(address)) return null;
    let entity: ContractEntity = {
      kind: "contract",
      address,
      chainType: this.chainType,
      deployerAddress: deployment.deployerAddress,
      createdByTxHash: deployment.createdByTxHash,
    };
    const pendingKey = this.pendingCatalogKeys.get(address);
    if (pendingKey) {
      entity = this.applyCatalog(entity, pendingKey);
      this.pendingCatalogKeys.delete(address);
    }
    this.contracts.set(address, entity);
    return entity;
  }

  /**
   * runWorkbenchOperation(deployContract) 経由のデプロイについて、デプロイ先
   * アドレスとカタログキーの対応をあらかじめ（または事後に）登録する。
   *
   * - まだそのアドレスのデプロイを検知していない場合は登録だけ保留し、
   *   recordDeployment が呼ばれた時点で適用する（この場合は null を返す。
   *   呼び出し側は recordDeployment の戻り値を配信すればよい）
   * - 既に「未知のコントラクト」として追跡済み（recordDeployment 済みだが
   *   catalogKey 未確定）なら、その場でカタログ情報を埋めて更新後の
   *   ContractEntity を返す（呼び出し側はこれを onContract へ渡し
   *   entityUpdated として配信する）
   * - 指定された contractKey がカタログに存在しない場合は何もしない
   *   （呼び出し側のバグの可能性があるため警告ログを残す。エラーを
   *   握りつぶさない）
   */
  registerDeployment(rawAddress: string, contractKey: string): ContractEntity | null {
    const address = normalizeAddress(rawAddress);
    if (!this.catalog?.[contractKey]) {
      this.log(
        `[ethereum] registerDeployment: unknown catalog key "${contractKey}" for ${address}; ignoring`,
      );
      return null;
    }
    const existing = this.contracts.get(address);
    if (!existing) {
      this.pendingCatalogKeys.set(address, contractKey);
      return null;
    }
    if (existing.catalogKey === contractKey) return null; // 変化なし
    const updated = this.applyCatalog(existing, contractKey);
    this.contracts.set(address, updated);
    return updated;
  }

  /** 現在追跡しているコントラクトの状態（テスト・確認用）。 */
  get(address: string): ContractEntity | undefined {
    return this.contracts.get(normalizeAddress(address));
  }

  private applyCatalog(entity: ContractEntity, contractKey: string): ContractEntity {
    const catalogEntry = this.catalog?.[contractKey];
    if (!catalogEntry) return entity; // カタログ側に無いキー: 未知のまま
    return {
      ...entity,
      name: catalogEntry.name,
      catalogKey: contractKey,
      ...(catalogEntry.token ? { token: catalogEntry.token } : {}),
    };
  }
}
