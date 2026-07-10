### 2026-07-11 Issue #254 dev collector稼働中はpnpm test:e2eが起動不能(proxyポート衝突がlisten判定をすり抜ける)

- 担当: collector
- ブランチ: issue-254-e2e-port-collision-guard
- 参照: Issue #229 の調査（`docs/worklog/issue-229.md`）で発見された副次的な事実

#### 設計メモ（着手前）

**再現手順と実測結果**（修正前のコードで確認済み）:

dev collector（`/home/zoe/workspace/chainviz` 上で稼働中、
`CHAINVIZ_PROXY_PORT` 未指定でポート 4001 を専有）がある状態で、
`packages/e2e/src/helpers/collector.ts` の `startCollector(4222)` を
実行したところ、以下のログが得られた。

```
startCollector resolved after 1454ms 4222
child exitCode after wait: 1
logs:
 [collector] WebSocket server listening on port 4222
[collector] fatal: Error: listen EADDRINUSE: address already in use 0.0.0.0:4001
```

`startCollector` は「起動成功」として resolve したにもかかわらず、直後に
子プロセスが exitCode 1 で終了していた。呼び出し元は生きていない
collector を「起動済み」として受け取ってしまう。

**根本原因**:

1. `packages/collector/src/index.ts` の `main()` は
   `await server.listen(port)` （WebSocket、既定 4000）の直後にログを出し、
   その後で `await startLoggingProxy(resolveProxyPort(), ...)`
   （ロギングプロキシ、既定 4001）を起動する。2 つの独立した TCP listen が
   順番に行われる。
2. `packages/e2e/src/helpers/collector.ts` の `startCollector` は
   `CHAINVIZ_COLLECTOR_PORT`（WebSocket ポート）だけを子プロセスへ渡し、
   `CHAINVIZ_PROXY_PORT` を渡さない。そのため子プロセスは常に既定の
   ロギングプロキシポート 4001 を使おうとし、既に別プロセス（dev collector
   や他の e2e 実行）がそのポートを掴んでいると衝突する。
3. `packages/e2e/src/helpers/collector-launch.ts` の
   `detectLaunchStatus` は「WebSocket サーバーの listening ログ」だけを
   根拠に "listening"（起動成功）と判定する。WS の bind はロギング
   プロキシより前に行われ、かつ WS 自体はポートが違う（e2e 側 4222 等）ため
   衝突せず成功する。この時点で `waitForOwnProcessToListen` は
   `settle(resolve)` し、以後のログ監視（`.off("data", check)`）を止めて
   しまう。そのため、直後にロギングプロキシが EADDRINUSE で失敗しても
   検知できず、「起動成功」の判定が確定した後になる。

つまり、「2 つの独立した listen 処理があるのに、判定ロジックは 1 つ目
（WS）の成功だけを見て確定させてしまう」という判定ロジック側の欠陥と、
「子プロセスへ渡すポートが 1 つしかなく、ロギングプロキシ側は常に既定値
に固定される」という起動側の欠陥が組み合わさって発生している。

**対応方針**:

1. `startCollector` に `proxyPort` 引数を追加し、`CHAINVIZ_PROXY_PORT`
   として子プロセスへ明示的に渡す。既定値は `port + 1`
   （本番の WS:4000 / proxy:4001 という「+1」の関係を e2e 側でも踏襲し、
   既存の e2e 専用 WS ポート群（4123 / 4125 / 4199）のいずれとも衝突しない
   4124 / 4126 / 4200 になる）。これにより「dev collector 稼働中に
   test:e2e を動かす」という当初の報告シナリオは解消する。
2. ただし (1) だけでは「2 つの独立した listen 判定ロジックの欠陥」という
   根本原因は残り、別の要因（e2e 側ポートの取り違え、将来 collector に
   3 つ目の listen 処理が増える等）で同種の TOCTOU がまた起こりうる。
   `detectLaunchStatus` を拡張し、WebSocket・ロギングプロキシ両方の
   listening ログが揃って初めて `"listening"` と判定するようにする。
   また EADDRINUSE の検出を「listening 判定より前」に優先させ、
   一部の listen が成功していても、もう一方が失敗していれば
   `"portInUse"` として検知できるようにする。
3. (2) の変更で `DetectLaunchStatusInput` に `proxyPort` フィールドが
   増える（既存の呼び出し元は `collector.ts` の
   `waitForOwnProcessToListen` のみ）。合わせてシグネチャを更新する。
