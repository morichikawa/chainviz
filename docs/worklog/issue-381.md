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

### 2026-07-18 Issue #381 実装設計メモ

- 担当: frontend
- ブランチ: issue-381-workbench-rpc-url
- `docs/ARCHITECTURE.md` §8.3 が設計フェーズで既に更新済み（`UI_E2E_PROXY_PORT`
  定数の追加と exec -e 上書き方針が明記されている）ため、実装はこの記述と
  引き継ぎ内容（本ファイル上の設計メモ）どおりに進める。追加の設計判断は無い。
- 変更順序（依存関係に沿って1コミットずつ）:
  1. `playwright-global-setup.ts` に `UI_E2E_PROXY_PORT` を追加し、
     `startCollector` へ明示的に渡す + 対応するユニットテスト更新
     （`playwright-global-setup.unit.test.ts` の「UI 層専用ポートで起動する」
     ケースを両ポート検証に更新）。
  2. `docker.ts` の `deployUncatalogedContractInWorkbench` に `proxyPort`
     必須引数を追加し、`exec -T -e ETH_RPC_URL=...` で上書きする。
  3. 呼び出し元 `contract-lifecycle.spec.ts` を新シグネチャに合わせて更新
     （`UI_E2E_PROXY_PORT` を import）。
- `docker.ts` 側は設計メモの整理（薄い委譲でユニットテスト対象外）を踏襲し、
  実 Docker 依存のため新規ユニットテストは追加しない。呼び出し引数が
  1 つ増えるだけで分岐は増えないため、既存の整理を維持する判断とする。
- `connection-errors.spec.ts` の `restartCollector()` は
  `startCollector(UI_E2E_COLLECTOR_PORT)`（暗黙の +1）のままでも動作上は
  壊れないが、設計メモの「実装時に判断してよい点」に従い、一貫性のため
  `UI_E2E_PROXY_PORT` を明示的に渡す形に揃える（ARCHITECTURE.md §8.3 の
  「暗黙の +1 既定に頼らない」方針と整合させる）。

### 2026-07-18 Issue #381 実装完了

- 担当: frontend
- ブランチ: issue-381-workbench-rpc-url
- 実装内容（設計メモどおり、コミットを分けて実施）:
  1. `playwright-global-setup.ts` に `UI_E2E_PROXY_PORT`（= 4126）を追加し、
     `startCollector(UI_E2E_COLLECTOR_PORT, UI_E2E_PROXY_PORT)` と明示的に
     渡すよう変更。対応するユニットテストも両ポートの検証に更新。
  2. `docker.ts` の `deployUncatalogedContractInWorkbench` に `proxyPort`
     必須引数を追加し、`docker compose exec -T -e
     ETH_RPC_URL=http://host.docker.internal:<proxyPort>` で exec 実行にのみ
     RPC 向き先を上書きするよう変更（コンテナ本体の環境・compose 定義は
     不変）。呼び出し元 `contract-lifecycle.spec.ts` を新シグネチャに合わせて
     更新（`UI_E2E_PROXY_PORT` を import）。
  3. 一貫性のため `connection-errors.spec.ts` の `restartCollector()` も
     `UI_E2E_PROXY_PORT` を明示的に渡す形に揃えた（追加コミット、値自体は
     従来と同じ 4126 で回帰なし）。
- `pnpm lint && pnpm build && pnpm test` は全パッケージで通過（frontend
  2730件・e2e ユニット・collector・shared すべて green）。
- 実 Docker 環境での確認: この作業環境では headless Chromium が
  `libnspr4.so` 不足で起動できず（サンドボックスの制約。sudo にパスワードが
  必要でシステムパッケージの追加インストールはできなかった）、
  Playwright 経由の UI-C-06 フル実行はできなかった。代わりに Docker
  レイヤーの核心部分（`docker compose exec -T -e ETH_RPC_URL=... workbench`
  で `forge create` を実行する箇所）を実際のワークベンチコンテナに対して
  手動で再現し、以下を実測確認した:
  - 一時的に別ポート（4901/4902）で collector を起動し、`exec -e
    ETH_RPC_URL=http://host.docker.internal:4902` で forge create が
    成功すること（デプロイが完了しトランザクションハッシュが返る）。
  - 何も listen していないポート（4903）を指定すると、修正前と同じ
    `Connection refused (os error 111)` で失敗すること（不具合の再現）。
  - 上書きなしで `exec workbench sh -c 'echo $ETH_RPC_URL'` を実行すると
    コンテナ本体の環境は変わらず `http://host.docker.internal:4001`
    のままであること（`-e` がコンテナ本体ではなく exec 実行にだけ効くこと
    の確認）。
  - この検証は既に稼働中だった共有スタック（`chainviz-ethereum-*`、別
    セッションが `/home/zoe/workspace/chainviz` から起動していたもの）を
    そのまま再利用し、既存プロセス・コンテナには手を加えていない。
  - Playwright 経由のブラウザ実行そのもの（chromium 起動）は本 Issue の
    修正対象と無関係な環境要因のため、QA が実 Docker 環境で
    `pnpm test:e2e:ui -g UI-C-06` を実行して最終確認することを申し送る。
- 発見した注意点: 特になし。設計メモの引き継ぎ内容と実装後の差異は無い。

### 2026-07-18 Issue #381 テスト強化メモ

