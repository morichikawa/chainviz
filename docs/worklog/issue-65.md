# Issue #65 作業記録

### 2026-07-04 Issue #65 起動時のmanagedコンテナ回収とレジストリ再構築のQA検証(qa)

- 担当: qa
- ブランチ: issue-65-managed-recovery
- 内容: 実環境(profiles/ethereumをdocker compose upで起動)と実collector
  (dist/index.js)を用いて、クラッシュ後の回収シナリオを実機で検証した。
  手順: (1)collector起動→addNodeでreth3+beacon3ペアを作成(managedラベル
  付与を確認)、(2)collectorのnodeプロセスをkill -9で強制終了(クラッシュ
  模擬。managedコンテナはプロセス消滅後も存続することを確認)、(3)collector
  再起動、(4)再起動後のプロセスでremoveNode("chainviz-ethereum/reth3")を
  実行し成功(ok:true)。単一のremoveNodeでreth3・beacon3の両方が削除され、
  ペアとして回収されていたことを確認した。修正前はメモリ上レジストリに
  無いため拒否されるシナリオであり、回収処理が機能していることを確認した。
  既存のcompose起動ノード(reth1/reth2/beacon1/beacon2/validator類/workbench)は
  回収・削除処理の影響を受けず全て稼働継続していた。
  uncaughtException方針の変更は、dist実物のinstallProcessSafetyNetを
  読み込む独立スクリプトで検証: unhandledRejectionはログ出力後もプロセス
  継続、uncaughtExceptionはログ出力後にprocess.exit(1)で終了することを
  実際の終了コード=1で確認した。
  静的確認として `pnpm lint`(exit 0)、`pnpm build`(exit 0)、
  `pnpm test`(collector 350件・frontend 301件ほか全パス, exit 0)も確認した。
- 判定: 合格。Issue #65の期待動作(クラッシュ後の回収、回収ノードの削除可能、
  既存ノードへの非影響、uncaughtException時のプロセス終了)をすべて実機で満たす。
- 決定事項・注意点: 本Issueはdocs/PLAN.mdのチェックボックスに紐づかないため
  PLAN.mdへのチェック付与は不要。検証後はテスト用コンテナをremoveNodeで削除
  済みで、profiles/ethereumは`docker compose down -v`でクリーンな状態へ戻し、
  collectorプロセスも停止した。検証開始時、profiles/ethereumは起動しておらず
  (コンテナ0個)、本検証のためにQA側で起動した点に留意。
### 2026-07-04 Issue #65 起動時のmanagedコンテナ回収によるレジストリ再構築(collector)

- 担当: collector
- ブランチ: issue-65-managed-recovery
- 内容:
  - `DockerOperations`(docker/operations.ts)に、指定ラベル(すべて一致)を
    持つコンテナ一覧を停止中も含めて返す `listContainersByLabels` を追加した。
    ラベルの意味づけ(どのキーが何を表すか)はここでは扱わず、呼び出し側
    (ChainAdapter)が解釈する契約とし、Docker 共通語彙の範囲に留めた。
    dockerode 実装(dockerode-operations.ts)は `listContainers({ all: true,
    filters: { label: [...] } })` で実現した。
  - `EthereumNodeLifecycle`(adapters/ethereum/node-lifecycle.ts)に
    `recoverManagedContainers()` を追加した。`com.chainviz.managed=true`
    ラベルを持つコンテナを走査し、`com.chainviz.role`(execution/consensus/
    workbench)と `com.docker.compose.service`(reth<n>/beacon<n> の命名規則)
    から reth+beacon のペアやワークベンチを再構成し、`this.nodes`/
    `this.workbenches` を再構築する。ファイルベースの永続化は行わず、
    Docker側のラベルを単一の真実の情報源として扱う。
  - `ManagedNode` の `execution`/`consensus` を optional にした。通常の
    addNode では常にペアで作られるが、回収時には「片方だけ生き残っている」
    状態(例: removeNode が片方の削除に成功した直後に collector が落ちた
    場合)が現実に起こりうるため、片方だけでも登録して removeNode の
    再実行で後始末できるようにした。
  - `index.ts` の `main()` で、`CommandHandler` をワイヤリングする(=
    addNode/removeNode 等を受け付け始める)前に `recoverManagedContainers()`
    を呼ぶよう配線した。
  - 対応するユニットテストを追加した(dockerode-operations に
    `listContainersByLabels`/`toLabelFilters` のテスト、node-lifecycle に
    `parseNodeIndex` と `recoverManagedContainers` のテスト一式: ペア回収・
    ワークベンチ回収・片割れのみの回収・不正ラベル/インデックスのスキップ・
    project ラベル欠落時のフォールバック・回収後の addNode/addWorkbench との
    整合性)。