4. 既存の Issue #64 回帰テスト（`collector-port-collision.test.ts`、
   WebSocket ポートの衝突）はそのまま通る設計にする（WS 側の衝突は
   ロギングプロキシの bind に到達する前に検出されるため影響しない）。
5. 新規に「ロギングプロキシ側だけがポート衝突する」ケースの回帰テストを
   実データ（実際に子プロセスを起動）で追加する。

対象ファイル:
- `packages/collector` 側の変更は無し（`resolveProxyPort` 等は既存のまま
  利用できる）
- `packages/e2e/src/helpers/collector.ts`（`startCollector` の
  `proxyPort` 引数・環境変数受け渡し）
- `packages/e2e/src/helpers/collector-launch.ts`（`detectLaunchStatus` の
  判定ロジック拡張）
- `packages/e2e/src/helpers/collector-launch.unit.test.ts`（既存テストの
  シグネチャ更新 + 新規ケース）
- `packages/e2e/src/collector-proxy-port-collision.test.ts`（新規、
  実プロセスでの回帰テスト）

#### 実施内容・確認結果

**修正**:

1. `packages/e2e/src/helpers/collector.ts`: `startCollector(port, proxyPort
   = port + 1)` とし、`CHAINVIZ_PROXY_PORT` を子プロセスへ明示的に渡す
   ようにした。`RunningCollector` に `proxyPort` フィールドを追加。
   `waitForOwnProcessToListen` に `proxyPort` を渡し、両方の listening
   ログが揃うまで判定を確定させないようにした。
2. `packages/e2e/src/helpers/collector-launch.ts`: `DetectLaunchStatusInput`
   に `proxyPort` を追加。`detectLaunchStatus` は EADDRINUSE の検出を
   最優先にし、WebSocket・ロギングプロキシ両方の listening ログが揃って
   初めて `"listening"` と判定するようにした。`portInUseMessage` は
   両方のポート番号を案内するよう更新。
3. `packages/e2e/src/helpers/collector-launch.unit.test.ts`: 上記シグネチャ
   変更に合わせて既存ケースを更新し、「WS のみ listening」「proxy のみ
   listening」「WS listening 後に proxy が EADDRINUSE」の3ケースを新規
   追加した。
4. `packages/e2e/src/helpers/collector-registry.unit.test.ts`:
   `RunningCollector` の型変更に合わせてテストヘルパーへ `proxyPort` を
   追加（ロジック変更ではなく型整合のための追従）。
5. `packages/e2e/src/collector-proxy-port-collision.test.ts`（新規）:
   実際に子プロセスを起動し、ロギングプロキシのポートだけを意図的に
   衝突させて、`startCollector` が即座に明確なエラーで reject することを
   確認する回帰テスト（`collector-port-collision.test.ts`／Issue #64 の
   WebSocket 版に対応するロギングプロキシ版）。

**再現・修正確認の手順と実測**（すべて自分の手で実施）:

1. 修正前のコードで、実際に `/home/zoe/workspace/chainviz`
   （このタスクとは別ディレクトリ、別プロセス）で稼働中の dev collector
   （既定のロギングプロキシポート 4001 を専有）がある状態で、
   `startCollector(4222)` を呼び出した。結果、`startCollector` は
   1454ms で resolve（「起動成功」の判定）したにもかかわらず、直後に
   子プロセスは exitCode 1 で終了していた（ログに
   `[collector] WebSocket server listening on port 4222` の後に
   `[collector] fatal: Error: listen EADDRINUSE: address already in use
   0.0.0.0:4001` が記録されていた）。これは Issue 本文の報告どおりの
   症状であり、実際に再現したことを確認した。
2. 修正後の同条件（dev collector 稼働中のまま）で `startCollector(4223)`
   （既定 `proxyPort=4224`）を呼び出したところ、正常に起動し、2 秒待機後も
   `exitCode` は `null`（生存中）のままであることを確認した。dev collector
   との衝突が解消したことを確認した。
3. 加えて、`detectLaunchStatus` 側の判定ロジックの改善分は環境に依存しない
   形でも検証した。修正前のコードへ一時的に戻し（`git stash` で
   `collector.ts`・`collector-launch.ts` のみを退避）、子プロセスの環境変数
   `CHAINVIZ_PROXY_PORT` を明示的に指定した上で同じポートを先に専有する
   バニラの `http.Server` を用意してから `startCollector` を呼び出した
   ところ、修正前のコードはやはり「resolve するが直後に exitCode 1 で
   終了する」という同じ誤判定を再現した。`git stash pop` で修正を復元後、
   同条件で `packages/e2e/src/collector-proxy-port-collision.test.ts` を
   実行し、`rejects.toThrow(/EADDRINUSE/)` が成立し、かつ 10 秒以内という
   短時間で失敗することを確認した（＝タイムアウト分岐に落ちていない）。