- 担当: tester
- ブランチ: issue-381-workbench-rpc-url
- 既存テストの確認結果:
  - `playwright-global-setup.unit.test.ts` は `UI_E2E_PROXY_PORT === 4126` と
    `startCollector(4125, 4126)` の明示渡しを既に検証済み（網羅十分）。
  - `deployUncatalogedContractInWorkbench` の呼び出し箇所は
    `contract-lifecycle.spec.ts` の 1 箇所のみで、新シグネチャ（proxyPort 必須）
    に更新済み。`restartCollector`（connection-errors.spec.ts）も
    `UI_E2E_PROXY_PORT` を明示的に渡しており漏れなし。
  - ポート整合（本 Issue の item #3）: `startCollector` が渡す
    `CHAINVIZ_PROXY_PORT=4126` を collector 側 `resolveProxyPort` が honor する
    ことは `collector/src/index.test.ts` で既にカバー済み。整合性は担保されている。
- 強化方針: 本 Issue の修正の核心である「exec 時の `-e ETH_RPC_URL` 上書き」の
  引数組み立てに対する自動回帰テストが皆無だったため、`node:child_process` の
  `execFile` をモックして `deployUncatalogedContractInWorkbench(proxyPort)` が
  組み立てる `docker compose exec` 引数を検証する `docker.unit.test.ts` を新設する。
  実 Docker には触れないため `pnpm test`（vitest.unit.config.ts）で回る。
  特に docker compose exec のセマンティクス上 load-bearing な「`-e` が
  サービス名 `workbench` より前に来ること」を回帰対象として固定する。
- 異常系（item #4）: `proxyPort` は TypeScript 上 `number` 型で、唯一の呼び出し元は
  定数 `UI_E2E_PROXY_PORT` を渡すため、実行時に NaN/負値が渡る経路が無い。
  関数側にも検証は無く（garbage-in-garbage-out）、検証不在をテストで固定するのは
  望ましい契約ではないため、異常値テストは追加しない（下記報告参照）。

### 2026-07-18 Issue #381 静的レビュー

- 担当: reviewer
- ブランチ: issue-381-workbench-rpc-url
- 判定: **条件付き差し戻し**(動作・設計は問題なし。コメントの整合のみ要修正)
- 確認して問題なしと判断した項目:
  - 方針B(E2E側でexec時にETH_RPC_URLを上書き)の妥当性: `docker compose
    exec -e` はコンテナ本体の環境・compose定義に影響せず、稼働中スタック
    再利用(`ensureChainRunning`)と両立する。方針A(compose変数化)の不採用
    理由(コンテナ作成時固定で再利用に効かない、ノード環境テンプレートが
    E2E側の事情を知る形になり依存の方向に反する)は事実関係・設計原則の
    両面で正当。向き先がE2E collector自身のプロキシ(4126)であるため
    「ワークベンチのRPCはロギングプロキシ経由」というCONCEPT.mdの決定も
    維持されている。`profiles/`配下は無変更で、境界の遵守に問題なし
  - `packages/shared` は無変更(設計判断どおり。`git diff main...HEAD` で
    確認)
  - コミット粒度: main..HEAD の8コミットはいずれも1関心事1コミットで、
    Conventional Commits形式(docs/fix/refactor/test)に適合
  - `pnpm lint && pnpm build && pnpm test` 全パッケージ通過を実測確認
    (shared 75 / collector 1660 / frontend 2730 / e2e 185件、新設の
    `docker.unit.test.ts` 6件を含む)
  - 回帰テストの実効性: `docker.ts` の `-e` をサービス名 `workbench` の
    後ろへ意図的に移して `docker.unit.test.ts` を実行し、順序検証ケースが
    実際に失敗することをレビュー側でも再確認した(確認後に復元し、通過に
    戻ることも確認)。壊れたコードでも通る「意味のないテスト」ではない
  - QAへの申し送り: Playwright経由のUI-C-06フル実行が未実施であること、
    QAが `pnpm test:e2e:ui -g UI-C-06` を実Docker環境で実行すべきことが
    実装完了節に明記されており、設計メモの「検証観点(QAへの申し送り)」に
    再現確認・回帰確認の具体的手順もある
- 差し戻しの指摘(いずれもコメント・記録の整合のみ。実装ロジックの変更は
  不要):
  1. **[要修正]** `packages/e2e/src/helpers/docker.ts` の
     `deployUncatalogedContractInWorkbench` docstring 末尾の段落が
     「この関数は…専用のユニットテストは書かない(実Dockerが必須で
     ユニットテスト化できない…)」のまま残っている。tester が
     `docker.unit.test.ts` を新設した(execFileモックでユニットテスト化
     できることが実証された)現状と真っ向から矛盾し、読み手を誤導する。
     docstringを現状に合わせて更新すること(例: 引数組み立ては
     `docker.unit.test.ts` で回帰固定している旨に書き換える)
  2. **[1.と同時に対応]** 「`-e` はサービス名より前に置かないと効かない」
     というload-bearingな前提が、現状テストファイル側のコメント
     (`docker.unit.test.ts` 72-74行)にしかない。実装側 `docker.ts` の
     引数配列(またはdocstring)にも一言残すこと。テストを見ずに実装だけを
     編集する将来の変更に対する最も安価な防御であり、CLAUDE.mdの
     「前提条件をコード上のコメントに明記する」の趣旨にも直接沿う
  3. **[軽微]** 本ファイル「テスト強化メモ」末尾の「(下記報告参照)」が
     宙に浮いている(参照先の報告が下に存在しない)。文言を削るか、参照先の
     内容(異常値テストを追加しない判断の詳細)をここに書き切ること
- 上記1〜3の対応後、差分の再確認のみで合格とできる見込み(再度のフル
  ゲート実行は差分がコメント・docsのみであれば lint/test の通過確認で足りる)
