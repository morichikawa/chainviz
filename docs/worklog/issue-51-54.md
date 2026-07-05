# Issue #51-54 作業記録

### 2026-07-04 Issue #51-#54 E2E結合テストの再検証(qa)

- 担当: qa
- ブランチ: issue-51-e2e-scaffold
- 内容: 追従待ちを動的タイムアウト+進捗停止検出(catch-up.ts)に置き換えた
  後のステップ6全体を実環境で再検証した。前回の不合格(固定120秒タイム
  アウトで長く進んだチェーンでは確実に失敗)が解消されているかを確認する
  のが主眼。
  - 検証環境: `profiles/ethereum`のスタックが約2時間継続稼働。検証開始
    時点のチェーン高は2875ブロック(前回不合格時の1900超をさらに上回る)。
  - `pnpm test:e2e`を実行し全9件が成功(a-b-layer 3件 + commands 6件)。
    最重要のブロック追従テスト(addNodeした reth が既存チェーンに追従)は
    高さ2875に対し約280秒(280412ms)で合格。動的タイムアウトの内部上限
    540秒・itタイムアウト600秒に対し十分な余裕があり、現在のチェーン高に
    応じた妥当な時間で完了することを確認した。全体所要は約5分44秒。
  - `pnpm lint && pnpm build && pnpm test`(pre-pushフックと同一)は約5.7秒で
    完了。実Docker前提のテスト(a-b-layer.test.ts / commands.test.ts)は
    実行されず、`pnpm -r test`にE2Eが混入しないことを確認した。
  - `pnpm --filter @chainviz/e2e test`単体では`catch-up.unit.test.ts`の
    14件のみが実行されることを確認した(vitest.unit.config.tsのinclude)。
  - `docs/CONTRIBUTING.md`のE2E記述と実装の一致を確認: 待ち受けポート4123
    (collector.ts の startCollector 既定値・CHAINVIZ_COLLECTOR_PORT で注入)、
    稼働中スタックを再利用し up -d を呼ばない挙動(docker.ts ensureChainRunning)、
    unit/e2e の設定分離、前提条件(事前 pnpm build・ブリッジネットワーク到達)
    のいずれも記述どおり。