**テスト結果**:

- `pnpm -F @chainviz/e2e build` / `pnpm -F @chainviz/e2e test`
  （vitest.unit.config.ts 側）: 全 6 ファイル・80 テスト green
- `packages/e2e/src/collector-port-collision.test.ts`（Issue #64 回帰）・
  `packages/e2e/src/collector-proxy-port-collision.test.ts`（本 Issue の
  回帰）を実チェーン起動状態で実行し、両方 green
- `packages/e2e/src/error-paths.test.ts`（harness.ts 経由で実際に
  `startCollector()` の既定値を使う既存 E2E テスト）を dev collector
  稼働中のまま実行し、4 テストとも green（従来なら Issue #254 の症状で
  不安定になりうるシナリオ）
- リポジトリ全体の `pnpm build` / `pnpm test` は green
  （collector 1137、frontend 1623、shared 59、e2e 80 テスト、計 全通過）

**次の担当が知っておくべき注意点**:

- `packages/e2e` の各テストファイルが使う collector 用ポートは
  「WebSocket ポート = 固定値、ロギングプロキシポート = 既定で
  `port + 1`」という関係になった。新しく固定 WebSocket ポートを追加する
  場合、その `+1` の値が他のテストファイルの WebSocket ポートと重複
  しないか確認すること（本 Issue 対応時点では 4123/4124、4125/4126、
  4199/4200、4210/4211 が使用中で重複なし）。
- `detectLaunchStatus` は今後 collector に 3 つ目の独立した listen 処理が
  増えた場合、そのままでは検知できない（2 つの listening ログの一致だけを
  見る設計のため）。増える場合はこの判定ロジックも合わせて拡張が必要。

#### テスト強化（2026-07-11・テスト担当）

- 担当: tester
- 対象: `packages/e2e/src/helpers/collector-launch.unit.test.ts`
  （純粋ロジック `detectLaunchStatus` のユニットテスト。`pnpm test` /
  `vitest.unit.config.ts` 側で回り Docker 不要）

実装担当が追加した基本ケース（ハッピーパス・片側 listening・後発
EADDRINUSE）に対し、異常系・境界値を補強した。追加した観点は以下:

1. WS・ロギングプロキシ両方が同時に EADDRINUSE で終了したケース。
2. ロギングプロキシ側の EADDRINUSE が WS の listening ログより先に
   現れるケース（ログ出現順に依存せず、どちらのエラーが先に検出されても
   portInUse になることを固定）。
3. 両方の listening ログが揃っていてもログに EADDRINUSE が混在する場合、
   安全側に portInUse を優先する（EADDRINUSE 最優先の設計を明示的に固定。
   この優先順位を崩す変異を入れると本テストが落ちることをミューテーション
   で確認済み）。
4. ロギングプロキシ側が EADDRINUSE 以外の理由（EACCES = 権限エラー）で
   失敗して終了した場合、portInUse には該当させず crashed として扱い、
   終了コードを保持すること。あわせて `crashedMessage` に EACCES の原因
   ログが失われず含まれること（握りつぶさない）を確認。
5. シグナルで kill され exitCode が null のまま終了したケース
   （crashed の exitCode が null で伝わる境界）。
6. 片側だけ listening でプロセスが生存し続ける間は pending を返し続ける
   こと（誤って listening を確定させず、`waitForOwnProcessToListen` 側の
   有限タイムアウトに打ち切りを委ねる＝ハングしない）。
7. 既定 `proxyPort = port + 1` により WS/プロキシのポート番号が隣接する
   境界で、"WebSocket server" / "logging proxy" の接頭辞差により数値の
   部分一致で listening ログを取り違えないこと。

補足:

- 「WS 側と proxy 側が同時に衝突する」実プロセス版の検証は、WS が先に
  bind して即座に EADDRINUSE で失敗する経路になり、既存の
  `collector-port-collision.test.ts`（Issue #64、WS 衝突）でカバー済みの
  経路と同一のため、実プロセス統合テストは追加せず純粋ロジック側で
  順序非依存性を固定する方針とした。
- 実装ロジックの変更は行っていない（テスト追加のみ）。既存 80 テスト・
  今回追加分を含め `pnpm -F @chainviz/e2e build` / `pnpm -F @chainviz/e2e
  test` は全 88 テスト green。

#### レビュー（2026-07-11・レビュー担当）

