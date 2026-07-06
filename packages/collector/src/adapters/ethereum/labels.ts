// Ethereum プロファイルで使う Docker ラベルのキー定数を一元管理する。
//
// これまで node-lifecycle.ts（ラベルの付与・回収）と classify.ts（分類での
// 参照）にそれぞれ同じ文字列リテラルが重複定義されていた。値がずれると
// 「付与したラベルを分類側が拾えない」といった検知しづらい不整合につながる
// ため、このファイルを唯一の定義元にする。
//
// これらは compose 互換ラベル・collector 独自ラベルであり Ethereum 固有の
// 概念ではないが、現状 collector 内で Ethereum アダプタ以外がラベル運用を
// 行っていないため adapters/ethereum 配下に置く。将来別チェーンプロファイルが
// 同様の仕組みを必要になった場合は共通層への引き上げを検討する。

/** docker compose が自動で付与する、コンテナが属する project 名のラベル。 */
export const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";

/** docker compose が自動で付与する、コンテナの service 名のラベル。 */
export const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";

/**
 * collector が addNode/addWorkbench で作成したコンテナである印。
 * 値 "true" のときのみ collector 管理下とみなす（Issue #65）。
 */
export const MANAGED_LABEL = "com.chainviz.managed";

/** com.chainviz.managed=true のコンテナが持つ役割（execution/consensus/workbench）。 */
export const ROLE_LABEL = "com.chainviz.role";