- `uncaughtException` 方針の見直し(Issue #63 からの引き継ぎ課題):
  - Issue #63 時点では「collector プロセスが落ちる = managed コンテナの参照が
    すべて失われ孤児化する」ことを理由に、`uncaughtException` も含めて
    「ログして継続する」方針を採っていた。今回の対応でその前提(プロセス
    消滅=全コンテナ孤児化)が解消したため、`uncaughtException` については
    Node 公式の指針(捕捉できなかった例外の後はプロセスの状態が不定であり、
    継続すべきではない)に戻し、ログを残したうえで `process.exit(1)` する
    よう `installProcessSafetyNet`(index.ts)を変更した。collector は
    `node dist/index.js` でホスト上に手動起動される開発・学習用ツールであり、
    自動再起動の仕組み(supervisor やコンテナの restart ポリシー)は用意して
    いない。したがって exit(1) 後は開発者が手動で再起動するまで停止した
    ままになるが、クラッシュはターミナルの終了とフロント側の切断表示で
    即座に可視化されるため、不定状態のプロセスが壊れた観測結果を配信し
    続けるよりは望ましい(開発ツールとして許容範囲)。再起動後は
    `recoverManagedContainers` が既存のノード/ワークベンチを回収するため
    実害はない。将来 supervisor 等の自動再起動を導入した場合も、この
    exit(1) はそのまま再起動の契機として機能する。
  - 一方 `unhandledRejection` は「await/catch し忘れた promise の失敗」で
    あることが多く、必ずしもプロセス全体の状態が破損しているとは限らない
    ため、従来どおりログして継続する方針を維持した。
  - `installProcessSafetyNet` にテスト用の `exit` 差し替え引数を追加し、
    実プロセスを終了させずに挙動を検証できるようにした。
- 実機検証: 稼働中の profiles/ethereum に対し、ビルド済み collector を
  一時ポート(4077)で起動し、addNode でノード追加 → commandResult(ok:true)
  → reth3/beacon3 コンテナ生成を確認 → プロセスを `kill -9` で強制終了
  (クラッシュを模擬)→ 同ポートで再起動 → removeNode(reth3)を送信し
  commandResult(ok:true)、実際に reth3/beacon3 コンテナが削除されている
  ことを確認した(修正前の挙動であれば「addNodeで追加されていない」で
  拒否されるはずのシナリオ)。既存 compose のノード(reth1/2, beacon1/2,
  validator1/2, workbench)には影響がないことも確認した。
- 検証: collector パッケージの `pnpm build` / `pnpm test`(349 tests)
  通過。ワークスペース全体の `pnpm build` / `pnpm lint` / `pnpm test`
  (collector 349 + frontend 301 + shared 2 + e2e 14 = 666 tests)通過。

### 2026-07-04 Issue #65 レビュー(chainviz-reviewer)

- 対象: issue-65-managed-recovery(未コミットのワークツリー)
- 静的確認: `pnpm build` / `pnpm lint` / `pnpm test` 全通過(collector 349 +
  frontend 301 + shared 2 + e2e ヘルパー 14 = 666 件)。`pnpm test:e2e` は
  Issue #64 の同時実行問題を避けるため実行していない(指示による)。
- 合格と評価した点:
  - ChainAdapter 境界: `listContainersByLabels` は Docker 共通語彙
    (ラベルの key/value・コンテナ id)のみを扱い、ラベルの意味づけ
    (`com.chainviz.managed` / `com.chainviz.role` / reth<n>・beacon<n> の
    命名規則)は ethereum アダプタ内に閉じている。shared / frontend への
    チェーン固有語彙の漏れなし。
  - `packages/shared` の型変更不要の判断は妥当(プロトコル・ワールド
    ステートのスキーマに変更がなく、回収は collector 内部の関心)。
  - `recoverManagedContainers` と既存ロジックの整合: 回収した index が
    `addNode` の takenIndexes に効くこと、回収済みワークベンチ名が
    `uniqueWorkbenchService` の退避に効くことがテストで実証されている。
    `ManagedNode.execution/consensus` の optional 化も「片割れだけ残る」
    実在する異常系への妥当な対応で、removeNode の再実行で後始末できる。
  - エラーの握りつぶしなし: 回収時のスキップは console.warn で残し、
    回収自体の失敗は main() の fatal 経路で exit(1) する(回収できないまま
    コマンド受付を始めると #65 以前の状態に戻るため fail-fast が正しい)。
  - uncaughtException の方針転換(ログ+exit(1))自体は妥当。Issue #63 で
    「継続」を選んだ唯一の根拠(プロセス消滅=全 managed コンテナ孤児化)が
    本対応で解消し、不定状態のプロセスが壊れた観測結果を配信し続ける
    リスクの方が停止より悪い。unhandledRejection を「ログして継続」に
    残す区別も合理的。
- 差し戻し(要修正)2点:
  1. supervisor 前提の記述が現状と不一致: リポジトリには collector の
     自動再起動機構が存在しない(compose に restart ポリシーなし、collector
     は `pnpm start`/`node dist/index.js` でホスト上に手動起動)。ログ文言
     「exiting so a supervisor can restart the collector」とコード内
     コメント・WORKLOG の「supervisor/コンテナの再起動ポリシーによる
     再起動を前提とする」は実在しない前提を書いている。方針自体は
     手動再起動でも成立する(exit は開発者に即座に見え、再起動後に回収が
     効く)ため、記述を「現状は手動再起動(開発ツールとして許容)。将来
     supervisor を導入しても安全」という事実に合わせて修正すること。
  2. 回収クエリのスコープが自分の書くラベルと非対称:
     `recoverManagedContainers` は `com.chainviz.managed=true` だけで
     フィルタしているが、この lifecycle が作るコンテナは必ず
     `com.docker.compose.project`(cfg.composeProject)も付けている。
     クエリに project ラベルを加えないと、(a) 将来の別チェーン
     プロファイルの lifecycle が同じ managed ラベルを使ったとき互いの
     コンテナを取り込む(チェーンプロファイル独立性の原則に反する)、
     (b) `?? this.cfg.composeProject` フォールバックが、project ラベルを
     持たない外来コンテナに `chainviz-ethereum/<service>` という stableId を
     捏造する。正規のコンテナには決して発火しないフォールバックであり、
     テスト「falls back to the configured composeProject...」はこの誤動作を
     仕様として固定してしまっている。クエリへ
     `[COMPOSE_PROJECT_LABEL]: this.cfg.composeProject` を追加し、
     フォールバックは削除(欠落時は warn してスキップ)、当該テストは
     新しい契約に合わせて書き換えること。
- 軽微(任意)の指摘:
  - `this.workbenchSeq = this.workbenches.length;` のコメント「既に使われて
    いる番号より後ろから採番を再開」は不正確(復元できるのは個数であって
    過去の最大番号ではない。以前に削除された分だけ番号が進んでいた場合、
    理論上は名前衝突しうる)。衝突しても createAndStart の失敗が
    commandResult(ok:false) で返るため実害は限定的だが、コメントは実挙動
    (個数から再開)に合わせて正すこと。
  - sync-docs 観点: docs/ARCHITECTURE.md「未確定のまま残す項目」の
    「再起動時の復元をどうするか」に対し、今回 managed レジストリについて
    「Docker ラベルを単一の真実の情報源とし起動時に回収する」方針が
    確定した。ARCHITECTURE.md への反映(追記)を推奨する。
  - コミット分割の指針(未コミットのため事前助言): 少なくとも
    uncaughtException の方針変更は managed コンテナ回収の実装とは別の
    関心事なので別コミットにすること(例: docker 操作の追加 / 回収
    ロジック+配線 / safety net 方針変更 / docs の 3〜4 分割)。
- 結論: 設計・境界・テストの質は良好。上記2点の修正(いずれもコメント・
  文言とクエリ条件の小規模修正)を反映のうえ再確認とする。

### 2026-07-04 Issue #65 レビュー指摘への対応(collector)

- 担当: collector
- ブランチ: issue-65-managed-recovery
- 対応した指摘(chainviz-reviewer の差し戻し2点 + 軽微指摘):
  1. 存在しない supervisor 前提の記述を実態に合わせて修正した。
     collector は `node dist/index.js` で手動起動される開発・学習用ツールで
     あり自動再起動機構は無いため、`installProcessSafetyNet`(index.ts)の
     uncaughtException ログ文言を
     「exiting (restart the collector manually to resume)」に変更し、
     同関数の doc コメントと WORKLOG の記述も「手動再起動(開発ツールとして
     許容)。クラッシュは端末終了とフロントの切断表示で即座に可視化され、
     再起動後は recoverManagedContainers が状態を復元する。将来 supervisor を
     導入しても exit(1) はそのまま再起動契機として機能する」という事実に
     合わせて書き換えた。index.test.ts のテスト名からも supervisor の記述を
     除いた(挙動の検証内容は不変)。
  2. 回収クエリのスコープ漏れを修正した。`recoverManagedContainers()` の
     `listContainersByLabels` フィルタに
     `[COMPOSE_PROJECT_LABEL]: this.cfg.composeProject` を追加し、別チェーン
     プロファイルの lifecycle が同じ managed ラベルを使っても互いの
     コンテナを取り込まないようにした(チェーンプロファイル独立性)。
     あわせて `toManagedContainer` の `?? this.cfg.composeProject`
     フォールバックを削除し、project ラベルが欠落しているコンテナは warn して
     スキップするようにした(欠落時に安定 ID を捏造しない)。既存テスト
     「falls back to the configured composeProject when the project label is
     absent」は誤った挙動を仕様化していたため、新しい契約(project ラベル
     欠落時はスキップされ removeNode が拒否される)を検証するテストへ
     書き換えた。
  - 軽微: `workbenchSeq = this.workbenches.length` のコメントを、復元できる
     のは過去の最大番号ではなく現存する個数である旨(および衝突時は
     createAndStart 失敗で commandResult(ok:false) として返るため実害が
     限定的である旨)に正した。
  - 軽微(sync-docs): docs/ARCHITECTURE.md「未確定のまま残す項目」の
     「再起動時の復元をどうするか」に、managed レジストリについて
     「Docker のラベルを単一の真実の情報源とし起動時に回収する」方針が
     確定した旨を追記した。
- 検証: collector パッケージの `pnpm build` / `pnpm test` 通過。ワーク
  スペース全体の `pnpm lint` / `pnpm build` / `pnpm test` 通過。

### 2026-07-04 Issue #65 再レビュー(chainviz-reviewer)

- 対象: issue-65-managed-recovery(未コミットのワークツリー、差し戻し対応後)
- 静的確認: `pnpm lint` / `pnpm build` / `pnpm test` 全通過(collector 349 +
  frontend 301 + shared 2 + e2e ヘルパー 14 = 666 件)。`pnpm test:e2e` は
  指示により実行していない。
- 差し戻し2点の確認結果:
  1. supervisor 前提の記述: ログ文言が「exiting (restart the collector
     manually to resume)」へ、doc コメント・WORKLOG が「手動再起動を前提と
     した開発ツール。将来 supervisor を導入しても exit(1) はそのまま機能」
     という事実に修正済み。uncaughtException で exit(1) すること・
     unhandledRejection では exit しないことの両方がテストで固定され、
     旧挙動(継続)ではテストが落ちることを確認した。適切。
  2. 回収クエリのスコープ: `recoverManagedContainers()` のフィルタに
     `com.docker.compose.project`(cfg.composeProject)が追加され、
     `toManagedContainer` のフォールバックは削除、project ラベル欠落時は
     warn してスキップに変更済み。書き換えられたテスト(欠落コンテナは
     登録されず removeNode が拒否される)は、旧コード(フォールバック有り)
     では removeNode が成功して落ちるため、新契約を実効的に固定している。
     適切。
  - 軽微指摘(workbenchSeq コメントの実挙動への修正、ARCHITECTURE.md
    「未確定のまま残す項目」への方針確定の追記)も対応済みを確認した。
- 残指摘(小・要対応): クエリスコープ修正のうち「フィルタに project ラベルを
  含める」側がテストで固定されていない。node-lifecycle.test.ts の fakeOps は
  `listContainersByLabels` の引数を無視して managedContainers を返すため、
  実装のフィルタを `{ [MANAGED_LABEL]: "true" }` だけに戻しても(= 別チェーン
  プロファイルのコンテナを取り込む元の欠陥が再発しても)全 666 テストが通って
  しまう。recoverManagedContainers のテストのいずれかに
  `expect(ops.listContainersByLabels).toHaveBeenCalledWith({
  "com.chainviz.managed": "true", "com.docker.compose.project":
  "chainviz-ethereum" })` 相当のアサーション(1件)を追加すること。
- 結論: 差し戻し2点の修正は適切。上記アサーション1件の追加をもって合格とする
  (実装コードの変更は不要、テスト1行の追加のみ)。

