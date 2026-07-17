### 2026-07-17 Issue #359 addNode/addWorkbenchで作成したmanagedコンテナがdocker compose down -vでも削除されない（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-359-backlog
- 内容: Issue #357（down -v後もEOAが残る）の原因調査中に
  chainviz-detectiveが副次的に発見した問題のIssue起票と、
  `docs/PLAN.md` バックログへの追記（docsのみの変更）のレビュー。
  - Issue #359本文と`docs/PLAN.md`追記の照合: 発見の経緯（Issue #357の
    調査中にchainviz-detectiveが副次的に発見）・実証方法（隔離した最小
    composeプロジェクト、Compose v2.40.3 / Engine 29.1.3）・
    `--remove-orphans`付きでも削除されないこと・対応候補（README注記+
    ラベルベースの掃除スクリプト）・対象パッケージ（profiles/ =
    chainviz-node-env + docs）のいずれも一致。Issue本文にある詳細
    （`oneoff=False`ラベルでも削除されない、ネットワーク削除が
    "Resource is still in use"で失敗する）はPLAN.md側では要約により
    省略されているが、バックログ項目は要約で足りるため過不足なしと判断
  - Issue本文が参照する事実の実在確認: 調査記録
    `docs/worklog/issue-357.md` は未マージのブランチ
    `issue-357-eoa-not-cleared-on-down` 上に実在し、managedコンテナが
    `down -v` を生き延びる実測（`--remove-orphans`・`oneoff=False`とも
    効果なし、ネットワーク削除失敗）と、「第2の問題は別Issue化を推奨」
    という記述（ラベルフィルタでの`docker rm -f`掃除コマンド案を含む）が
    実在する。追記の記述はこの調査記録と整合
  - `docs/PLAN.md` の追記フォーマットは直前の #352 項目・#351 項目と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - コミット粒度: `git log main..HEAD` は1コミット（PLAN.md追記のみ）で
    1変更1コミットの規約に適合。Conventional Commits形式も適合
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
    （frontend 174ファイル2460テスト含む）
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - `docs/worklog/issue-357.md` はレビュー時点でmain未マージ
    （ブランチ `issue-357-eoa-not-cleared-on-down` 上）。Issue #359の
    本文が同ファイルを「参考」として参照しているため、#357 のPRが先に
    マージされれば参照は成立する。万一 #359 に先へ着手する場合は
    当該ブランチ上の記録を参照すること
  - 実装着手は後日。具体的な実現方法（README注記+掃除スクリプト等）は
    着手時に設計判断が必要

### 2026-07-17 実機調査（node-env）: 根本原因の特定

- 担当: node-env
- ブランチ: issue-359-managed-container-cleanup

#### 事前確認: 共有Dockerスタックの使用状況

作業開始時、ホスト上で `chainviz-ethereum` プロジェクトが稼働中
（コンテナ7個 + 動的追加と見られる `chainviz-ethereum-reth3` /
`chainviz-ethereum-beacon3` / `chainviz-ethereum-workbench-*` /
`chainviz-ethereum-test-2`）で、ポート4000/4001を握るcollectorプロセス
（PID 1302547、`/home/zoe/workspace/chainviz` = メインworktree、
現在ブランチ `issue-341-i18n-empty-string-fallback`）も生存していた。
別Issueの並行作業に使われている可能性があり、Issue #126のworklog
（過去に共有スタックを誤って`down`してしまった事故）の教訓も踏まえ、
このスタックには一切触れず、scratchpad配下に独立したproject名・独立
subnet（172.99.0.0/16）の合成composeを作って調査した。

#### 実機調査で特定した根本原因

Issue本文にある「`--remove-orphans`を付けても削除されない」という現象を
実際に再現した上で、ラベルを1つずつ足して`docker compose ps -a`/
`docker compose down -v --remove-orphans`の挙動を確認した結果、
**`com.docker.compose.config-hash`ラベルが無いコンテナは、
`com.docker.compose.project`/`com.docker.compose.service`が正しくても
Docker Compose自身から一切認識されない（`docker compose ps -a`にすら
出てこない）**ことが分かった。このラベルさえ足せば（値は何でもよい。
実際に空文字でない適当な値で動作確認済み）、`docker compose ps -a`に
現れるようになり、`docker compose down -v --remove-orphans`で正しく
「孤児（orphan）」として検出・削除され、ネットワークも
"Resource is still in use"にならず正常に削除された。

