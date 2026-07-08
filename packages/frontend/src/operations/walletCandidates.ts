import type { WalletEntity, WorldStateEntity } from "@chainviz/shared";
import { shortHex } from "../entities/transaction.js";

/**
 * 操作パネルの送金先／アドレス型引数の入力補助に出す、キャンバス上の既存
 * ウォレット候補（ARCHITECTURE.md §6.5「宛先: キャンバス上の既存ウォレット
 * から選択（表示は shortHex ＋ 所有ワークベンチのラベル）。自由入力（アドレス
 * 直打ち）も可」）。
 */
export interface WalletCandidate {
  address: string;
  /** `<datalist>` に出す表示ラベル（`shortHex(address)` + 所有ワークベンチ名）。 */
  label: string;
}

/**
 * ワールドステートのエンティティ群から `WalletCandidate` 一覧を導出する。
 * 所有ワークベンチが存在する場合はラベルにそのラベルを添え、所有者が無い
 * （削除済み・未所有）場合はアドレスのみのラベルにする。並び順は address の
 * 辞書順で安定させる。
 */
export function deriveWalletCandidates(
  entities: WorldStateEntity[],
): WalletCandidate[] {
  const workbenchLabelById = new Map<string, string>();
  for (const entity of entities) {
    if (entity.kind === "workbench") {
      workbenchLabelById.set(entity.id, entity.label);
    }
  }

  const wallets = entities.filter(
    (entity): entity is WalletEntity => entity.kind === "wallet",
  );

  return wallets
    .map((wallet) => {
      const ownerLabel = wallet.ownerWorkbenchId
        ? workbenchLabelById.get(wallet.ownerWorkbenchId)
        : undefined;
      const label = ownerLabel
        ? `${shortHex(wallet.address)} (${ownerLabel})`
        : shortHex(wallet.address);
      return { address: wallet.address, label };
    })
    .sort((a, b) => a.address.localeCompare(b.address));
}
