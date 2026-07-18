# Issue #385 addWorkbench(createAndStart)でcontainer.start()失敗時に作成済みコンテナがorphanとして残留する

### 2026-07-18 Issue #385 起票の経緯

- 担当: 統括
- ブランチ: issue-385-workbench-orphan-container-backlog
- 内容: Issue #369の最終QA検証(docs/worklog/issue-369.md「2026-07-18
  実動検証(qa)」節の「発見した問題(#369の差分に起因しない既存の
  堅牢性ギャップ)」小節)でchainviz-qaが偶発的に観測した既存の堅牢性
  ギャップをIssue化し、`docs/PLAN.md`のバックログ節末尾に追記した。
- 事実関係: `addWorkbench`(`createAndStart`経路一般)は、`container.start()`が
  失敗した場合(存在しないネットワークを指定した場合等)に、直前に作成済みの
  「Created」状態コンテナを削除せずorphanとして残す。エラー自体は握りつぶさず
  正しく伝播する(静かには壊れない)が、作りかけのコンテナが残留する。
  `addNode`は先に`usedNetworkIps`(`network.inspect`)でネットワーク存在を
  確認してから作成に進むため、この経路ではorphanが残らない。`addWorkbench`
  にはこの事前チェックが無い。通常運用(既定のcomposeProjectで、対応する
  Dockerスタックが起動済みの状態)では発生しないが、Issue #369により
  「未用意のprojectを指させる」使い方が可能になったため、この経路で
  orphanが積もる可能性が上がる。

### 2026-07-18 Issue #385 起票・バックログ追記のレビュー

