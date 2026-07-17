import type { WorldStateEntity } from "@chainviz/shared";

/**
 * node/workbench の表示名を解決する（設計メモ §5.1「表示名はカードと同じ
 * 解決を再利用する」）。ただしカード本体（InfraNodeCard）のタイトルは両kind
 * とも `containerName` だが、通信ログはワークベンチ側を人が付けた `label`
 * （例: "Alice"）で示す設計（設計メモ §5.1 の例 "Alice のワークベンチ →
 * chainviz-reth-1"）のため、workbench だけ label を優先する。
 *
 * 対象エンティティが見つからない（既に削除済み・観測前）場合は id をそのまま
 * 返す（何も表示しないより、起きた事実自体は伝える。ARCHITECTURE.md §6.4と
 * 同じ「隠すより正直に出す」判断）。
 */
export function resolveActorLabel(
  entities: Readonly<Record<string, WorldStateEntity>>,
  id: string,
): string {
  const entity = entities[id];
  if (entity === undefined) return id;
  if (entity.kind === "node") return entity.containerName;
  if (entity.kind === "workbench") return entity.label;
  return id;
}
