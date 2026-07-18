# Issue #381 workbenchのETH_RPC_URLがdev collectorプロキシ(4001)に固定でUI E2E単独実行時に到達できない

### 2026-07-18 Issue #381 起票の経緯

- 担当: 統括
- ブランチ: issue-381-workbench-rpc-url-backlog
- 内容: Issue #346の最終QA検証(docs/worklog/issue-346.md「2026-07-18 Issue #346
  最終QA検証」節)でchainviz-qaが偶発的に観測した非ブロッキングの環境問題を
  Issue化し、`docs/PLAN.md`のバックログ節末尾に追記した。
- 事実関係: `contract-lifecycle.spec.ts`のUI-C-06のセットアップ
  (`docker compose exec workbench forge create`)が、dev collectorを
  別途起動していないクリーン環境では`host.docker.internal:4001`への
  Connection refusedで失敗する。原因はcompose定義のworkbenchの
  `ETH_RPC_URL`がdev collectorのロギングプロキシ(4001)に固定されている
  一方、UI E2Eのcollectorは4125/4126で動作するため。dev collectorを
  4000/4001で起動した状態で再実行するとUI-C-06も通過することをqaが確認済み。
  Issue #346自体のホバー/描画flakinessとは無関係の既存の環境結合であり、
  #346の修正範囲外(`contract-lifecycle.spec.ts`内ではUI-C-04のみ変更)。

### 2026-07-18 Issue #381 起票・バックログ追記のレビュー

- 担当: reviewer
- ブランチ: issue-381-workbench-rpc-url-backlog
- 判定: **合格**(1回の差し戻しを経て解消)
- 1回目: `docs/worklog/issue-381.md`を新規作成したにもかかわらず
  `docs/WORKLOG.md`索引への1行追加が漏れていたため差し戻し
  (CLAUDE.md開発ルール「新規ファイルを作った場合はdocs/WORKLOG.mdにも
  1行追加する」への違反)。それ以外の確認項目(Issue本文とPLAN.md追記の
  一致、参照事実の実在確認(`profiles/ethereum/docker-compose.yml`の
  ETH_RPC_URL固定値・`packages/e2e/src/helpers/playwright-global-setup.ts`
  のE2E collectorポート4125/4126)、コミット粒度、lint/build/test全通過)
  はすべて合格水準だった
- 2回目: 索引行(コミット04c18e5)を追加し再確認を依頼したところ合格。
  差分1行のみの追加でフォーマット・配置・記載内容とも既存確認済み事実と
  齟齬なし
- docs配下のみの変更のため、CLAUDE.mdの例外規定に基づきchainviz-qaは
  省略(reviewer合格のみ)

### 2026-07-18 Issue #381 設計メモ

- 担当: designer
- ブランチ: issue-381-workbench-rpc-url

#### 現状の把握（実測に基づく事実関係）

- 静的ワークベンチ（`profiles/ethereum/docker-compose.yml` の `workbench`
  サービス）の `ETH_RPC_URL` は `http://host.docker.internal:4001`
  （dev collector のロギングプロキシ）に固定されている。
- 動的追加ワークベンチ（`addWorkbench` 経由）は collector が
  `resolveWorkbenchRpcUrl()`（`packages/collector/src/index.ts`）で
  `http://host.docker.internal:<CHAINVIZ_PROXY_PORT>` を組み立てて渡すため、
  E2E collector（プロキシ 4126）配下でも正しい向き先になる。**問題は
  静的ワークベンチだけ**。
- 静的ワークベンチの `ETH_RPC_URL` に依存する E2E コードは
  `packages/e2e/src/helpers/docker.ts` の
  `deployUncatalogedContractInWorkbench()`（UI-C-06 のセットアップで
  `docker compose exec workbench forge create` を実行）の 1 箇所のみ。
- UI 層 E2E の collector は WS 4125 / プロキシ 4126
  （`playwright-global-setup.ts` の `UI_E2E_COLLECTOR_PORT` と、
  `startCollector` の既定 `proxyPort = port + 1`）。dev collector を
  起動していないクリーン環境では 4001 に待受が無く Connection refused。

#### 方針の比較と決定

2 方針を比較し、**方針B（E2E 側で exec 時に上書き）を採用**する。

- 方針A: compose 定義の `ETH_RPC_URL` を
  `http://host.docker.internal:${CHAINVIZ_PROXY_PORT:-4001}` のように
  変数化する — **不採用**。理由:
  1. compose の環境変数はコンテナ**作成時**に固定される。E2E は稼働中
     スタックの再利用（`ensureChainRunning`）が基本方針のため、dev 環境で
     4001 のまま作成済みの workbench コンテナには効かない。効かせるには
     コンテナ再作成が必要で、稼働中の dev 環境を巻き込んで壊す
     （`up -d` が構成差分を検知して workbench を作り直す副作用もある）。
  2. E2E のプロキシポートは collector 起動時に決まるが、compose up は
     それと独立したタイミング（多くは別セッションの dev-up.sh）で走る。
     コンテナ作成と collector 起動の間に順序結合が生まれ、壊れやすい。
  3. ノード環境テンプレート（被可視化対象）が E2E という利用側の事情を
     知る形になり、「ノード環境 → Collector → GUI」の依存の方向に反する。