`oneoff=False`・`container-number`・`project.config_files`・
`project.working_dir`・`version`・`depends_on`を追加しても
`config-hash`が無ければ認識されないことも個別に確認し、`config-hash`が
真の欠落原因であると特定した（実機再現ログは本Issueのブランチでの作業
記録として以下「実装」節にも要約する）。

もう1つ確認した重要な事実: **`--remove-orphans`は`docker compose down`
のCLIオプション（または`COMPOSE_REMOVE_ORPHANS`環境変数）としてでしか
効かず、compose起動時に読む`.env`ファイルに`COMPOSE_REMOVE_ORPHANS=true`
と書いても効果が無い**（実機で確認）。つまり「孤児を消すには明示的な
フラグ/環境変数が要る」というDocker Compose自体の安全装置は今回のラベル
修正では回避できない（意図された仕様であり、今回のバグの一部ではない）。

#### 決めた修正方針

1. **根本原因の修正（node-lifecycle.ts）**: addNode/addWorkbenchが作る
   コンテナに`com.docker.compose.config-hash`ラベルを追加する。値は
   固定のプレースホルダーでよい（動的追加コンテナはdocker-compose.ymlの
   宣言済みサービスに対応するエントリを持たないため、Composeが値を
   実際のサービス設定と比較することはない。「キーが存在すること」だけが
   意味を持つ）。これにより`docker compose down -v --remove-orphans`が
   コード変更なしに動的追加コンテナも含めて完全に片付けられるようになる。
2. **README/docker-compose.ymlの注記更新**: 上記のとおり`--remove-orphans`
   自体はComposeの仕様上省略できないため、`profiles/ethereum/README.md`と
   `docker-compose.yml`冒頭コメントの「片付け」手順を
   `docker compose down -v --remove-orphans`に更新し、理由（動的追加
   コンテナも含めて完全に片付けるため）を注記する。
3. **`scripts/dev-down.sh`は変更しない**: Issue #126で既に
   `cleanup_dynamic_containers`（ラベルフィルタでの`docker rm -f`）が
   `docker compose down`より前に動的追加コンテナを個別削除しており、
   今回の修正が無くても`pnpm dev:down --docker -v`経路は既に問題ない。
   今回の修正はこのスクリプトを使わず素の`docker compose down -v`を
   直接使うユーザー（README記載の標準手順）向けの根本修正にあたる。

#### 実装への影響範囲

修正は`packages/collector/src/adapters/ethereum/{labels.ts,
node-lifecycle.ts}`というTypeScriptコードに及ぶ（通常はcollector担当の
持ち分だが、原因がaddNode/addWorkbenchのコンテナ生成ロジックそのものに
あり、`profiles/`側だけでは修正しえないため、本Issueの担当としてここまで
含めて対応する）。TypeScriptロジック変更を伴うため、
`packages/collector/src/adapters/ethereum/node-lifecycle.test.ts`に
ラベル存在を検証する回帰テストを追加する。

### 2026-07-17 実装・実機確認（node-env）

- 担当: node-env
- ブランチ: issue-359-managed-container-cleanup

#### 実装したファイル

- `packages/collector/src/adapters/ethereum/labels.ts`: 定数
  `CONFIG_HASH_LABEL = "com.docker.compose.config-hash"` を追加。値の
  意味・実機検証の結果をコメントに記載。
- `packages/collector/src/adapters/ethereum/node-lifecycle.ts`:
  `nodeLabels()`（reth/beacon）・`workbenchLabels()`（workbench）の両方に
  `CONFIG_HASH_LABEL: DYNAMIC_CONFIG_HASH`（プレースホルダー定数
  `"chainviz-dynamic"`）を追加。モジュール冒頭のコメントにも経緯を追記。
- `packages/collector/src/adapters/ethereum/node-lifecycle.test.ts`:
  addNode・addWorkbench それぞれに、生成したコンテナへ
  `CONFIG_HASH_LABEL` が付くことを確認する回帰テストを追加。
- `profiles/ethereum/README.md`・`profiles/ethereum/docker-compose.yml`・
  `profiles/ethereum/scripts/generate-genesis.sh`: 「片付け」手順を
  `docker compose down -v --remove-orphans` に統一し、理由を注記。

#### 実機確認（修正前後の差分を実際のコード・実Dockerで確認）

