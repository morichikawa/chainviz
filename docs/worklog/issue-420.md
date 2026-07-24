# Issue #420 バリデーターの動き自体をもっと可視化したい

### 2026-07-24 Issue #420 実現可能なアプローチの調査（案だし）

- 担当: designer
- ブランチ: issue-420-validator-activity-visualization
- 内容: 実装コードは書かず、実現可能なアプローチの調査・比較のみを行った。
  結論は GitHub Issue #420 本文にも転記済み。実装着手・案の決定はユーザー・
  統括の判断を待つ

#### 前提の再確認

- `docs/ARCHITECTURE.md` §7.6.11（Issue #285）で、validator → beacon の
  内部リンクエッジは常設描画するが活動パルスは意図的に流していない。
  理由は「collector が VC 起点の `nodeLinkActivity` を観測・配信する経路を
  持たない」ため
- `docs/PLAN.md` バックログの Issue #402 の記録にも「PoS の
  attestation（投票・証明）は可視化対象外、既存設計判断（§7.6.11）を
  尊重」という記述があり、今回はその判断を見直す文脈の要望

#### 実測調査

稼働中の `profiles/ethereum` 環境（`chainviz-ethereum-*` コンテナ、
`docker compose up` 済みのもの）に対して、ホストから直接 `curl` して
Beacon API の応答を確認した。

- `GET http://127.0.0.1:5052/eth/v1/beacon/headers/head`
  → ブロックヘッダに `proposer_index` が含まれることを確認（例:
  slot 28 の proposer_index は 34）。**「誰が提案したか」は、既存の
  Beacon API 観測（すでに `beacon-api.ts` が peers/syncing で叩いている
  のと同じ HTTP API）の追加パスだけで取得できる**
- `GET http://127.0.0.1:5052/eth/v1/validator/duties/proposer/{epoch}`
  → 指定エポックの各スロットの提案担当 validator_index 一覧（「予定」）
  を返すことを確認
- `POST http://127.0.0.1:5052/eth/v1/validator/duties/attester/{epoch}`
  （body に validator_index の配列）
  → 指定 validator 群の attestation 担当スロット・committee 情報
  （「予定」）を返すことを確認
- `POST http://127.0.0.1:5052/eth/v1/validator/liveness/{epoch}`
  （body に validator_index の配列）
  → 指定 validator 群がそのエポック中に attestation を行ったかの
  bool（`is_live`）を返すことを確認。**「実施確認」が取れる**が、
  粒度はエポック単位（現行 slot time 12 秒 × 32 slot = 384 秒）であり、
  スロット単位の即時確認ではない（スロット単位で確認するには
  ブロックに含まれる attestation の `aggregation_bits` を復号して
  committee 内のどの validator が投票したかを突き合わせる必要があり、
  実装コストが高い）
- `docker exec chainviz-ethereum-validator1-1 lighthouse vc --help` で
  フラグを確認: `--metrics` / `--metrics-address`（既定
  `127.0.0.1`）/ `--metrics-port`（既定 `5064`）が存在する。**VC にも
  reth と同種の Prometheus メトリクスサーバが用意されている**が、
  現在の `profiles/ethereum/scripts/lighthouse-vc.sh` はこのフラグを
  付けていないため無効。実際に有効化した場合に公開される具体的な
  メトリクス名までは今回未確認（有効化すると同じキー（署名鍵）を
  持つ 2 プロセスが並走するリスクがあるため、実験のために稼働中の
  validator を複製起動することは避けた。正確なメトリクス名は
  reth のとき（Issue #185）と同じ方法論で、実装時に実際に
  `--metrics` を有効化した `/metrics` 出力を確認して確定させる
  運用にするのが安全）
- 同じ `--help` で `--http` / `--http-address` / `--http-port`
  （既定 `5062`）/ `--http-token-path` も確認した。VC 自身が
  Keymanager 系の REST API を持つが、認証トークン（ファイル）が
  必要で複雑度が高いため、今回の比較では不採用候補として扱う