- 方針B: `docker compose exec -e ETH_RPC_URL=http://host.docker.internal:4126`
  で **exec するプロセスにだけ** 向き先を上書きする — **採用**。理由:
  1. `docker compose exec -e` はコンテナ本体の環境を変えず、そのコマンド
     実行にだけ効く。compose 定義・dev 運用（README 手順・dev collector
     4001 前提）への影響がゼロ。
  2. 向き先は E2E collector 自身のプロキシなので「ワークベンチの RPC は
     ロギングプロキシ経由」という CONCEPT.md の決定は維持される
     （reth 直結にはしない）。UI-C-06 の forge create も E2E collector に
     観測される。
  3. 影響箇所（UI-C-06 のセットアップ 1 箇所）だけを直す最小の変更で、
     先回り実装をしない原則に沿う。

#### 決定した仕様上の判断

- ホスト名 `host.docker.internal` は E2E ヘルパー（docker.ts）内に閉じる。
  compose 側の `extra_hosts: host.docker.internal:host-gateway` と対の
  語彙であり、呼び出し側（spec）はポート番号だけを渡す。
- 「プロキシ = WS + 1」の知識が spec 側へ漏れないよう、
  `playwright-global-setup.ts` に `UI_E2E_PROXY_PORT`（= 4126）を定数として
  新設し、+1 の関係の根拠はこの定数定義 1 箇所に集約する。あわせて
  globalSetup の `startCollector` 呼び出しも暗黙の既定 +1 に頼らず
  `startCollector(UI_E2E_COLLECTOR_PORT, UI_E2E_PROXY_PORT)` と明示する
  （定数と実際の待受が乖離しない）。
- `packages/shared` の型変更は**不要**（ワールドステート・プロトコルに
  変化なし。E2E ヘルパーと docs のみの変更）。
- `profiles/` 配下は変更しない（docker-compose.yml のコメント追記も
  不要。設計判断は docs/ARCHITECTURE.md §8.3 に記載済み）。

#### 実装担当への引き継ぎ（変更ファイルと内容）

1. `packages/e2e/src/helpers/playwright-global-setup.ts`
   - `export const UI_E2E_PROXY_PORT = UI_E2E_COLLECTOR_PORT + 1;` を追加
     （docstring に ARCHITECTURE.md §8.3 のポート規約と Issue #381 を参照）。
   - `startCollector(UI_E2E_COLLECTOR_PORT)` を
     `startCollector(UI_E2E_COLLECTOR_PORT, UI_E2E_PROXY_PORT)` に変更。
2. `packages/e2e/src/helpers/docker.ts`
   - `deployUncatalogedContractInWorkbench(proxyPort: number)` に必須引数を
     追加し、compose 引数を
     `exec -T -e ETH_RPC_URL=http://host.docker.internal:<proxyPort>
     workbench sh -c 'forge create ...'` に変更。
   - docstring を更新（コンテナの ETH_RPC_URL は dev collector 4001 固定の
     ため UI E2E 単独実行では到達できず、呼び出し側 collector のプロキシへ
     exec 時に上書きする。Issue #381）。
3. `packages/e2e/src/ui/contract-lifecycle.spec.ts`
   - `deployUncatalogedContractInWorkbench(UI_E2E_PROXY_PORT)` に変更
     （`UI_E2E_PROXY_PORT` を playwright-global-setup.js から import）。
4. テスト
   - `playwright-global-setup.unit.test.ts`: `UI_E2E_PROXY_PORT === 4126` と
     `startCollector` へ両ポートが明示的に渡ることの検証を追加・更新。
   - docker.ts 側は現状「docker compose exec への薄い委譲（分岐なし）は
     ユニットテスト対象外」という整理。引数埋め込みが 1 箇所増えるだけ
     なのでこの整理を維持してよいが、exec 引数配列の組み立てを純関数に
     切り出してユニットテスト化するかは実装担当の判断に委ねる（切り出す
     場合は 1 ファイル 1 責務に注意）。

#### 実装時に判断してよい点（未確定のまま残す）

- `connection-errors.spec.ts` の `restartCollector()` は
  `startCollector(UI_E2E_COLLECTOR_PORT)` と既定 +1 に頼っている（結果は
  同じ 4126 になるため現状でも壊れていない）。一貫性のため
  `UI_E2E_PROXY_PORT` を明示的に渡すよう揃えるかは実装担当の判断でよい。

#### 検証観点（QA への申し送り）

- 再現確認: dev collector（4000/4001）を起動していない状態で
  `pnpm test:e2e:ui` の UI-C-06 が修正前は Connection refused で失敗し、
  修正後は通過すること。
- 回帰確認: dev collector を 4000/4001 で起動した環境でも UI-C-06 が
  引き続き通過すること（exec -e の上書きは 4126 を指すため、dev collector
  の有無に依存しなくなるのが期待動作）。