共有スタック`chainviz-ethereum`は使用中と判断し一切触れず、scratchpad配下に
独立project名（`chainviz-issue359val`）・独立subnet（172.30.0.0/16）の
合成composeを作り、ビルド済みの`EthereumNodeLifecycle`を実際に
`import`して`addWorkbench()`を呼ぶ一時スクリプト（コミットしない）で検証した。

1. **修正前の再現**: `git stash`で修正前のコードに戻し再ビルドした状態で
   `addWorkbench()`を実行 → 生成されたコンテナに`config-hash`ラベルが
   無いことを確認。続けて`docker compose down -v --remove-orphans`を実行
   → コンテナは削除されず残存し、ネットワーク削除も
   "Resource is still in use"で失敗（Issue本文どおりの不具合を実際の
   collectorコードで再現できた）。
2. **修正後の確認**: `git stash pop`で修正を戻して再ビルドし、同じ手順を
   再実行 → 生成されたコンテナに`com.docker.compose.config-hash:
   "chainviz-dynamic"`ラベルが付くことを確認。続けて
   `docker compose down -v --remove-orphans`を実行 → コンテナ・
   ネットワーク・ボリュームがすべて削除され、完全にクリーンな状態に
   なることを確認。
3. addNodeが作るreth/beaconコンテナについては、固定IP帯
   （172.28.1.x/172.28.2.x）がハードコードされており、稼働中の実
   `chainviz-ethereum_chain`（同じ172.28.0.0/16サブネット）と重複するため
   隔離環境での実行はできなかった。ユニットテスト（上記
   node-lifecycle.test.ts）で`nodeLabels()`が生成するラベルに
   `CONFIG_HASH_LABEL`が含まれることを固定し、Docker Compose側の
   認識メカニズム自体（config-hashラベルの有無で挙動が変わること）は
   addWorkbenchの実機確認と、コードから切り離した最小合成compose
   （project/service/managed/config-hashラベルのみを付けた`docker run`）の
   両方で確認済みのため、reth/beacon側も同じコード経路
   （`nodeLabels()`）を通ることから同様に解消されると判断した。
- 検証で使ったcompose・コンテナ・ネットワーク・ボリューム・一時スクリプトは
  すべて削除済み。共有スタック`chainviz-ethereum`は検証開始時・終了時とも
  無傷であることを確認した（検証中に他Issueのe2eテストと見られる
  コンテナ（`chainviz-ethereum-e2e-ribbon-recipient-*`）が新規に現れており、
  同スタックが並行作業で使用中だったことも裏付けられた）。

#### 確認結果

- `pnpm lint` / `pnpm build` / `pnpm test`: 全パッケージ通過
  （shared 74 / e2e 171 / collector 1565 / frontend 2592）。
- `bash -n profiles/ethereum/scripts/generate-genesis.sh`: 構文確認OK。

#### 次の担当（reviewer/QA）への申し送り

- `scripts/dev-down.sh`は変更していない（Issue #126の
  `cleanup_dynamic_containers`が既に別経路でこの問題を回避しているため）。
- addNodeが作るreth/beaconコンテナの実機E2E確認（隔離環境での
  `docker compose down -v --remove-orphans`）は、固定IP帯の制約により
  addWorkbenchほど直接的には行えていない。QAで機会があれば、共有スタックが
  空いているタイミングで実際に`addNode`→`down -v --remove-orphans`の
  実機確認を追加で行うことが望ましい（ユニットテスト・addWorkbenchでの
  実機確認・Docker Compose側の一般的な挙動確認の組み合わせで妥当性は
  確認済みだが、最終的な実機フルパスの確認ではない）。

### 2026-07-17 テスト強化

- 担当: tester
- ブランチ: issue-359-managed-container-cleanup

#### 追加したテスト

実装担当が追加した基本テスト（node-lifecycle.test.ts の reth/beacon/
workbench それぞれで `CONFIG_HASH_LABEL` が `toBeTruthy` であること）は、
ラベルが「付いていること」しか確認しておらず、実機検証で判明した不変条件
（値が空文字だと Compose に認識されない・種別で値が食い違わない・孤児
検出には project/service/managed と揃って必要）までは押さえていなかった。
関心事ごとに以下2ファイルを新規追加した（node-lifecycle.test.ts は既に
66KB と肥大しているため追記せず分割。CLAUDE.md「1ファイル1責務」）。

