# Issue #64 作業記録

### 2026-07-04 Issue #64 E2Eポート衝突修正のQA検証(qa)

- 担当: qa
- ブランチ: issue-64-e2e-port-collision
- 内容: `ps aux | grep vitest`で他worktreeの同時実行が無いことを確認した
  うえで、実際に2つのターミナルから`pnpm test:e2e`を同時実行した。1本目は
  ロックを取得し全21テスト成功(約171秒)。2本目はロック取得に失敗し、
  約1秒で明確なエラー(先行実行のPID・ホスト名・開始時刻・ロックパスを
  含む)により即座に失敗した(60秒タイムアウトを待たされない)。1本目
  完了後、ロックファイル(`/tmp/chainviz-test-e2e.lock`)が正しく削除
  されていることを確認した。
- 決定事項・注意点: `pnpm lint`/`pnpm build`/`pnpm test`(collector 330・
  frontend 301・e2eユニット34)も全通過。`docs/CONTRIBUTING.md`の記述は
  実装と一致。差し戻しなし。

### 2026-07-04 Issue #64 レビュー指摘4点の対応確認(reviewer 再レビュー)

- 担当: reviewer
- ブランチ: issue-64-e2e-port-collision
- 内容: 前回レビューの推奨4点への collector 担当の対応を静的に再確認した。
  結果は合格。
  - `collector.ts` の `waitForOwnProcessToListen` が `"exit"` から
    `"close"` に変更されている(登録・解除とも)ことを確認。stdio flush
    保証の理由コメントも適切。`stop()` 側の `"exit"` 監視は stdio に
    依存しない後片付け用途なのでそのままで問題なし。
  - `e2e-lock.ts` に `formatStaleRetryExhaustedError` が追加され、stale
    回収リトライ上限到達時にこちらを投げるようになった(解析不能経路の
    `formatUnparsableLockError` と文言が区別される)。ユニットテストで
    「解析できませんでした」を含まないことまで検証されている。
  - `e2e-lock.unit.test.ts` のテスト名 typo(「フィールード」)が修正済み。
  - `docs/WORKLOG.md` の #64 実装記録が「新しいものが上」の並びに従って
    冒頭側へ移動済み。
  - `pnpm lint` / `pnpm build` / `pnpm test`(shared 2・collector 330・
    frontend 301・e2e ユニット 34)の全通過を確認した。
- 決定事項・注意点:
  - `pnpm test:e2e` の実機実行(ポート衝突の同時実行再現)は未実施。
    chainviz-qa の実機検証に引き継ぐ。
  - 未コミットのまま。コミット時は前回指摘どおり関心事ごとの分割を守ること。

### 2026-07-04 Issue #64 test:e2e同時実行対策のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-64-e2e-port-collision
- 内容: collector担当によるIssue #64対応(起動判定の実ログベース化・
  ホスト単位排他ロック・回帰テスト・CONTRIBUTING.md更新)を静的レビュー
  した。結果は合格(軽微な推奨事項あり、下記)。
  - `detectLaunchStatus` の判定文字列が collector 本体の実ログと一致する
    ことを確認した(`packages/collector/src/index.ts` の
    `[collector] WebSocket server listening on port <port>` と
    `[collector] fatal:`。EADDRINUSE は `CollectorServer.listen` の
    reject が `main().catch` に伝播して stderr に出る経路を確認)。
  - 回帰テスト `collector-port-collision.test.ts` は旧実装(`canConnect`)
    だと2つ目の `startCollector` が先発collectorへの接続成功で誤って
    resolve し `rejects.toThrow` が失敗する構造であり、「修正前のバグを
    実際に検出できるテスト」という報告と整合する(実装の詳細をなぞる
    だけの無意味なテストではない)。
  - `e2e-lock.ts` のエラー握りつぶし箇所(unlink競合・readIfExists)は
    いずれも理由コメント付きで安全側に倒しており問題なし。stale回収の
    稀な競合が残る点は本人がWORKLOGに明記済みで許容範囲と判断。
  - `pnpm lint` / `pnpm build` / `pnpm test`(collector 330・frontend 301・
    e2eユニット33)の全通過を確認した。`packages/shared` の変更は無し。
    境界侵犯・チェーン固有語彙の漏れも無し。CONTRIBUTING.md の記述は
    実装と一致。
- 決定事項・注意点(コミット前の推奨対応):
  - `collector.ts` の `waitForOwnProcessToListen` が `exit` イベントで
    判定しているが、Node の `exit` は stdio の flush 完了を保証しない
    ため、稀に EADDRINUSE の stderr 到着前に `crashed`(ログ不完全)と
    誤判定し、回帰テストの `/EADDRINUSE|同時に複数実行/` 照合が flake
    する可能性がある。`close` イベント(stdio クローズ後に発火)への
    変更を推奨。
  - `e2e-lock.ts` の stale 回収リトライ上限到達時に
    `formatUnparsableLockError`(「解析できませんでした」)を投げるが、
    この経路は解析はできている(競合が続いた)ため文言が実態と合わない。
  - `e2e-lock.unit.test.ts` のテスト名 typo(「フィールード」)。
  - #64 の実装記録がWORKLOG末尾に追記されているが、直近の記録は
    新しいものを上に置く並びになっているため、冒頭側への移動を推奨。
  - 未コミットのため、コミット時は関心事ごとの分割(起動判定+回帰
    テスト / 排他ロック+globalSetup配線+ユニットテスト / docs)を守る
    こと。
  - `pnpm test:e2e` の実機実行は行っていない(chainviz-qa の担当)。

### 2026-07-04 Issue #64 test:e2e 複数worktree同時実行時のcollectorポート奪い合い対策(collector)