- EL（reth）側のブロックヘッダの `feeRecipient` で proposer を
  区別できないか確認したが、現在の `docker-compose.yml` では
  `validator1` / `validator2` の `FEE_RECIPIENT` が同一アドレス
  （`0x8943545177806ED17B9F23F0a21ee5948eCaa776`）に設定されており、
  この値では区別できないことを確認した（区別するには node-env 側で
  ノードごとに異なる fee recipient を割り当てる変更が必要になる）
- `profiles/ethereum/scripts/generate-genesis.sh` を確認し、
  validator_index と VC コンテナ（validator1/validator2）の対応が
  「`node0` = index `0..31`、`node1` = index `32..63`」という
  `NUMBER_OF_VALIDATORS`（64）/ `NODE_COUNT`（2）から導出される
  決定的な連続範囲の分割であることを確認した。実機の
  `GET /eth/v1/beacon/states/head/validators` が返す index 0 の
  pubkey（`0xb183ffd1...`）が、実際に `validator1` コンテナの
  `/genesis/keys/node0/keys/` ディレクトリに存在することも
  突き合わせて確認済み。ただし **この対応関係を collector がどう
  知るか**（環境変数のハードコード・genesis 共有ボリュームの新規
  読み取り・VC 自身への問い合わせ等）は未解決で、案ごとに影響が
  異なる（下記比較参照）

#### 案の比較

**案A: Beacon API の「予定（duties）」と「事後確認」を相関させる
（node-env 変更なし）**

- collector（`beacon-api.ts`）に
  `/eth/v1/validator/duties/proposer/{epoch}`・
  `/eth/v1/validator/duties/attester/{epoch}`・
  `/eth/v1/validator/liveness/{epoch}` の 3 エンドポイントを追加する
- ブロック提案の確認は、既存のブロック観測とは別に beacon の
  ブロックヘッダ（`/eth/v1/beacon/headers/{slot}` 等）の
  `proposer_index` を見ればよく、ほぼリアルタイム（次のスロットの
  ポーリングで判明）
- attestation の確認は liveness API 頼みでエポック単位の遅延
  （数分単位）が生じる
- **課題**: validator_index → どの VC コンテナかの対応付けが
  未解決。決定的な分割ルール自体は存在する（上記実測）が、それを
  collector がどう入手するかは追加の設計判断が必要（環境変数の
  ハードコードは `NUMBER_OF_VALIDATORS`/`NODE_COUNT` が変わると
  静かに壊れる固定値になり、CLAUDE.md の「今この瞬間に観測できる
  状態に依存した固定値を埋め込まない」に抵触しうる。genesis
  ボリュームの直接読み取りは、collector が Docker Engine
  API・JSON-RPC・Prometheus 以外の経路（ファイル共有）でノード内部を
  覗く新しいパターンになり、既存アーキテクチャの筋から外れる）
- スキーマ影響: 活動パルスは既存の `NodeLinkActivity` /
  `InternalCallStats` をそのまま使える（`method` に
  `"propose"` / `"attest"` 相当の raw 識別子、`count` は 1 件の
  確認につき 1、`observedAt` は確認できた時刻）。**型変更不要**。
  ただし「予定（次の担当スロット）」まで見せたい場合は
  `NodeInternals` への新フィールド追加が要る（後述）

**案B: lighthouse VC の Prometheus メトリクスを新規スクレイプ
（node-env 変更あり）**

- node-env: `lighthouse-vc.sh` に `--metrics --metrics-address 0.0.0.0
  --metrics-port 5064` 相当を追加する（`reth-node.sh` の
  `--metrics 0.0.0.0:9001` と同じパターン）
- collector: `reth-metrics-client.ts` / `reth-metrics-tracker.ts` と
  同型の `vc-metrics-client.ts` 等を新設し、VC の `/metrics` を
  ポーリングする。正確なメトリクス名は Issue #185 のときと同じ
  方法論（設計段階では確定させず、実装時に実環境の `/metrics`
  出力で確定する）で進める
- **利点**: 各 VC コンテナが自分の管理下の validator の活動だけを
  集計して報告するため、案A で課題になった
  「validator_index → VC コンテナ」の対応付け問題がそもそも
  発生しない（reth の Engine API メトリクスと同じ構造で、`/metrics`
  を叩いた相手＝観測対象という単純な対応になる）