- 判定: **差し戻し（軽微・1点のみ）**。実装・テスト・コミット粒度は
  すべて問題なし。docs の追従漏れ1件のみ対応が必要。

確認した内容と結果:

1. **根本原因への対処**: 「`CHAINVIZ_PROXY_PORT` を子プロセスへ渡す」
   （起動側の欠陥）と「`detectLaunchStatus` が WS・ロギングプロキシ両方の
   listening ログが揃うまで確定しない + EADDRINUSE 検出最優先」（判定
   ロジック側の欠陥）の両方を修正しており、既定値の変更だけの表面的な
   回避になっていない。判定が依拠するログ文字列
   （`WebSocket server listening on port` / `logging proxy listening on
   port`）が `packages/collector/src/index.ts` の実際の出力と一致する
   ことも確認した。
2. **Issue #64 対応の非破壊**: WS 側の衝突は WS の bind 時点で EADDRINUSE
   になり最優先で検出されるため影響なし。実プロセス回帰テスト
   `collector-port-collision.test.ts` を dev collector 稼働中に実行し
   green を確認。
3. **`proxyPort = port + 1` の前提の明記**: `collector.ts` のコメントと
   本 worklog の両方に「本番の 4000/4001 の +1 関係の踏襲」「既存 e2e 用
   WS ポート群と重複しない」ことが明記されている（CLAUDE.md の固定値
   ルールを満たす）。現時点の使用ポート対（4123/4124、4125/4126、
   4199/4200、4210/4211）に重複がないことも確認した。
4. **`collector-registry.unit.test.ts` の追従**: `RunningCollector` の
   型変更に合わせたテストヘルパーへのフィールド追加のみで妥当。受け渡し
   ファイル（handoff）自体は pid/port のみを永続化しており `proxyPort` は
   不要（WS 接続と生存確認にしか使わないため）であることを確認した。
5. **ビルド・lint・テスト**: リポジトリ全体の `pnpm build` / `pnpm lint` /
   `pnpm test` すべて green（shared 59 / collector 1137 / frontend 1623 /
   e2e 88）。さらに dev collector が実際に 4000/4001 を専有している状態
   （ss で実測確認）で、実プロセス系の
   `collector-port-collision.test.ts`・
   `collector-proxy-port-collision.test.ts`・`error-paths.test.ts`
   （既定ポートの `startCollector()` を使う経路）を実行し、全 green。
   Issue 本文の状況下でテストが完走することを確認した。
6. **コミット粒度**: fix（実装+対応テスト）/ docs / test 強化 / docs の
   4 コミットに分かれており、Conventional Commits 準拠。問題なし。
7. **テストコードの質**: EADDRINUSE 最優先・順序非依存・EACCES を
   portInUse に誤分類しない・シグナル終了（exitCode null）・pending 維持
   など異常系/境界値がカバーされており、ミューテーション確認の記録もある。
   良好。

指摘事項（要対応・軽微）:

- **`docs/ARCHITECTURE.md` のポート割り当て記述の追従漏れ**。
  「ポート割り当て: collector は dev 4000 / vitest e2e 4123 /
  ポート衝突テスト 4199 / UI 層 4125」の一覧（8.3節付近）に、本 Issue で
  導入した「e2e の各 collector はロギングプロキシに WS ポート +1 を使う」
  という規約と、新規テストの 4210/4211 が反映されていない。先例として
  Issue #64 のとき 4199 はこの一覧に追記されている。「新しく WS ポートを
  足すときは既存ポートの +1 と重複しないか確認する」という注意点は
  現状この worklog にしか無く、恒久ドキュメントである ARCHITECTURE.md の
  ポート一覧に規約として1〜2行追記すること（CLAUDE.md の sync-docs
  ルール）。

軽微な所見（対応不要・記録のみ）:

- `collector-launch.unit.test.ts` に「WS のみ listening → pending」を
  検証するテストが3件（実装担当分1件・テスト強化分2件。入力が完全に同一で
  意図の説明だけが異なる）ある。挙動固定としては無害だが、今後この
  ファイルを整理する際は統合を検討してよい。
- `portInUseMessage` の「CHAINVIZ_PROXY_PORT 等でポートを変えてから
  再実行してください」という文言は、e2e の子プロセスは環境変数ではなく
  引数で明示指定される（シェルで CHAINVIZ_PROXY_PORT を設定しても e2e 側
  には効かない）ため、「衝突相手の dev collector 側のポートを変える」
  意味にしか取れない。誤読の余地はあるが実害は小さい。