- `packages/collector/src/adapters/ethereum/labels.test.ts`（新規、5テスト）:
  labels.ts の定数群（唯一の定義元という責務）に対する回帰テスト。
  - compose 互換キー（project/service/config-hash）と chainviz 独自キー
    （managed/role/p2p-role）の正確な文字列を固定
  - compose 系は `com.docker.compose.` 名前空間、chainviz 系は
    `com.chainviz.` 名前空間であることを検証
  - 全ラベルキーが相異なる（定数が同じ文字列を指して上書きし合わない）こと
- `packages/collector/src/adapters/ethereum/managed-container-cleanup-labels.test.ts`
  （新規、4テスト）: Issue #359 の中心的不変条件に特化。
  - reth/beacon/workbench の全 managed コンテナ種別で config-hash が
    「空でない文字列」かつ同一値であること（`toBeTruthy` より厳密に
    `typeof === "string"` + `length > 0` を要求し、空文字への退行を弾く）
  - config-hash 単体ではなく project + service + managed と揃って付くこと
    （孤児検出に一式必要なため）
  - 2 回 addNode したとき reth3/beacon3/reth4/beacon4 の 4 コンテナすべてに
    付くこと（「最初の1個だけ付けて2個目を付け忘れる」境界の退行防止）
  - 空ラベル（`"   "`）の addWorkbench で service 名が "workbench" に
    フォールバックする境界でも config-hash が漏れないこと

#### 依頼された観点への回答

- 観点1（プレースホルダー値の形式）: 「値の中身を Compose が検証するか」は
  Docker 側の挙動でありユニットテストでは直接検証できない。worklog の実機
  検証で「孤児コンテナは docker-compose.yml に対応サービス定義を持たない
  ため値の比較は行われず、キーが存在し空でなければ十分」と確定済み。この
  結論のユニットテスト上の代理として「値が空でない文字列であること」を
  managed-container-cleanup-labels.test.ts で固定した（空文字は認識され
  ないという実機知見への回帰ガード）。
- 観点2（reth/beacon への付与の補強）: 実機E2E確認が手薄だった reth/beacon
  について、`nodeLabels()` 経由で生成される全コンテナ（複数回 addNode 含む）
  に config-hash が付くことをユニットテストで固定した。
- 観点3（既存 labels.ts テストとの整合）: labels.ts には専用テストが存在
  しなかったため新規作成し、他ラベル定数との一貫性（名前空間・キー一意性）
  もあわせて固定した。

#### 実装のバグらしきもの

なし（実装ロジックへの変更は行っていない）。

#### 確認結果

- `pnpm --filter @chainviz/collector build`: 通過。
- `pnpm --filter @chainviz/collector test`: collector 全体で 76 ファイル
  1574 テスト通過（新規 5 + 4 テストを含む）。
- `pnpm lint`（ルート eslint）: 通過。

### 2026-07-17 レビュー

- 担当: reviewer
- ブランチ: issue-359-managed-container-cleanup
- 判定: **合格**（差し戻しなし。ただし下記「申し送り」をQA・統括に引き継ぐ）

#### 確認した内容

- `packages/shared` に変更が無いこと: 差分（ブランチ基点 6d0d717 以降の
  5コミット）に shared 配下のファイルは含まれない。変更は
  collector の ethereum アダプタ（labels.ts / node-lifecycle.ts / テスト）と
  profiles/ethereum のドキュメント・コメントに閉じており、境界・チェーン
  プロファイル独立性の原則にも適合。
- 固定プレースホルダー値 `"chainviz-dynamic"` の前提条件の明記:
  labels.ts の `CONFIG_HASH_LABEL` コメント（値の比較が行われない理由・
  実機検証の条件 Compose v2.40.3 / Engine 29.1.3）と node-lifecycle.ts の
  `DYNAMIC_CONFIG_HASH` コメント、本 worklog「決めた修正方針」の3箇所に
  記載があり、「固定値を使う場合は前提条件をコードと worklog の両方に
  明記する」ルールに適合。
- エラー握りつぶし: 本変更で追加された catch は無し。問題なし。
- `scripts/dev-down.sh` との整合（Issue #126）: dev-down.sh は未変更で、
  `cleanup_dynamic_containers`（managed ラベルでの `docker rm -f`）が
  `docker compose down` より先に走る既存経路は本修正の影響を受けない。
  「変更しない」判断とその理由が worklog に記録されており妥当。