- 決定事項・注意点: ステップ6の完了条件(実環境でA層・B層・ステップ5操作
  コマンドが自動検証され、pre-pushフック対象にE2Eが混入しない)を満たす。
  合格と判定。検証後、collector子プロセス(ポート4123)・addNodeで追加した
  ノード/ワークベンチの残骸がないこと、元のcompose 7コンテナのみが残る
  クリーンな状態を確認した。前回WORKLOG(#53)にある「上限540秒を超える
  長時間稼働ではタイムアウトしうる」点は今回の2875ブロック(約280秒)では
  問題にならなかったが、既知の制約として引き続き有効。

### 2026-07-04 Issue #53 E2Eテストの追従待ちタイムアウトを動的算出に変更

- 担当: collector
- ブランチ: issue-51-e2e-scaffold
- 内容: chainviz-qaの検証で、addNodeのブロック追従待ちが固定タイムアウト
  (120秒)のため、稼働時間が延びてチェーンが長く進行した環境(バックフィル
  すべき履歴が長い)では確実に失敗することが判明した(#44/#46のような
  実際の回帰ではなく、E2Eテスト自体の設計不備)。
  - 新規`packages/e2e/src/helpers/catch-up.ts`: 待ち開始時点の高さの差分
    (gap)から保守的なバックフィル速度(5ブロック/秒。実測9〜10に対し安全
    マージン)で動的にタイムアウトを算出する`catchUpTimeoutMs()`と、
    観測した最大高さが一定時間(45秒)更新されなければ停止と判定する
    `CatchUpMonitor`を組み合わせた`waitForBlockCatchUp()`を実装。
  - `commands.test.ts`の追従待ちをこれに差し替え。
  - Docker非依存の純粋ロジックとして`catch-up.unit.test.ts`(14ケース)を
    追加し、`packages/e2e`に`test`スクリプトを新設。`vitest.config.ts`の
    excludeで`*.unit.test.ts`をtest:e2e(実Docker前提)の対象から外し、
    逆に`vitest.unit.config.ts`のincludeで`test`スクリプトの対象を
    `*.unit.test.ts`のみに絞ることで、`pnpm -r test`(pre-pushフック対象)
    には実Docker前提のテストが混入しないようにした。
- 決定事項・注意点: 実機で、稼働時間約1時間・チェーン高1900ブロック超の
  環境において、旧設計なら確実に失敗する条件(追従に220秒要した)で
  新設計が正しく機能することを確認した。上限540秒を超える長時間稼働
  (連続稼働 約2.7時間超相当)では健全でもタイムアウトしうるため、
  長時間運用時はスタック再作成で回避する。

### 2026-07-04 Issue #51-#54 E2E(結合)テストの導入(packages/e2e)

- 担当: collector
- ブランチ: issue-51-e2e-scaffold
- 内容:
  - 新規ワークスペースパッケージ `packages/e2e` を追加。実 Docker + 実
    collector に対する結合テストを置く。`pnpm-workspace.yaml` の
    `packages/*` に自動で含まれる。ルート `tsconfig.json` の references には
    追加しない(e2e はビルド対象ではなくテスト実行専用。型検査は
    `tsc --noEmit` を `typecheck` スクリプトとして分離)。
  - ヘルパー群(`src/helpers/`):
    - `docker.ts`: `profiles/ethereum` を起動しチェーン進行開始まで待つ。
      **既に稼働中で進行していればそのまま再利用し、停止中のときだけ
      `docker compose up -d` する**設計(理由は下記「決定事項」)。
    - `collector.ts`: collector を子プロセス(`node packages/collector/
      dist/index.js`)として起動し、テスト終了時に `process.kill()` で停止。
      main() を同一プロセスで import しない(後片付けが確実にできないため。
      #51 の指示)。ポートは `CHAINVIZ_COLLECTOR_PORT` で 4123 を渡す。
    - `ws-client.ts`: `@chainviz/shared` の型だけを使う軽量 WebSocket
      クライアント。snapshot/diff を畳み込んでクライアント側ワールド
      ステートを再構築し、command 送信と commandResult 待ちを提供する。
      `@chainviz/frontend` には依存しない(#51 の指示)。
    - `rpc.ts`: Ethereum の JSON-RPC(eth_blockNumber 等)を直接叩く。
      チェーン固有の検証ロジックは e2e パッケージ内に閉じ込め、collector
      本体には手を入れていない。
  - テスト:
    - `a-b-layer.test.ts`(#52): 接続時スナップショットに reth1/2・beacon1/2・
      validator1/2・workbench が正しい kind/clientType で載ること、beacon1↔
      beacon2 の PeerEdge、あるブロックの receivedAt に複数ノードの受信時刻が
      非ゼロの差で載ること。
    - `commands.test.ts`(#53): addNode→ok:true→reth+beacon ペア出現、
      **追加した reth の JSON-RPC を直接叩いてブロック追従を確認**、
      removeNode(既存 compose ノードは ok:false で拒否 / 追加ノードは削除可)、
      addWorkbench/removeWorkbench。
  - collector 本体への変更は最小限で、`resolvePort()`(環境変数
    `CHAINVIZ_COLLECTOR_PORT` で待ち受けポートを差し替え可能にする)を追加し
    ユニットテストも追加した。既存 dev collector とポート衝突しないため。
  - 配線(#54): ルート `package.json` に
    `"test:e2e": "pnpm --filter @chainviz/e2e test:e2e"` を追加。
    `packages/e2e` は `test` スクリプトを持たないため `pnpm -r test`
    (pre-push フックの対象)からは自動でスキップされる(実際に確認済み)。
    `docs/CONTRIBUTING.md` に前提条件・実行方法・実行時間の目安を追記。
- 決定事項・注意点:
  - **genesis 再生成の落とし穴(重要)**: `profiles/ethereum` の genesis は
    ワンショットサービスで、`generate-genesis.sh` が `GENESIS_TIMESTAMP` を
    現在時刻で埋めるため、`docker compose up -d` のたびに毎回異なる genesis を
    共有ボリュームへ作り直す。稼働中のスタックに対して `up -d` を呼ぶと、
    走り続けている reth1/2 は古い genesis のままだが共有ボリュームだけが
    新しい genesis に置き換わる。この状態で `addNode` すると、新規 reth が
    「別の genesis」で init してしまい既存ノードと genesis ハッシュが食い違い、
    EL の P2P ハンドシェイクに失敗してブロックに追従できない。E2E ハーネスの
    docker ヘルパーは、既に健全に稼働しているスタックには `up -d` を呼ばず
    再利用することでこれを回避している。**運用上の含意**: chainviz の通常の
    起動フロー(`docker compose up` を一度きり)では問題ないが、稼働中に
    `docker compose up -d` を再実行すると以後の addNode が壊れる。これは
    node-env 側の潜在的な脆さであり、必要なら別途対処を検討する(このタスクの
    範囲では変更していない)。
  - **回帰検出の確認(#53)**: `reth-node.sh` の peer 分岐から
    `--trusted-peers`/`--bootnodes` を一時的に外して EL 間 P2P を壊し、
    追加ノードがブロックに追従できず block-following テストがタイムアウトで
    失敗することを実際に確認した(確認後スクリプトは元に戻し、sha1 一致を
    検証済み)。この過程で判明した重要な性質: チェーンが genesis 直後でごく
    短い(数十〜百ブロック程度)場合、CL が EL へブロックを順番に渡すため
    EL 間 P2P が無くても Engine API のみで追従してしまい、回帰が表面化しない。
    十分に進んだチェーン(数百ブロック)では CL がオプティミスティックに head を
    渡すため EL のバックフィルが必要になり、そこで初めて回帰が確実に検出できる。
    継続稼働するスタックを再利用する本ハーネスの通常運用ではこの条件を満たす。
  - E2E は実 Docker とブリッジネットワークのコンテナ IP(172.28.0.0/16)への
    ホストからの到達性を前提とする(collector がコンテナ IP へ直接接続する
    ため)。Linux/WSL2 の標準 Docker では到達可能。
  - 実行結果: A/B 層 3 件・操作コマンド 6 件の計 9 件すべて healthy 環境で
    成功。所要は稼働中スタック再利用で 2〜3 分程度。

### 2026-07-04 Issue #51-#54 E2E(結合)テスト導入のレビュー

- 担当: reviewer
- ブランチ: issue-51-e2e-scaffold
- 内容: packages/e2e 新設(#51〜#53)・test:e2e 配線(#54)・collector の
  `resolvePort()` 追加を静的レビューし、ビルド・lint・テスト・E2E 本体を
  実行して確認した。
  - `pnpm lint` / `pnpm build` / `pnpm test` はすべて成功。`pnpm -r build` /
    `pnpm -r test` とも「Scope: 4 of 5」で packages/e2e が自動スキップされ、
    エラーにならないことを実行して確認した(shared 2 / collector 323 /
    frontend 301 件)。pre-push フックに E2E が混入しないという完了条件を
    満たす。
  - `pnpm test:e2e` を稼働中スタックに対して実行し、9 件(A/B 層 3 件 +
    操作コマンド 6 件)すべて成功(141 秒)。終了後にポート 4123 の解放・
    追加コンテナの残骸なし・compose の 7 サービスが元のまま稼働中である
    ことを確認した。
  - 境界の遵守: `eth_blockNumber` 等のチェーン固有語彙は
    `packages/e2e/src/helpers/rpc.ts` に閉じており、collector の
    `adapters/ethereum/` には変更なし。ws-client は `@chainviz/shared` の
    型のみに依存し frontend を参照しない。shared の型変更は不要
    (既存の Command / ServerMessage / エンティティ型で完結)という判断は
    妥当。
  - collector 子プロセス起動(dist/index.js + SIGTERM、5 秒後 SIGKILL
    フォールバック)は、main() が停止手段を返さない制約への対応として
    妥当。`resolvePort()` は直接実行パスのみに作用し `main()` の既定値
    (DEFAULT_PORT)を変えない最小限の変更で、異常系(未設定・空白・
    非数値・負値)のユニットテストも揃っている。
  - テストの質: removeNode の拒否(既存 compose ノード)という異常系を含み、
    ブロック追従テストは EL 間 P2P を壊すと実際に失敗することが確認済み
    (#44/#46 の回帰検出として有効)。
- 決定事項・注意点(実装担当への指摘。マージ前に対応すること):
  1. (要修正) `docs/ARCHITECTURE.md` §1 のリポジトリ構成図に
     `packages/e2e` が載っていない。1 行追記して docs と実装を同期する。
  2. (推奨) packages/e2e の型検査(`typecheck` スクリプト)がどこにも
     配線されておらず、vitest は型検査をしないため e2e の型崩れは
     pre-push で検出されない。`"build": "tsc --noEmit"` を
     packages/e2e/package.json に追加すれば `pnpm -r build` に自然に乗る
     (Docker 不要・高速のため完了条件に抵触しない)。
  3. (軽微) ws-client.ts の close() 内
     `for (const timer of this.pending.values()) void timer;` は何もしない
     死にコード。保留コマンドの setTimeout は close 後も発火する。整理を
     推奨。
  4. (軽微・記録のみ) helpers/collector.ts は collector が即死した場合、
     waitFor が例外を「未達」として再試行するため失敗確定まで最大 30 秒
     かかる(失敗時メッセージにログは含まれるので調査は可能)。
  5. (軽微・記録のみ) resolvePort は parseInt の性質上 "80abc" を 80 と
     解釈し、65535 超の値も通す(listen 時にエラーになる)。フォールバック
     設計としては許容範囲。
  - コミットはまだ無い。コミット時は関心事ごとに分けること(例:
    collector の resolvePort / e2e 土台 #51 / A・B 層テスト #52 /
    コマンドテスト #53 / test:e2e 配線 + CONTRIBUTING #54 /
    PLAN・WORKLOG の docs 更新)。

### 2026-07-04 Issue #51-#54 E2E(結合)テスト導入の再レビュー

- 担当: reviewer
- ブランチ: issue-51-e2e-scaffold
- 内容: 前回レビューの指摘 1〜3 への対応(collector 担当による修正)を
  再レビューした。結果は合格。
  - 指摘 1(要修正): `docs/ARCHITECTURE.md` §1 の構成図に
    `e2e/  # E2E 結合テスト(collector を実 Docker と疎通させて検証)` の
    1 行が追記されており、実装と同期した。
  - 指摘 2(推奨): `packages/e2e/package.json` に `"build": "tsc --noEmit"`
    が追加され、`pnpm -r build` の実行で e2e の型検査が走ることを確認した
    (「Scope: 4 of 5」→ build は e2e を含む 4 パッケージで実行)。`test`
    スクリプトは追加されていないため、`pnpm -r test` からの除外(E2E が
    pre-push に混入しない完了条件)は維持されている。CONTRIBUTING.md の
    「packages/e2e は test スクリプトを持たない」という記述とも整合。
  - 指摘 3(軽微): ws-client.ts の close() から死にコード
    (`for (const timer of this.pending.values()) void timer;`)が削除され、
    `this.pending.clear()` のみの素直な実装になった。
  - `pnpm lint` / `pnpm build` / `pnpm test`(pre-push フックと同一)を
    自分でも実行し、すべて成功(collector 323 / frontend 301 件)。
  - 指摘 4・5 は前回記録のとおり「記録のみ」であり対応不要。
- 決定事項・注意点:
  - コミットはまだ無い(意図どおり)。コミット時は前回記録した関心事ごとの
    分割に従うこと。この後 chainviz-qa の実機検証に進む。

### 2026-07-04 Issue #51-#54 E2E(結合)テスト導入の実機検証(不合格)

- 担当: qa
- ブランチ: issue-51-e2e-scaffold
- 内容: 実 Docker(profiles/ethereum、稼働中スタックを再利用)+ 実 collector
  に対し `pnpm test:e2e` を実行し、ステップ6の完了条件を検証した。
- 結果: 不合格。9 件中 8 件成功、1 件失敗。
  - 失敗テスト: commands.test.ts >
    「addNode > 最重要: 追加した reth が既存チェーンにブロック追従する
    (0 のままにならない)」。
    `timed out after 120000ms waiting for added reth to reach block height 1491`。
  - 切り分け: これは #44/#46 の回帰(EL 間 P2P 無効でブロックに追従しない)
    ではない。手動で addNode を実行し追加 reth(reth3, 172.28.1.3)の
    ブロック高を時系列で観測したところ、履歴バックフィルは正常に機能し、
    約 150 秒で target(1616)に追いついた(CAUGHT UP)。追従機能そのものは
    実環境で正しく動いている。
  - 失敗の原因: テストの追従待ちタイムアウトが 120 秒固定
    (commands.test.ts の `timeoutMs: 120_000`)である一方、バックフィルの
    実測速度は約 9〜10 ブロック/秒、チェーンの成長は約 0.5 ブロック/秒。
    チェーンが約 1500 ブロック以上進んだ状態では追いつくまで約 150 秒以上
    かかり、120 秒では間に合わない。観測では t=120s 時点で追加ノードは
    1309、target は 1616 でまだ大きく届いていなかった。
  - ハーネスは稼働中スタックを再利用する設計(docker.ts / CONTRIBUTING.md)
    で、テスト自身のコメントも「チェーンが十分進んでいるほどバックフィル
    履歴が長くなる」と認めているにもかかわらず、待ち時間を固定値にして
    いる。稼働時間が延びるほど確実に失敗する構造で、一過性のフレークでは
    ない(手動再現でも 120 秒では届かないことを確認)。
  - 完了条件「ステップ5の操作コマンドが自動検証され」に対し、最重要の
    addNode ブロック追従検証が長時間稼働(=ハーネスが想定する主運用)の
    スタックで安定して通らず、`pnpm test:e2e` が exit 1 になる。
- 合格した項目:
  - A 層・B 層テスト(a-b-layer.test.ts、スナップショット 7 エンティティ・
    beacon 間 PeerEdge・ブロック伝播タイミングの時間差)は全て成功。
  - コマンドテストのうち addNode 出現・removeNode 保護・追加ノード削除・
    addWorkbench/removeWorkbench は成功。
  - `pnpm lint && pnpm build && pnpm test`(pre-push フックと同一)は
    lint 約 1.9s / build 約 1.7s / test 約 3.9s の合計 8 秒程度で完了し、
    E2E テストは混入していない(collector 323 / frontend 301 件のみ)。
    e2e は `test` スクリプトを持たず `pnpm -r test` から除外される
    完了条件の後半は満たされている。
  - CONTRIBUTING.md 記載の実行方法(`pnpm build` → `pnpm test:e2e`)は
    記載どおりに動作し、コマンド配線・前提条件の記述は正確。
- 差し戻し先: collector(packages/e2e の追従待ちタイムアウト設計)。
  対応案としては、追従待ちタイムアウトをチェーン深さに応じて動的に
  伸ばす、または backfill 進捗が止まっていないこと(高さが単調増加して
  いること)を基準に判定するなど、長時間稼働スタックでも安定して通る
  設計へ変更する。
- クリーンアップ: 手動検証で追加した reth3/beacon3 は removeNode で削除
  済み(残存なし)。手動起動した collector プロセス(port 4123)は停止済み。
  Docker スタックは検証前から稼働していた 7 コンテナ + genesis(Exited)の
  状態に戻している。

### 2026-07-04 Issue #51-#54 addNode 追従待ちの動的タイムアウト化のレビュー

- 担当: reviewer
- ブランチ: issue-51-e2e-scaffold
- 内容: qa の不合格指摘(追従待ちが固定 120 秒でチェーンが長く進んだ環境では
  確実に失敗する)への collector 担当の修正(`packages/e2e/src/helpers/
  catch-up.ts` 新設・`commands.test.ts` の差し替え・ユニットテスト 14 件・
  e2e パッケージへの `test` スクリプト追加)を再レビューした。実装・テスト
  分離は合格。ただし docs に軽微な差し戻し 2 点あり(下記)。
  - **`test` / `test:e2e` の分離(最優先確認事項)**: `pnpm -r test` を実行し、
    全体 3.8 秒で完了・collector 323 / frontend 301 / e2e 14 件(catch-up.
    unit.test.ts のみ)の構成であることを確認した。`vitest.unit.config.ts`
    は include が `src/**/*.unit.test.ts` のみ、`vitest.config.ts`(test:e2e)
    は `**/*.unit.test.ts` を exclude しており、実 Docker 前提の
    a-b-layer.test.ts / commands.test.ts が pre-push フック(`pnpm test`)に
    混入しないことを実行ログで確認した。前回合格時の「e2e は test スクリプト
    を持たない」前提は変わったが、分離自体は正しく機能している。
  - `pnpm lint` / `pnpm build` も成功(e2e の `tsc --noEmit` 型検査を含む)。
  - ロジックの妥当性: `catchUpTimeoutMs` は実測 9〜10 ブロック/秒に対し
    保守的な 5 ブロック/秒でタイムアウトを算出し、下限 120s・ベース 30s・
    上限 540s(vitest の it タイムアウト 600s より先に内部エラーを出すため)
    という構成は妥当。`CatchUpMonitor` の停止検出は「観測最大高さが 45 秒
    更新されない」基準で、初回観測を進捗扱いにする(初期値 -1)ことで RPC
    起動待ちを停止と誤判定しない設計も妥当。`waitForBlockCatchUp` は
    getHeight の例外を「観測なし」として停止判定から除外し、全体タイム
    アウトのみで見張る扱いも適切。
  - テストの質: 14 件は到達・停止・動的タイムアウト・RPC 一時到達不能から
    の復帰・負の gap・パラメータ指定・初回観測遅延をカバーする。特に
    「停止時は 120s を待たず失敗する(clock < 120_000)」「gap 2000 では
    固定 120s を超えて待てる(clock > 120_000)」のアサーションは、停止検出
    の削除や固定タイムアウトへの退行で確実に落ちる意味のあるテストに
    なっている。
  - `pnpm test:e2e` を約 1 時間稼働中のスタック(qa の不合格条件と同等)に
    対して実行し、9 件全て成功(全体 283 秒)。最重要のブロック追従テストは
    220 秒を要しており、旧固定 120 秒では確実に失敗していた条件で動的
    タイムアウトが機能したことを実地で確認した。終了後、ポート 4123 の
    解放・追加コンテナの残骸なし・compose の 7 サービス継続稼働を確認。
- 決定事項・注意点(collector 担当への差し戻し。いずれも docs のみ):
  1. (要修正) `docs/CONTRIBUTING.md` の「packages/e2e は `test` スクリプトを
     持たず、`test:e2e` として分離している。`pnpm -r test` からは自動的に
     スキップされる」という記述が実装と食い違った。現在は `test` スクリプト
     があり docker 非依存の `*.unit.test.ts` のみを実行する。実態に合わせて
     書き直すこと。
  2. (要修正) 今回の修正(catch-up.ts 新設・commands.test.ts 差し替え)自体の
     WORKLOG 記録が無い。CLAUDE.md のルールに従い、collector 担当が作業
     記録を追記すること。
  3. (記録のみ) 全体タイムアウトの上限 540s により、スタックの連続稼働が
     非常に長くなる(実測レートで gap 約 5000 ブロック、稼働約 2.7 時間相当を
     超える)と、健全なバックフィルでもタイムアウトしうる。恒常的に長時間
     稼働させる運用ではスタックの再作成で回避する。
  4. (記録のみ) `waitForBlockCatchUp` の「RPC が一度も応答しないまま全体
     タイムアウト」経路のユニットテストが無い(カバレッジの軽微な穴。
     ブロッカーではない)。
  - コミットはまだ無い(意図どおり)。docs 2 点の対応後、前回記録した
    関心事ごとのコミット分割に従うこと。

### 2026-07-04 Issue #53 docs修正(CONTRIBUTING/WORKLOG)の再レビュー

- 担当: reviewer
- ブランチ: issue-51-e2e-scaffold
- 内容: 前回レビューの docs 指摘 2 点への対応(統括による修正)を再レビュー
  した。結果は 1 点差し戻し。
  - WORKLOG.md の Issue #53 作業記録(追従待ちの動的タイムアウト化): 合格。
    catch-up.ts の実装(既定値 5 ブロック/秒・ベース 30s・下限 120s・
    上限 540s・停止判定 45s)、ユニットテスト 14 件、vitest 2 設定の
    分離機構の説明、実機確認の数値(追従 220 秒・上限 540s ≒ 連続稼働
    約 2.7 時間相当)のいずれも実装・過去の検証記録と一致しており正確。
  - CONTRIBUTING.md の「E2E(結合)テスト」節: 分離の実態(`test` スクリプト
    あり・`*.unit.test.ts` のみ対象・E2E 本体は `test:e2e` のみ)は正しく
    なったが、**分離を実現している設定ファイルの帰属が誤っている**
    (要修正)。現在の記述は「E2E テスト本体は `vitest.config.ts` の
    exclude 設定で `test` スクリプトの対象から外し」だが、実際は逆で、
    `vitest.config.ts` の exclude は `*.unit.test.ts` を `test:e2e` から
    除外するもの。E2E 本体を `test` スクリプトから外しているのは、
    `test` スクリプトが `--config vitest.unit.config.ts` を使い、その
    include が `src/**/*.unit.test.ts` のみに絞られていること。
    WORKLOG 側の記述は正しいため、CONTRIBUTING が実装とも WORKLOG とも
    矛盾している。該当 1 文を WORKLOG と同じ説明(exclude は test:e2e 側、
    include は test 側)に直すこと。
  - `pnpm lint` / `pnpm build` / `pnpm test` は全て成功(docs のみの変更
    なので当然だが、pre-push フックと同一の確認として実行した)。
- 決定事項・注意点:
  - (記録のみ) 今回の Issue #53 記録は WORKLOG の先頭(「## 記録」直後)に
    置かれたが、関連する Issue #51-#54 の一連の記録はファイル末尾にある。
    ファイル全体の並び順が既に新旧混在しているため差し戻しにはしないが、
    経緯を追う際は両方を参照すること。
  - コミットはまだ無い(意図どおり)。

### 2026-07-04 Issue #53 docs修正(CONTRIBUTING.md 設定ファイル帰属)の再々レビュー

- 担当: reviewer
- ブランチ: issue-51-e2e-scaffold
- 内容: 前回レビューの指摘(CONTRIBUTING.md「E2E(結合)テスト」節における
  分離設定ファイルの帰属誤り)への対応を再レビューした。結果は合格。
  - 修正後の記述「`packages/e2e` は `test` スクリプトを持つが、
    `vitest.unit.config.ts`(include が `src/**/*.unit.test.ts` のみ)を
    指す」「E2E テスト本体は `test:e2e` が指す `vitest.config.ts` 側で
    `**/*.unit.test.ts` を exclude することで住み分け」は、
    `packages/e2e/package.json`(`test` = `vitest run --config
    vitest.unit.config.ts`、`test:e2e` = `vitest run`)、
    `vitest.unit.config.ts`(include: `src/**/*.unit.test.ts`)、
    `vitest.config.ts`(include: `src/**/*.test.ts`、exclude:
    `**/*.unit.test.ts`)の実装と正確に一致する。
  - 同節のその他の記述(ルート `pnpm test` = `pnpm -r test`、
    `pnpm test:e2e` = `pnpm --filter @chainviz/e2e test:e2e`、E2E 本体
    ファイル名 a-b-layer.test.ts / commands.test.ts、collector を
    `packages/collector/dist/index.js` から子プロセス起動、ポート 4123、
    ブリッジサブネット 172.28.0.0/16、稼働中スタック再利用時に `up -d` を
    呼ばない設計)も helpers(collector.ts / docker.ts / paths.ts)・
    compose 定義と突き合わせて一致を確認した。
  - `pnpm lint` / `pnpm build` / `pnpm test` は全て成功。
    `pnpm --filter @chainviz/e2e test` 単体でも catch-up.unit.test.ts の
    14 件のみが実行されることを確認(E2E 本体が混入しない)。
- 決定事項・注意点:
  - 静的レビューとしての差し戻し事項は無し。次は chainviz-qa の再検証へ。
  - コミットはまだ無い(意図どおり)。

