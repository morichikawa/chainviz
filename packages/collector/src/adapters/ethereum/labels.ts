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

/**
 * Docker Compose が「このコンテナはプロジェクトのメンバーである」と認識
 * するために必須のラベル（Issue #359）。
 *
 * 実機検証で判明した事実: `com.docker.compose.project` /
 * `com.docker.compose.service` が正しく付いていても、このラベルが無い
 * コンテナは `docker compose ps -a` にすら現れず、`docker compose down
 * --remove-orphans` の孤児（orphan）検出の対象にもならない
 * （`oneoff` / `container-number` / `project.config_files` /
 * `project.working_dir` / `version` / `depends_on` を追加しても改善
 * しないことを個別に確認済み。Compose v2.40.3 / Engine 29.1.3で実機
 * 確認。詳細は docs/worklog/issue-359.md）。これが無いために addNode/
 * addWorkbench が作るコンテナが `docker compose down -v
 * --remove-orphans` でも削除されず、ネットワーク削除も「still in use」
 * で失敗していた。
 *
 * 値そのものは動的追加コンテナの動作に影響しない。Compose は本来この
 * ラベル値をサービス定義から計算したハッシュと比較して「設定が変わった
 * ので再作成が必要か」を判定するが、動的追加コンテナは docker-compose.yml
 * に対応するサービス定義を持たない（常に「孤児」）ため、この比較が
 * 行われることはない。ラベルキーが存在することだけが Docker Compose に
 * コンテナを認識させるために必要。
 */
export const CONFIG_HASH_LABEL = "com.docker.compose.config-hash";

/**
 * 全ノードコンテナが持つ役割宣言。静的コンテナ（compose テンプレート）・
 * 動的コンテナ（addNode/addWorkbench 時に node-lifecycle.ts が付与）の
 * 両方に付く。値は execution / consensus / validator / workbench。
 *
 * 用途は2つある:
 * - `removable` 等と同じ「managed=true のコンテナの役割」（従来からの用途）
 * - `NodeEntity.nodeRole` の出所（Issue #215）。execution/consensus/
 *   validator の値をそのまま toEntity() が転記する。値の検証・解釈は
 *   フロントのチェーンプロファイル表現セットの責務で、collector 側は
 *   加工しない
 */
export const ROLE_LABEL = "com.chainviz.role";

/**
 * ノードが P2P 上でブートノード役かどうかを表すラベル（Issue #124）。
 * 値 "bootnode" のときのみブートノードとみなす。ラベルが無い場合・
 * 想定外の値の場合はすべて通常ピア（"peer"）として扱う（toEntity 参照）。
 * `com.chainviz.role`（クライアント種別の軸）とは別軸のため値を混ぜない。
 */
export const P2P_ROLE_LABEL = "com.chainviz.p2p-role";