- テストコードの質: labels.test.ts（キー文字列の固定・名前空間・一意性）、
  managed-container-cleanup-labels.test.ts（空でない文字列・種別間の
  値一致・project/service/managed との同時付与・2回 addNode の4コンテナ・
  空ラベルフォールバック境界）はいずれも実機検証で判明した不変条件を
  写しており、実装の詳細をなぞるだけのテストではない。実効性の確認として
  `nodeLabels()` から `CONFIG_HASH_LABEL` 行を一時的に削除して該当2ファイル
  を実行したところ4テストが失敗することを確認した（確認後に復元し、
  作業ツリーがクリーンであることも確認）。
- `pnpm lint` / `pnpm build` / `pnpm test`: 全パッケージ通過
  （shared 74 / e2e 171 / collector 1574 / frontend 2592）。
- コミット粒度: 5コミット（fix / docs(node-env) / worklog / test / worklog）
  がそれぞれ単一の関心事で、Conventional Commits 形式にも適合。

#### 申し送り（QA・統括へ。いずれも本Issueの差し戻し事由とはしない）

1. **Issue #366 との相互作用（統括による #366 への記録を推奨）**:
   動的ワークベンチの service ラベルは `uniqueWorkbenchService()` が
   「管理下の動的ワークベンチ同士」でしか重複回避せず、静的 compose
   サービス名（workbench / reth1 / beacon1 等）とは衝突しうる
   （空ラベル時のフォールバック名 "workbench" は静的サービス名と常に一致。
   ユーザー指定ラベルが "reth1" 等の場合も同様）。本修正前はそのような
   コンテナは Compose から不可視だったため無害だったが、本修正で
   project + service + config-hash が揃い **Compose から可視になる**ため、
   docker-compose.yml に定義済みのサービス名と一致した場合、次回の
   `docker compose up -d`（dev-up.sh・README の再起動手順で日常的に実行）
   の収束処理が config-hash 不一致の既存インスタンスとして動的コンテナを
   再作成・削除する可能性がある。実機検証は「定義に無いサービス名 =
   純粋な孤児」のケースのみで、この衝突ケースは未検証。ワークベンチ命名
   衝突は既知の Issue #366（コンテナ名409・stableId 重複）の問題系であり、
   #366 の設計時に「動的コンテナの service ラベルは静的サービス名と
   衝突させない」ことを要件に含めるべき。QA でも可能なら「空ラベルで
   addWorkbench → `docker compose up -d`」で動的ワークベンチが破壊され
   ないかの確認を推奨する。
2. **e2e ヘルパーの `down -v`**: `packages/e2e/src/helpers/docker.ts` の
   `ensureChainRunning({freshStart})` と `tearDownChain()` は
   `--remove-orphans` 無しの `docker compose down -v` のまま。現状どの
   spec からも呼ばれておらず（grep で確認）修正前からの退行も無いが、
   README の「`--remove-orphans` は必須」という記述とは不整合。使われる
   ようになった時点で忘れられやすいため、フォローアップでの追随を推奨。
3. **addNode（reth/beacon）の実機フルパス未検証**: 実装担当の申し送り
   どおり、reth/beacon はユニットテスト + 同一コード経路（`nodeLabels()`）+
   addWorkbench での実機確認によるカバーであり、実機での
   `addNode` → `down -v --remove-orphans` フルパスは未実施。QA で共有
   スタックが空いているタイミングでの実機確認が望ましい。

#### 備考

- `profiles/ethereum/README.md` の「head_slot が 0 のまま」の段落では
  コードスパン内の `docker compose down -v --remove-orphans` が行を
  またいでいる（Markdown の仕様上、コードスパン内の改行はスペースとして
  描画されるため表示は正しい）。過去に「改行またぎの誤参照」の修正例
  （7a0efae）があったため念のため確認したが、問題なし。grep での検索性が
  下がる点のみ留意。

### 2026-07-17 QA検証

- 担当: qa
- ブランチ: issue-359-managed-container-cleanup
- 判定: 条件付き（本修正の主目的は達成。ただしレビュー担当の申し送り2が
  実際の挙動退行として再現したため、統括の判断を仰ぐ）

#### 検証環境