- 活動パルス: `NodeLinkActivity` / `InternalCallStats` をそのまま
  再利用できる（`method` は VC 側の raw 識別子、フロント表現セットで
  ラベル付け。§7.6.7 の `engineApiMethodLabels` と同型の
  `validatorApiMethodLabels` のような追加で足りる）。**型変更不要**
- **欠点**: メトリクスは増分カウンタなので、依然として「1 観測 =
  観測間隔内に 1 回以上の呼び出しがあった」という粒度（§7.6.4 と
  同じ誠実さの制約）。内部処理のステップ復元はできない
- スクレイプ間隔は既存の D 層と同じ 3 秒を想定できる（reth と同じ
  Docker ネットワーク内観測で、チェーンの進行状態に依存しない
  サンプリング周期という前提も流用できる）

**案C（推奨）: 案A（予定の可視化。オプション）と案B（実施確認・
活動パルスの主軸）の併用**

- 活動パルスの主軸は案B（VC メトリクス）にする。attribution 問題を
  避けられ、既存の reth Engine API 実装と対称的なパターンで実装
  コスト・リスクが低い
- 案A の duties API は「次の担当はいつ・どちらの職務か」という
  予告表示のためだけに使う（VC メトリクスは実行後にしか増分が
  出ないため、予告的な情報は duties API でしか取れない）。この
  予告表示は任意のオプション機能として切り離せる

**案D（不採用）: VC の構造化ログの tail 解析**

- lighthouse VC は INFO ログに "Publishing attestation" 等の
  ステップ的なログを出す可能性があるが、`docs/ARCHITECTURE.md`
  §7.1 で D 層について「ログのテール・パースは購読管理／再接続／
  フォーマット追従のコストが大きい」として既に不採用と決定済みで
  あり、この判断は VC のログにもそのまま当てはまる。将来的な拡張
  手段として残すに留める

#### 「内部で何をやっているか」の実現限界

案A・案Bいずれでも、「対象決定 → ブロック構築 → 署名 → 送信」の
ような**リアルタイムの内部処理ステップそのもの**は復元できない。
得られるのはあくまで:

1. どちらの種類の職務か（提案 or 証明）という大分類（Engine API の
   メソッド分類ラベルと同じ粒度）
2. その職務が実施されたかどうか（確認できたか、遅延の程度）
3. （案Bで、メトリクスに所要時間の情報があれば）その処理に
   かかった時間の代表値

外部観測（メトリクス／API／ログ）からステップ単位の内部処理を
再構成するには、lighthouse のソースコード計装や詳細な構造化ログ
解析が要り、既存の設計方針（§7.1: ログのテール・パースを採用しない）
と衝突するため現実的ではない。Issue #420 が要望する「内部で何を
やっているか」への期待値を、上記の限界とすり合わせる必要がある

#### スキーマ（packages/shared）への影響

- 活動パルス（`NodeLinkActivity`）は案A・案Bいずれも既存の型で
  対応可能。**型変更不要**
- 「予定（次の担当スロット）」まで見せる場合は `NodeInternals` への
  新フィールド追加が必要になる（例: `nextDuty?: { slot: number;
  dutyType: string }` のようなもの。案C を採る場合のみ必要。
  今回は調査段階のため実装していない）

#### 実装規模の比較

| 観点 | 案A（Beacon API 相関） | 案B（VC メトリクス） |
| --- | --- | --- |
| node-env | 変更なし | `lighthouse-vc.sh` に `--metrics` 追加。ポートの取り扱いは `reth-node.sh` の `9001` と同じ扱いを検討 |
| collector | `beacon-api.ts` 拡張 + validator_index→VC 対応付けの新規解決ロジック（未解決） | reth-metrics 系と同型の `vc-metrics-client.ts` / tracker を新設 |
| frontend | validator→beacon エッジへの活動パルス配線（既存 `useOperationPulses` 等と同型の経路を流用）+ 文言 | 同左 |
| packages/shared | 活動パルスは変更不要。予定表示をするなら `NodeInternals` 拡張 | 活動パルスは変更不要 |
| 精度 | 提案: ほぼリアルタイム／attestation: エポック単位（数分遅延） | 提案・attestation とも スクレイプ間隔（3 秒想定）でほぼリアルタイム |
| リスク | validator_index→VC 対応付けの決定的な解決方法が未確定 | 正確なメトリクス名が未確認（実装時に確定させる運用で対応可能。reth の前例あり） |