- 担当: reviewer
- ブランチ: issue-385-workbench-orphan-container-backlog
- 判定: **合格**(1回の差し戻しを経て解消)
- 1回目: 本ファイルの参照節名「2026-07-18 Issue #369 最終QA検証」が
  docs/worklog/issue-369.mdに実在しない見出しだったため差し戻し
  (実際の見出しは「2026-07-18 実動検証(qa)」節、該当内容はその中の
  「発見した問題(#369の差分に起因しない既存の堅牢性ギャップ)」小節)。
  それ以外の確認項目はすべて合格水準だった:
  - Issue #385本文と`docs/PLAN.md`追記の一致(タイトル完全一致・内容に
    矛盾なし・collectorラベル付与済み)
  - 参照事実の実在確認: `packages/collector/src/docker/dockerode-operations.ts`
    の`createAndStart`はcreateContainer成功後にstart()を呼び、start失敗時に
    作成済みコンテナを削除しない(エラー自体はcatchされず伝播する)。
    `packages/collector/src/adapters/ethereum/node-lifecycle.ts`のaddNodeは
    最初に`usedNetworkIps`(network.inspect)を呼ぶためネットワーク不在時は
    コンテナ作成前にfail-fastするが、addWorkbenchには事前チェックが無く
    createAndStartに直行する
  - `docs/WORKLOG.md`索引への1行追加(フォーマット・リンクとも一貫)
  - コミット粒度(PLAN.md追記とworklog新規+索引更新の2コミット)・
    Conventional Commits形式
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
- 2回目: 参照節名の修正(コミット6fc9ee6)を目視確認し合格。修正後の参照は
  実在の見出しと一致
- docs配下のみの変更のため、CLAUDE.mdの例外規定に基づきchainviz-qaは
  省略(reviewer合格のみ)

### 2026-07-18 設計メモ（着手前）

- 担当: collector
- ブランチ: issue-385-workbench-orphan-container

#### 現状の把握

`packages/collector/src/docker/dockerode-operations.ts` の
`createAndStart` は `docker.createContainer(...)` → `container.start()` の
2段階で、`start()` が失敗した場合に作成済みコンテナへの後始末を一切
行わず、例外をそのまま伝播する。

呼び出し側を確認したところ、`packages/collector/src/adapters/ethereum/
node-lifecycle.ts` の `addNode` は reth 作成後に beacon の
`createAndStart` が失敗した場合、reth 側を明示的に `stopAndRemove` で
ロールバックしている（既存コード、Issue #63 由来）。しかしこれは
「2つ目のコンテナ作成が失敗したときに1つ目を消す」ロールバックであり、
`createAndStart` 単体（1コンテナ分）の中で `start()` 自体が失敗した
ケース（例: 存在しないネットワークを指定）はカバーしていない。実際、
reth 自身の `createAndStart` が失敗した場合、reth の
「Created」状態のコンテナはそのまま残る。`addWorkbench` は
`createWorkbenchContainer` から `this.ops.createAndStart` を1回呼ぶだけ
で、この種のロールバックが無いため、Issue本文が指摘するとおり
`container.start()` 失敗時に作成済みコンテナが orphan として残る。

#### 対応方針の決定

Issue本文にある2案のうち、**「`createAndStart` の start失敗時に
force removeする」（共通経路での対処）を採用する**。

理由:

1. `createAndStart` は「コンテナを作って起動する」という1つの操作
   契約（`DockerOperations` インターフェース）を提供しており、
   「作ったが起動できなかった」という中間状態を外部に漏らさず後始末
   まで含めて完結させる方が、呼び出し側（ChainAdapter 実装）にとって
   扱いやすい契約になる。実際 `addNode` は reth/beacon の2コンテナに
   ついてそれぞれ `createAndStart` を呼ぶだけで、各コンテナの
   作成失敗ロールバックまで呼び出し側が担うのは責務が重複する
   （2つ目の失敗時のロールバックは呼び出し側にしか書けないが、1つの
   `createAndStart` 呼び出し内で完結する後始末は `createAndStart`
   自身が担うべき）。
2. `addWorkbench` にネットワーク事前チェック（`usedNetworkIps` 相当）を
   追加する案は、`addNode` が採番のために本来必要としている
   `usedNetworkIps` 呼び出しを「ネットワーク存在確認」という別目的にも
   流用する形になり、目的の異なるチェックが1箇所に混在する。また
   ネットワーク不在以外の start 失敗要因（例: 将来的にボリューム不在や
   リソース制限等が原因になるケース）はこの事前チェックでは救えず、
   都度チェック項目を追加する必要が生じる。`createAndStart` 側での
   force remove は start失敗の原因を問わず一律に効くため、将来
   `createAndStart` を呼ぶ経路が増えても同じ保護が及ぶ。
3. `stopAndRemove` の実装（`container.remove({ force: true })` を
   呼び、404/409 を握りつぶす）と同種のパターンを流用でき、実装の
   一貫性が保ちやすい。

以上より、`packages/collector/src/docker/dockerode-operations.ts` の
`createAndStart` 内で `container.start()` が失敗した場合、作成済み
コンテナを `container.remove({ force: true })` で削除してから元の
エラーを再 throw する形に変更する。

#### 実装方針

- `createAndStart` 内で `container.start()` を try/catch し、失敗したら
  `container.remove({ force: true })` を試みる。
  - 削除自体が失敗した場合は握りつぶさず `console.error` に残す
    （CLAUDE.md「エラーを握りつぶすコードを見逃さない」）。ただし
    呼び出し元へは元の `start()` エラー（根本原因）を優先して
    再 throw し、後始末エラーに差し替えない（`addNode` の既存の
    reth ロールバックコメントと同じ考え方）。
  - `remove` が 404（既に無い）を返すケースは通常起きない想定だが
    （直前に作成したコンテナが即座に消えているのは異常）、
    `stopAndRemove` と異なり `createAndStart` はこの呼び出し1回きりの
    後始末なので、404 を特別扱いせず「削除できなかった」ログの1つ
    として扱う（成功扱いにする必要はない。呼び出し元は既に
    `start()` 失敗を検知しているため、コンテナが実際に消えているか
    どうかは後始末ログで追えれば十分）。
- 影響範囲: `dockerode-operations.ts` のみ。`DockerOperations`
  インターフェース（`operations.ts`）のシグネチャ変更は不要
  （`createAndStart` の契約は「成功時は起動済みコンテナを返す、
  失敗時は例外を投げる」のままで変わらず、内部の後始末が追加される
  だけ）。`packages/shared` の型変更もなし。

#### テスト方針

- `dockerode-operations.test.ts` に、`start()` が失敗した場合に
  `remove({ force: true })` が呼ばれることを検証するケースを追加する。
- 削除自体も失敗した場合に、元の `start()` エラーが（削除エラーに
  差し替えられずに）伝播することを検証するケースを追加する。
- 修正前のコードで実際に「start失敗時に remove が呼ばれない」ことを
  再現確認してから実装し、修正後に解消することを確認する
  （CLAUDE.md 運用ルール）。

### 2026-07-18 実装記録

- 担当: collector
- ブランチ: issue-385-workbench-orphan-container

#### 実施内容

設計メモどおり、`packages/collector/src/docker/dockerode-operations.ts`
の `createAndStart` を変更した。`container.start()` を try/catch し、
失敗時は `container.remove({ force: true })` で作成済みコンテナを
削除してから元の `start()` エラーを再 throw する。削除自体が失敗した
場合は `console.error` にログを残し、元のエラーは差し替えずそのまま
伝播する。`DockerOperations` インターフェース（`operations.ts`）の
シグネチャ変更は無し。

`dockerode-operations.test.ts` に以下を追加した。

- `start()` 失敗時に `remove({ force: true })` が呼ばれること
- 削除自体も失敗した場合、削除エラーではなく元の `start()` エラーが
  伝播すること（かつ削除失敗がログに残ること）
- 成功時（`start()` が失敗しない場合）は `remove()` が一切呼ばれない
  ことの回帰確認

#### 修正前後の実測確認

まず簡易な再現スクリプト（`createContainer` が `{ start, remove }` を
モックで返す `Docker` オブジェクトを渡す）で、修正前のビルド済み
`dist/docker/dockerode-operations.js` に対して `createAndStart` を
呼び、`start()` が reject したときに `remove` が呼ばれないこと（＝
Issue本文の不具合の再現）を確認した。

さらに、実装したテスト2件についても CLAUDE.md の運用ルールに従い、
`dockerode-operations.ts` の変更のみを `git stash` で一時的に戻して
（修正前の状態に戻して）テストを実行し、新規追加した2件
（`force-removes the created container when start() fails` /
`still propagates the original start() error when the cleanup remove()
also fails`）が実際に失敗することを確認した（他の既存50件は影響を
受けず成功）。その後 `git stash pop` で修正を復元し、52件すべてが
成功することを確認した。

#### 確認コマンド

- `pnpm lint`: 成功（エラー・警告なし）。
- `pnpm build`（リポジトリ全体）: shared/collector/frontend/e2e すべて成功。
- `pnpm test`（リポジトリ全体）: shared 75件・collector 1663件
  （変更前 1661件から +2）・e2e 179件・frontend 2730件すべて成功。

#### 未対応・次担当への申し送り

- `packages/shared` の型変更は無し。`DockerOperations` インターフェース
  の契約（`createAndStart` は成功時に起動済みコンテナを返し、失敗時は
  例外を投げる）自体は変更していないため、`node-lifecycle.ts`
  （`addNode`/`addWorkbench` 双方）の呼び出し側コードは無変更で
  この保護を受けられる。
- `docs/ARCHITECTURE.md` は `DockerOperations` の契約を変えていない
  （内部の後始末が増えただけ）ため追記不要と判断した。

### 2026-07-18 テスト強化メモ（着手前）

- 担当: tester
- ブランチ: issue-385-workbench-orphan-container

#### 既存テストのカバー状況

`dockerode-operations.test.ts` の `createAndStart` 系は、start 失敗時の
force remove・後始末失敗時の元エラー伝播とログ出力・成功時に remove を
呼ばないことをハッピーパス中心にカバー済み。`node-lifecycle.test.ts` は
`fakeOps`（`createAndStart` を単純化したフェイク）を使うため、実際の
`createDockerOperations` の start 失敗後始末ロジックが addNode/addWorkbench
経由でどう効くかは検証していない。

#### 追加する観点（依頼の4点に対応）

1. 後始末 remove 自体が 404（別プロセスが既に削除済み）で失敗しても、
   404 を成功扱いに変換せず握りつぶさずログへ残し、元の start エラーを
   伝播すること（依頼1）。cleanup 失敗ログにコンテナ id と name が含まれ、
   orphan を追跡できること。
2. start 失敗の原因（プレーン Error、statusCode 付き、リソース不足・
   ポート競合を模した文言、非 Error 値の throw）が異なっても、一律に
   force remove され元エラーがそのまま伝播すること。特に start エラーの
   文言が "already in use"／statusCode 409 を含んでも、名前衝突変換は
   createContainer 失敗にのみ適用され start 失敗には適用されない
   （`ContainerNameConflictError` に化けない）ことを固定（依頼2）。
3. 実際の `createDockerOperations` を `EthereumNodeLifecycle` に配線した
   統合テストで、addWorkbench・addNode（reth 自身の start 失敗）双方の
   経路で作成済みコンテナが orphan として残らず force remove されること
   （依頼3）。
4. addNode で beacon の start が失敗したとき、beacon は createAndStart
   内の force remove で、reth は addNode の既存ロールバック
   （stopAndRemove）で、それぞれ別コンテナとして1回ずつ削除され、
   同一 id の二重削除・競合が起きないこと（依頼4）。

#### ファイル分割方針

単体レベルの追加は既存の `dockerode-operations.test.ts` に足す。統合
（依頼3・4）は関心事が異なり、`node-lifecycle.test.ts` が既に肥大
（1700行超）しているため、新規ファイル
`createandstart-orphan-cleanup.test.ts` に分離する。

### 2026-07-18 テスト強化 実施記録

- 担当: tester
- ブランチ: issue-385-workbench-orphan-container

#### 追加したテスト

`packages/collector/src/docker/dockerode-operations.test.ts`（単体、+6件）:

- 後始末 remove が 404（別プロセスが既に削除）で失敗しても、404 を成功
  扱いに変換せず握りつぶさずログへ残し、元の start() エラーを伝播すること。
- 後始末失敗ログにコンテナ id と spec.name の両方が含まれ、orphan を
  追跡できること。
- start() 失敗の原因（プレーン Error / ポート競合 / リソース不足を模した
  statusCode 500 のエラー）が何であっても一律に force remove し、元エラーを
  そのまま伝播すること。
- start() が 409 + "already in use" で失敗しても ContainerNameConflictError
  に化けない（名前衝突変換は createContainer 失敗経路のみ）こと。あわせて
  作成済みコンテナを force remove すること。
- start() が非 Error 値（文字列）を投げても force remove が走り、その値を
  そのまま伝播すること。
- 後始末 remove はリトライせず1回だけで、start 失敗時は戻り値を返さず
  必ず throw すること。

`packages/collector/src/adapters/ethereum/createandstart-orphan-cleanup.test.ts`
（統合、新規4件）: 本物の `createDockerOperations` を
`EthereumNodeLifecycle` に配線して検証。

- addWorkbench の start() 失敗時に作成済みコンテナが force remove され、
  登録も残らない（orphan が生じない）こと。
- addNode で reth 自身の start() が失敗したとき、createAndStart 側の
  force remove が reth の orphan を消すこと（従来 addNode のロールバックが
  救えなかった経路）。
- addNode で beacon の start() が失敗したとき、beacon は createAndStart の
  後始末で、reth は addNode の既存ロールバック（stopAndRemove）で、それぞれ
  別コンテナとして1回ずつ削除され、同一 id の二重削除・競合が起きないこと
  （依頼の観点4）。
- 対照群: start が両方成功する通常経路では後始末 remove が一切走らないこと。

#### 回帰検出の確認

CLAUDE.md の運用ルールに従い、`dockerode-operations.ts` の force remove
ロジックを一時的に「throw のみ」へ戻した状態で上記を実行し、追加した
11件すべてが失敗する（＝元の不具合を検出できる）ことを確認してから
修正を復元した。復元後は 62件（単体58＋統合4）すべて成功。

#### 確認コマンド

- `npx eslint`（変更した2テストファイル）: エラーなし。
- `pnpm --filter @chainviz/collector build`: 成功。
- `pnpm --filter @chainviz/collector test`: 1673件すべて成功
  （変更前 1663件から +10）。

#### 発見した懸念点

実装のバグに該当するものは見つからなかった。設計どおり、start 失敗の
原因を問わず一律に force remove され、addNode の既存ロールバックとは
別コンテナを対象とするため二重削除・競合は起きない。

### 2026-07-18 静的レビュー

- 担当: reviewer
- ブランチ: issue-385-workbench-orphan-container
- 判定: **合格**（差し戻しなし）

#### 確認項目と結果

1. 方針の妥当性（Issue本文の2案の比較）: 案1（共通経路 `createAndStart`
   内での force remove）の採用は適切と判断した。案2（addWorkbench への
   ネットワーク事前チェック追加）は、ネットワーク不在以外の start 失敗
   要因（ポート競合・リソース不足等）を救えず、原因が増えるたびに
   チェック項目を足す羽目になる。案1は `createAndStart` の契約
   （「成功時は起動済みコンテナを返し、失敗時は中間状態を残さない」）
   として後始末を完結させるため、addNode/addWorkbench 双方および将来
   `createAndStart` を呼ぶ新経路にも一律に効く。既存の `stopAndRemove`
   のパターンとも一貫している。設計メモの論拠（addNode の
   `usedNetworkIps` は本来 IP 採番目的であり、存在確認への流用は目的の
   混在になる）も妥当。
2. エラー握りつぶしの不在: `dockerode-operations.ts` の実装を確認。
   後始末 `remove({force: true})` の失敗は `console.error` にコンテナ id
   と spec.name 付きで記録され、呼び出し元へは根本原因である元の
   `start()` エラーが差し替えられずに再 throw される。404 を成功扱いに
   変換しない設計判断もコメントで明記されている。失敗時に ok:true 相当を
   返す箇所は無い。
3. addNode 既存ロールバックとの相互作用: beacon の start 失敗時、
   beacon は `createAndStart` 内の後始末（自身の `container.remove`）で、
   reth は addNode 側の `stopAndRemove`（別コンテナ id）でそれぞれ1回ずつ
   削除され、同一コンテナへの二重削除は起きない。reth 自身の start 失敗時
   は beacon が未作成のため競合の余地が無い。統合テスト
   `createandstart-orphan-cleanup.test.ts` が removedIds の突き合わせで
   この性質を固定しており、万一将来重なっても `stopAndRemove` は
   404/409(removal in progress) を成功相当として扱うため良性。
4. テストの質: 単体（+9件）は 404 時のログ・orphan 追跡可能なログ内容・
   失敗原因非依存の一律 force remove・start 失敗が
   `ContainerNameConflictError` に誤変換されないこと・非 Error 値の
   throw・後始末1回きり、と異常系・境界値を具体的にカバー。統合（+4件）
   は fakeOps では通らない本物の後始末ロジックを `EthereumNodeLifecycle`
   経由で検証し、対照群（成功時に remove が走らない）も含む。実装・
   tester とも「意図的に壊して失敗を確認してから復元」の手順を記録して
   おり、意味のないテストになっていない。
5. 境界・環境依存値: 変更は collector の docker 層に閉じており、
   `packages/shared`・frontend への影響なし。チェーンプロファイルへの
   分岐追加なし。タイムアウト等の決め打ち定数の追加なし。
6. docs との齟齬: `docs/ARCHITECTURE.md` は `DockerOperations` の契約を
   個別に記述していないため追記不要とした実装担当の判断に同意。
7. コミット粒度・形式: `git log main..HEAD` の5コミットはいずれも
   1関心事（fix＋対応テスト / tester 単体 / tester 統合 / docs×2）で、
   Conventional Commits 形式に適合。
8. 品質ゲート: `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で
   実行し、すべて成功（shared 75 / collector 1673 / e2e 179 /
   frontend 2730）。

#### 記録上の軽微な訂正（差し戻し不要）

実装記録の「collector 1663件（変更前 1661件から +2）」は数え違い。
fix コミット（ca4fbd6）で追加された単体テストは3件であり、変更前は
1660件（1660 + 3 = 1663、その後 tester が +10 で 1673）。変更後の
1663・最終の 1673 という値自体は正しく、コード・テストの内容には
影響しない。

### 2026-07-18 実動検証(qa)

- 担当: qa
- ブランチ: issue-385-workbench-orphan-container
- 判定: **合格**

#### 検証環境

既に稼働中の共有スタック `chainviz-ethereum`（main ワークスペースの
collector プロセスが管理）はダウンさせず温存し、実 Docker デーモンに対して
ビルド済み dist の `createDockerOperations` / `EthereumNodeLifecycle` を
直接配線した検証スクリプトで確認した。ワークベンチ用イメージ
`ghcr.io/foundry-rs/foundry:latest`・実ネットワーク
`chainviz-ethereum_chain` はスタックのものを流用した。

#### 修正前の挙動の再現（生 dockerode、後始末なし）

存在しないネットワークを指定して生 dockerode で
`createContainer` → `start()` を実行したところ、`createContainer` は成功
（Created 状態のコンテナが生成される）、`start()` が
`(HTTP code 404) ... network ... not found` で失敗した。この経路では
後始末が無く、`docker ps -a` に当該コンテナが Created 状態で残留した
（Issue #385 が指摘する orphan 残留を実 Docker 上で再現）。手動で
`docker rm -f` して掃除した。

#### 修正後の挙動（依頼1）

1. `createDockerOperations(docker).createAndStart(spec)` に存在しない
   ネットワークを指定して実行 → 元の `start()` エラー
   （404 network not found）がそのまま throw され、`docker ps -a` に
   当該名のコンテナが残っていないこと（force remove 済み）を確認した。
2. さらに `EthereumNodeLifecycle` を実 `createDockerOperations` に配線し、
   `composeProject` を存在しないプロジェクト名にして（→ networkName が
   `<存在しない>_chain` になる）`addWorkbench('qa385')` を丸ごと実行した。
   結果、元の start エラー（404 network `chainviz-qa385noexist_chain`
   not found）が伝播しつつ、当該プロジェクト名にマッチするコンテナが
   0 件（orphan 無し）であることを確認した。実装担当が採用した「共通経路
   `createAndStart` 内で force remove」が addWorkbench 経路全体で効いて
   いることを end-to-end で確認できた。

#### 通常経路の回帰確認（依頼2）

実ネットワーク `chainviz-ethereum_chain` を指定して
`createAndStart` を実行 → コンテナが正常に作成・起動され
（`State.Status=running`）、`stopAndRemove` で後始末できることを確認した。
start が成功する通常経路では余分な remove は走らず、従来どおり
起動済みコンテナを返す（回帰なし）。

#### 後始末・影響確認

検証で作成したコンテナ（`chainviz-qa385*`）は全て削除済みで残骸なし。
共有スタック `chainviz-ethereum` は 8 コンテナとも Up のまま無傷で、
reth1 の `eth_blockNumber` が 0x16c → 0x16d と進行し続けており、QA 作業
による影響が無いことを確認した。

#### 結論

`docs/PLAN.md` の当該項目（addWorkbench の start 失敗時に作成済み
コンテナが orphan として残らない）の完了条件を実 Docker 環境で満たして
いる。合格と判定する。PLAN.md のチェックボックス更新は統括に委ねる。
