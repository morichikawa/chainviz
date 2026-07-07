// コントラクトのデプロイ検知をチェーン非依存の ContractEntity へ正規化しつつ、
// コントラクトカタログ（Ethereum 固有の ABI 等を保持するデータ）との照合を行う
// 純粋なトラッカー。receipt の contractAddress（Issue #160 で正規化済み）から
// 得られた情報だけを扱い、JSON-RPC の取得自体は呼び出し側（アダプタ）が行う。
//
// カタログとの照合は2経路（docs/ARCHITECTURE.md §4 参照）:
// - runWorkbenchOperation の deployContract 経由のデプロイは、コマンド処理側が
//   デプロイ先アドレスとカタログキーの対応を registerDeployment で登録するため
//   確実に照合できる（Issue #163 が呼び出す想定）。デプロイ検知（ブロック取り込み
//   観測）とこの登録のどちらが先に届いても正しく合流するよう、両方の順序を扱う
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
    if (this.contracts.has(deployment.address)) return null;
    let entity: ContractEntity = {
      kind: "contract",
      address: deployment.address,
      chainType: this.chainType,
      deployerAddress: deployment.deployerAddress,
      createdByTxHash: deployment.createdByTxHash,
    };
    const pendingKey = this.pendingCatalogKeys.get(deployment.address);
    if (pendingKey) {
      entity = this.applyCatalog(entity, pendingKey);
      this.pendingCatalogKeys.delete(deployment.address);
    }
    this.contracts.set(deployment.address, entity);
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
  registerDeployment(address: string, contractKey: string): ContractEntity | null {
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
    return this.contracts.get(address);
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