- Docker Compose v2.40.3 / Engine 29.1.3（実装担当・レビュー担当と同一）。
- 共有スタック `chainviz-ethereum` は作業開始時に稼働中（static 7 +
  動的コンテナ reth3 / beacon3 / workbench-3 / test-2）で、メインworktreeの
  collectorプロセス（PID 1302547、ポート4000/4001）も生存していた。別Issueの
  並行作業で使用中と判断し、共有スタックには down/up 系操作を一切行わず、
  scratchpad配下に独立project名（chainviz-issue359-qa / -qa2）・独立ネットワークの
  合成composeで検証した。検証終了時、共有スタックは無傷（running(7)）・
  collector稼働継続を確認。QA用リソース（コンテナ・ネットワーク）は全て削除済み。

#### 確認できたこと（合格部分）

1. **主目的（down -v --remove-orphans で動的コンテナが片付く）**: 静的
   workbench サービスを定義した合成composeに、動的追加コンテナを模した
   ラベル付きコンテナ（`com.docker.compose.project` +
   `com.docker.compose.service` + `com.docker.compose.config-hash=chainviz-dynamic`
   + `com.chainviz.managed`）を追加すると、`docker compose ps -a` に現れるように
   なり、`docker compose down -v --remove-orphans` でコンテナ・ネットワークとも
   完全に削除された。config-hash ラベルが無いと `docker compose ps -a` にすら
   出ないことも同一環境で再確認。Issue #359 の本来の目的は達成されている。
2. **孤児（静的サービス名と衝突しない）コンテナの安全性**: service 名が
   docker-compose.yml に存在しない動的コンテナ（例 `reth3` / 一意名の
   ワークベンチ `mywb`）は、`docker compose up -d`（--remove-orphans なし）を
   実行しても「Found orphan containers」の警告が出るだけで削除されず生存する。
   動的ノード（reth/beacon は service 名 reth<n>/beacon<n>, n>=3 で静的サービス
   reth1/reth2/beacon1/beacon2 と衝突しない）はこの経路で破壊されない。

#### 再現した問題（レビュー申し送り2＝最重要点の確認結果）

**空ラベルで addWorkbench したときの service 名フォールバック "workbench" は
静的 compose サービス名 "workbench" と衝突し、本修正適用後は
`docker compose up -d` で動的ワークベンチが停止・削除される。**

再現手順（合成composeで実測）:

1. `workbench` サービスを定義したcomposeを `docker compose -p P up -d`。
2. 動的ワークベンチを模したコンテナを追加（service=workbench・
   config-hash=chainviz-dynamic・managed=true、コンテナ名は静的と別名）。
   → `docker compose ps -a` に2件とも service=workbench として現れる。
3. `docker compose -p P up -d` を再実行（dev-up.sh・README の標準再起動手順で
   日常的に走る操作）。
   → 動的ワークベンチが `Stopping` → `Stopped` → `Removing` → `Removed` となり
   削除される（compose ログに「is missing com.docker.compose.container-number
   label」「has invalid com.docker.compose.container-number label」の警告）。

対照実験: 同じ衝突コンテナから config-hash ラベルを外す（＝本修正前の状態）と、
compose から不可視のため `up -d` の対象にならず生存する。つまりこの削除は
本修正が config-hash を付与したことで新たに顕在化した挙動である。

影響範囲:
- 削除されるのは「service 名が静的 compose サービス名と一致する動的
  ワークベンチ」のみ。**ラベル未指定（既定）の addWorkbench は
  フォールバックで必ず service=workbench になるため、既定経路がこの条件に
  該当する**（エッジケースではない）。ユーザー指定ラベルが reth1 等の静的
  サービス名と一致する場合も同様。
- 動的ノード（reth/beacon）・一意名ワークベンチは影響を受けない。
- 結果として、既定の addWorkbench で作ったワークベンチが、スタック再起動
  （`docker compose up -d`）のたびに黙って消える。ワークベンチのウォレット
  状態も失われる。

#### 判断材料（差し戻しの要否）

- 根本原因は `uniqueWorkbenchService()`（node-lifecycle.ts）が動的
  ワークベンチ同士でしか service 名の重複回避をせず、静的 compose サービス名
  との衝突を避けないこと。これはワークベンチ命名衝突の Issue #366 の問題系で、
  レビュー担当も「#366 の設計時に『動的コンテナの service ラベルは静的
  サービス名と衝突させない』を要件に含めるべき」と申し送っている。
- 本修正（#359）自体は主目的について正しく機能する。ただし #359 を単独で
  main に入れると、既定の addWorkbench 経路で「再起動のたびにワークベンチが
  消える」退行が発生する。#366（service 名の静的サービス衝突回避）と
  組み合わさって初めて安全になる。