#### 未決事項（ユーザー・統括の判断が必要）

1. どの案（A/B/C）で進めるか。designer としては B（または C）を
   推奨（理由は上記「実装規模の比較」参照）
2. 「内部で何をやっているか」への期待値のすり合わせ:
   実現できるのは「職務の種類（提案／証明）＋実施確認＋（取れれば）
   所要時間」までであり、ステップ単位の内部処理描写はできないことを
   ユーザーに確認してもらう必要がある
3. 「予定（次の担当スロット）」まで `packages/shared` のスキーマに
   含めるか（`NodeInternals` 拡張の要否。案C を採る場合のみ関係）

以上を GitHub Issue #420 本文にも転記した。`docs/ARCHITECTURE.md` の
更新は、案の決定後（Issue #412 と同じ進め方）に行う

### 2026-07-24 Issue #420 詳細設計（案B確定後、designer）

- 担当: designer
- 前提: ユーザーが案B（VCメトリクス新規スクレイプ）を採用と決定。「内部で
  何をやっているか」への期待値（職務の種類＋実施確認＋所要時間の代表値が
  限度）はこの決定の前提として共有済み
- 内容: 実装コードは書かず、実装可能な粒度までの詳細設計と
  `docs/ARCHITECTURE.md` §7.6.12 への反映を行った。設計内容の全文は
  `docs/ARCHITECTURE.md` §7.6.12（および §7.6.11・§7.1 の更新箇所）を
  正とする。ここには設計の過程で確認した事実・判断の根拠のみ記録する

#### 作業ブランチについて

このIssueのブランチ `issue-420-validator-activity-visualization` は既に
別のworktree（`chainviz-designer` の前回セッション）にチェックアウト済み
だったため、今回のセッションは同じコミット（`0d92277`）を起点に
`issue-420-validator-activity-visualization-designer` という別名ローカル
ブランチで作業した。統括が最終的に commit・push する際は、これを元の
`issue-420-validator-activity-visualization` ブランチへ反映すること
（`issue-408-mempool-node-locality-frontend` 等、既存の複数worktree
並行作業と同じ合流パターン）。

#### lighthouse VC のメトリクス名の確認方法

実行中の `profiles/ethereum` 環境（QA等の他作業で使用中の可能性がある
コンテナ）には触れず、`sigp/lighthouse` の GitHub リポジトリ（`stable`
ブランチ）を直接読んでメトリクス名を確認した（`docker exec` で
`lighthouse vc --help` を叩く程度の読み取り専用操作は問題ないが、
`--metrics` を実際に有効化するには稼働中コンテナの再作成が要り、実運用中の
鍵を使った二重起動の二重署名リスクを避けるため今回は行わなかった）:

- `validator_client/validator_metrics/src/lib.rs`: メトリクス定義一覧
  （`vc_signed_beacon_blocks_total` 等）
- `validator_client/lighthouse_validator_store/src/lib.rs`: 上記カウンタが
  実際に `inc_counter_vec` で増やされている箇所。`status` ラベルの値
  （`success`/`slashable`/`same_data`/`unregistered`）を確認し、
  **validator_index・公開鍵のラベルが一切無いこと**を確認した
  （「validator_index → VC コンテナの対応付けは不要」という結論の根拠）
- `validator_client/signing_method/src/lib.rs`: `vc_signing_times_seconds`
  が signer backend（`local_keystore`/`web3signer`）別の集計であり、
  職務種別（提案/証明）別ではないことを確認した
- `validator_client/validator_services/src/attestation_service.rs`:
  `vc_attestation_service_task_times_seconds{task="attestations_http_post"}`
  が証明の提出 HTTP 呼び出しの所要時間であることを確認した（署名処理
  そのものの時間ではない近似値）

