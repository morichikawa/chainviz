// UI 層 E2E（Playwright）の各スペックが共通で使う、compose サービス名から
// エンティティ id（React Flow ノード/エッジの id にもなる安定 ID）を組み立てる
// ヘルパー。collector 側は `${docker compose のプロジェクト名}/${サービス名}`
// の形式で id を付与する（プロトコル層 `src/a-b-layer.test.ts` の `id()` と
// 同じ考え方。docs/worklog/issue-199.md 設計メモ参照）。

/** `profiles/ethereum/docker-compose.yml` の `name:` と一致する固定値。 */
export const CHAIN_PROJECT = "chainviz-ethereum";

/** compose のサービス名からエンティティ id（`<project>/<service>`）を作る。 */
export function serviceEntityId(service: string): string {
  return `${CHAIN_PROJECT}/${service}`;
}