- したがって選択肢は2つ:
  - (a) #359 は主目的達成として受け入れつつ、#366 を本修正の安全性の
    前提（ハード依存）として先行 or 同時に対処する。
  - (b) #359 の範囲内で衝突を避ける（例: 動的ワークベンチの service 名を
    静的サービス名と決して一致しない命名にする）よう collector に差し戻す。
- いずれを取るかは範囲・優先度の判断を伴うため統括に委ねる。差し戻す場合の
  担当は collector（`uniqueWorkbenchService()` の命名ロジック）。

#### 未実施・制約

- 実際の `EthereumNodeLifecycle.addNode`（reth/beacon）を用いた
  `down -v --remove-orphans` フルパスは、固定IP帯 172.28.x が稼働中の共有
  スタックと衝突するため隔離環境で実行できず未実施。ただし config-hash 付与に
  よる compose 認識・孤児削除のメカニズム自体は合成composeで確認済みで、
  reth/beacon も同一コード経路（`nodeLabels()`）を通るため、ユニットテスト・
  addWorkbench 実機確認とあわせて妥当性は確認できたと判断する。

### 2026-07-17 QA再検証（#366マージ取り込み後）

- 担当: qa
- ブランチ: issue-359-managed-container-cleanup（main取り込み後、コミット c128120）
- 判定: 合格

#### 経緯

前回のQA検証時点のブランチにはワークベンチ命名衝突を修正した Issue #366
（マージ済み）がまだ取り込まれておらず、`uniqueWorkbenchService()` が旧版
（メモリ上のレジストリのみで照合）だったため、空ラベル addWorkbench の
service 名が静的 "workbench" と衝突し `docker compose up -d` で削除される
退行が再現していた。mainを取り込み（c128120）、`uniqueWorkbenchService()` が
`existingWorkbenchServiceNames()`（compose project 配下の実在コンテナの
service 名も走査する新版）を使うようになったため再検証した。

#### 検証方法

前回同様、共有スタック `chainviz-ethereum`（稼働中・collector 生存）には
一切触れず、scratchpad配下に独立project（chainviz-i359r2）・独立ネットワークを
作成。ビルド済みの `EthereumNodeLifecycle` と実 `createDockerOperations` を
import し、静的 workbench サービス（service=workbench、managed ラベル無し）が
実在する compose project に対して**実コード経路の `addWorkbench("")` を2回**
呼び出して検証した（合成ラベルの手動付与ではなく実際の命名ロジックを通す）。
foundryImage は alpine:latest に差し替え（コンテナは sleep するだけで
イメージ内容は命名・ラベル検証に影響しない）。

#### 確認結果

1. **命名衝突の解消**: 空ラベル addWorkbench 2回で生成された動的ワークベンチの
   service 名は `workbench-2` / `workbench-3` となり、静的サービス名
   `workbench` と衝突しなかった（`existingWorkbenchServiceNames()` が静的
   workbench コンテナを検出して番号を進めた）。両者に config-hash=chainviz-dynamic
   が付くことも確認。
2. **up -d での退行解消**: 上記状態で `docker compose up -d`（dev-up.sh・README
   標準再起動手順）を実行 → 「Found orphan containers」の警告のみで、動的
   ワークベンチ（workbench-2 / workbench-3）はいずれも停止・削除されず生存した
   （前回再現した回帰は解消）。
3. **#359 主目的の維持**: 続けて `docker compose down -v --remove-orphans` を
   実行 → 静的 workbench・動的 workbench-2 / workbench-3 とネットワークが
   すべて削除され、残留なし。config-hash ラベルによる孤児削除は引き続き機能する。

検証で使った独立 project・コンテナ・ネットワーク・一時スクリプトはすべて削除済み。
共有スタック `chainviz-ethereum` は検証前後で無傷（running(7)）・collector
（ポート4000/4001）稼働継続を確認。

#### 未実施・制約（前回から継続）

実 `addNode`（reth/beacon）を用いた `down -v --remove-orphans` フルパスは、
固定IP帯 172.28.x が稼働中の共有スタックと衝突するため隔離実行できず未実施。
config-hash による compose 認識・孤児削除メカニズムは合成composeおよび
実 addWorkbench 経路で確認済みで、reth/beacon も同一コード経路（`nodeLabels()`）
を通るため妥当性は確認できたと判断する。
