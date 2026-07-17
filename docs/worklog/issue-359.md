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