**注意**: これは `stable` ブランチのソースであり、`profiles/ethereum` が
使う `sigp/lighthouse:latest` Docker イメージの実際のバージョンと厳密に
一致するかは未確認。reth のとき（Issue #185）は実機の `/metrics` を実際に
curl して確定させたが、今回は二重署名リスクを避けるためソース確認に
留めた。したがって `docs/ARCHITECTURE.md` §7.6.12 に書いたメトリクス名は
「暫定（実装時に実機で再確認すること）」という位置づけにしてある。
実装時は、安全な手順（例: 既存の稼働環境を一度 `docker compose down` して
から `--metrics` を有効化して `up` し直す。並行複製起動はしない）で
`/metrics` の実際の出力を確認してから確定させること

#### validator_index → VC コンテナの対応付け問題について

調査段階（案の比較時点）では「案A」特有の課題として書かれていたが、今回
確定した案Bでは以下の理由で**そもそも対応付けが不要**という結論になった:

1. collector は各 VC コンテナの `/metrics` を個別にスクレイプする
   （reth の `executionMetricsTargets` と同型。対象＝観測結果の対応は
   Docker 観測（コンテナ IP + `com.chainviz.role: "validator"` ラベル）
   だけで一意に決まり、これは Issue #246 で既に解決済みの仕組み）
2. VC のカウンタ自体が validator_index を持たない（プロセス単位の集計。
   上記のソース確認で裏付け済み）ため、「どの validator_index がどの
   VC コンテナに属するか」を知る必要のある場面が発生しない

そのため `generate-genesis.sh` の range 分割ロジックを collector に
教える変更（環境変数経由・compose 設定への追記等）は行わない。ユーザーの
依頼文はこの対応付けを「解決する」ことを求めていたが、実際の設計結果は
「（案Bを採る限り）対応付けという概念自体が不要になる」という形の解決に
なった。この点はレビュー時に見落とされやすいポイントなので明記しておく

#### ファイル構成・関数構成

`docs/ARCHITECTURE.md` §7.6.12 に記載した内容が正。要点のみ再掲:

- node-env: `profiles/ethereum/scripts/lighthouse-vc.sh` に
  `--metrics --metrics-address 0.0.0.0 --metrics-port 5064` を追加。
  `docker-compose.yml` の変更は不要（reth の 9001 番と同じくホスト
  非公開のまま、collector はコンテナ IP へ直接到達する）
- collector: 新設 `vc-metrics-client.ts` / `vc-metrics.ts` /
  `vc-metrics-tracker.ts` / `vc-node-internals.ts`（reth の D層実装 4
  ファイルと対称）。`targets.ts` に `validatorMetricsTargets` を追加。
  `index.ts` の既存 `subscribeNodeInternals` の周期ループに相乗りさせる
  （新しいループは作らない、Issue #274 の前例どおり）。`toNodeId` の
  解決には Issue #285 で実装済みの `beaconStableIdForValidator` を
  そのまま再利用でき、新規実装は不要
- frontend: `internalLinkKinds.ts` の `showsActivity` を反転、
  `validatorApiMethodLabels.ts` を新設、`internalLinkActivity.ts` の
  `formatInternalCallEntry` を reth/VC 両テーブルの2段フォールバックに
  変更、`glossary/ethereum/terms/d-internal.yaml` の `beacon-api` 定義を
  更新
- `packages/shared` の型変更は**無し**（`NodeLinkActivity`/
  `InternalCallStats`/`ChainAdapter`/`NodeInternalsHandlers` いずれも
  既存のまま使える。調査段階の判断どおり）

#### Issue の粒度についての判断

1つのIssue（#420）のまま3パッケージ分担で実装しきれる粒度と判断した。
Issue #412（4つの独立した機能への分割）とは異なり、本Issueは「validator
の活動パルスを流す」という単一の成果に向けた分担であり、Issue #285 や
#187/#274 と同じ「1 Issue・複数パッケージ」の形が適切。依存関係・並行
着手の可否は §7.6.12 の「作業分担・Issue の粒度」に記載した