- 担当: collector
- ブランチ: issue-64-e2e-port-collision
- 内容:
  - `packages/e2e/src/helpers/collector.ts` の `startCollector` を、
    「ポートに接続できるか」ではなく「自分が起動した子プロセス自身が
    実際にそのポートを listen したか」で起動成功を判定する方式に変更した。
    判定ロジックは純粋関数として `packages/e2e/src/helpers/
    collector-launch.ts` に分離し(`detectLaunchStatus` / `portInUseMessage` /
    `crashedMessage`)、子プロセスの標準出力・標準エラーの蓄積ログに
    `[collector] WebSocket server listening on port <port>` が出れば
    `listening`、`EADDRINUSE` を含めば `portInUse`、それ以外で終了して
    いれば `crashed` と判定する。`portInUse` はポーリングでタイムアウトを
    待たせず即座に明確なエラー(別プロセスとの同時実行の可能性を明記)で
    失敗させる。旧実装が使っていた WebSocket 接続確認(`canConnect`)は
    削除した(別プロセスが同じポートで listen 済みだと、自分の子プロセスが
    EADDRINUSE で即死していても誤って「起動できた」と判定してしまう根本
    原因だったため)。
  - ホスト単位の排他ロックを追加した(`packages/e2e/src/helpers/
    e2e-lock.ts`)。`os.tmpdir()` 配下の固定パス
    (`chainviz-test-e2e.lock`。worktree ごとに異なるリポジトリ絶対パスに
    依存せず、同一ホスト・同一ユーザーであれば worktree をまたいで共有
    される)にロックファイルを作り、PID・ホスト名・取得時刻を記録する。
    既に他プロセスが保持しており、かつそのプロセスが生きていれば
    (`process.kill(pid, 0)` で確認)、PID・ホスト名・開始時刻を含む明確な
    エラーで即座に失敗する。保持プロセスが既に死んでいる(stale)場合は
    安全とみなして削除のうえ取得し直す。この排他ロックは `vitest` の
    `globalSetup`(`packages/e2e/src/helpers/global-setup.ts`。
    `vitest.config.ts` に配線)経由で `test:e2e` 実行全体(全テストファイル
    共通)に対して1回だけ取得・解放する。collector 起動判定の修正だけでは
    「2つの test:e2e が同時に docker compose スタックを操作し合う」問題
    までは防げないため、実行そのものを先着1本に制限する狙い。
  - `docs/CONTRIBUTING.md` の「test:e2eは同時に複数実行しない」という
    注意書きを、実装した排他ロックの挙動(先着が勝ち、後着は明確なエラーで
    即座に失敗する。stale ロックの自動回収)に合わせて更新した。
  - 回帰テスト `packages/e2e/src/collector-port-collision.test.ts` を
    追加した。実際に同じポートへ collector を2つ起動させ、2つ目が
    `EADDRINUSE` 系のエラーで(30秒のタイムアウトを待たず)数百ms程度で
    即座に失敗すること、1つ目の起動には影響しないことを確認する。
    このテストが実際に元の不具合を検出できることを、修正前のコード
    (`canConnect` ベース)に一時的に戻して実行し、2つ目の `startCollector`
    が誤って `resolve` してしまう(＝バグの再現)ことを確認したうえで、
    修正後のコードに戻して再度パスすることを確認済み。
  - 上記2ファイルの純粋ロジック部分(`collector-launch.ts` /
    `e2e-lock.ts`)にはそれぞれ `*.unit.test.ts` を追加し、`pnpm test`
    (docker 不要)で高速に検証できるようにした。実 fs を使うロックの
    テストは一意の一時ディレクトリを使い、実行中の本物のロックパス
    (`os.tmpdir()` 固定パス)には触れないようにしている。
- 動作確認:
  - `pnpm build` / `pnpm --filter @chainviz/e2e build`(tsc --noEmit)/
    `pnpm test`(collector・e2eの新規ユニットテストを含め全て成功)を確認。
  - 実際に2つの `pnpm test:e2e` を同時実行し、1本目は通常どおり
    (実docker chain + 実collectorで)全20テスト成功、2本目は
    globalSetup 内のロック取得で0.6秒程度で失敗し、1本目のPID・ホスト名・
    開始時刻を含むエラーメッセージが出ることを確認した。1本目終了後は
    ロックファイルが自動的に削除されていることも確認した。
  - 検証は実行前に `ps aux | grep vitest` で他の vitest プロセスが動いて
    いないことを確認してから行った。
- 決定事項・注意点:
  - `packages/shared` の型変更は不要だった。
  - ロックファイルのパスはリポジトリ内ではなく `os.tmpdir()` の固定名に
    した。worktree ごとに `repoRoot` が異なるため、リポジトリ内パスだと
    worktree をまたいだ排他ができない。同一ホスト・同一ユーザーの前提が
    崩れる環境(例: 各 worktree が別コンテナ/別ホストで動く CI)では
    このロックは機能しない点に注意(現状の運用ではホスト共有が前提)。
  - stale ロックの自動回収は「同時に2プロセスが同時に stale と判断し
    削除→再作成し合う」極めて稀な競合を完全には排除していない(通常の
    開発ワークフローでは許容範囲と判断した)。
  - このIssueは Issue #58 のレビュー中に発覚した不具合で、docs/PLAN.md の
    既存チェックボックスには対応しない(Issue #63 と同様の扱い)。そのため
    PLAN.md の変更は行っていない。
  - コミット・push・PR作成は行っていない(統括の指示により、
    chainviz-reviewer・chainviz-qa を経てからまとめて実施する)。
