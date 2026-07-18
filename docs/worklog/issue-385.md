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
