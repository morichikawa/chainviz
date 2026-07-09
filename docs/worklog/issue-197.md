### 2026-07-09 Issue #197 Playwright基盤の導入(設計メモ)

- 担当: collector
- ブランチ: issue-197-playwright-foundation

#### 設計メモ(着手前)

`docs/ARCHITECTURE.md` §8.2・§8.3・§8.6 の設計どおりに実装する。要点:

- **既存ヘルパーの再利用**: `packages/e2e/src/helpers/docker.ts`
  (`ensureChainRunning`)・`helpers/collector.ts`(`startCollector`)・
  `helpers/e2e-lock.ts`(`acquireE2eLock`)は、既存のプロトコル層 E2E
  (`helpers/global-setup.ts`・`helpers/harness.ts`)が使っているものと
  完全に同じものを使う。UI 層専用に新しいロジックを増やさない
  (ロジック自体は既存実装のままなので新規ユニットテストは不要。
  Playwright 用に新規追加するのは「既存ヘルパーの呼び出し方の配線」の
  みで、CLAUDE.mdの「新規ロジックがあればテストを書く」の対象外)
- **globalSetup/globalTeardownの実装方針**: Playwright は `globalSetup`
  が返した関数を「グローバルティアダウン」として扱う仕様がある
  (`playwright/lib/runner/index.js` の `createGlobalSetupTask` 実装で
  確認済み。`typeof globalSetupResult === "function"` なら実行後に
  呼ばれる)。これを使い、`playwright-global-setup.ts` 1ファイルに
  setup/teardownをまとめる。理由: teardown を別ファイル
  (`playwright.config.ts` の `globalTeardown` オプション)にすると、
  起動した `RunningCollector`(子プロセスの参照)を setup 側から
  teardown 側へ渡すために PID ファイル等の状態受け渡しが別途必要になる。
  Playwright の globalSetup/globalTeardown は同一 Node プロセス内で
  順に呼ばれるため、クロージャで直接 `RunningCollector.stop()` を
  呼べる1ファイル構成の方がシンプルで、実質的な処理内容
  (ロック取得 → Docker起動確認 → collector起動 → (テスト実行) →
  collector停止 → ロック解放)は ARCHITECTURE.md §8.3 の起動トポロジ図と
  完全に一致する
- **ポート**: UI 層専用に collector 4125 / frontend(vite dev) 5275 を
  新規に使う(既存の dev 4000/5173、vitest e2e 4123、ポート衝突テスト
  4199 と衝突しない。§8.3 に明記された値をそのまま使う)
- **webServer**: `vite dev --port 5275` を `cwd: repoRoot` から
  `pnpm --filter @chainviz/frontend exec vite --port 5275` で起動する
  (`scripts/dev-up.sh` の frontend 起動コマンドと同じパターン)。
  `env` に `VITE_COLLECTOR_URL=ws://127.0.0.1:4125` を渡す。
  `reuseExistingServer: false` にして、既存の別プロセスの vite dev を
  誤って使い回さないようにする(stale な `VITE_COLLECTOR_URL` を掴む
  事故を避ける)
- **実行順序の注意**: Playwright は内部的に webServer の起動(プラグイン
  として登録される)を globalSetup より先に実行する
  (`createGlobalSetupTasks` の実装順序で確認)。そのため vite dev は
  Docker/collector の起動確認より先に立ち上がる。ただし vite dev 自体は
  collector の起動有無に依存せず起動できる(WebSocket 接続はブラウザが
  ページを開いた時点で試みるため、その時点では globalSetup が完了して
  collector が起動済み)。挙動に問題は無いが、ARCHITECTURE.md の起動
  トポロジ図(webServer が globalSetup の後に書かれている)は概念的な
  データフローの説明であり、Playwright の内部実行順序そのものの記述では
  ないと解釈する
- **workers**: `workers: 1` を明示する。実 Docker スタック・単一の
  collector/vite dev を全テストで共有するため、vitest 側の
  `fileParallelism: false` と同じ考え方で直列実行にする(将来 #199 以降で
  addNode/removeNode 等の状態変更を伴うシナリオが増えたときに並列実行
  由来のフレーキーさを避けるため)
- **testDir/testMatch**: `testDir: "./src/ui"` とし、vitest の
  `include: ["src/**/*.test.ts"]`(プロトコル層)・
  `include: ["src/**/*.unit.test.ts"]`(ユニット)とファイル名パターンも
  ディレクトリも重ならないようにする(UI 層は `src/ui/*.spec.ts`)
- **疎通確認用スペック**: 実シナリオ(#199 以降)実装前に基盤だけを
  確認するための最小スペックを1本だけ `src/ui/foundation-smoke.spec.ts`
  に置く。SCENARIOS.md の正式シナリオID(`UI-CONN-01` 等)は #198(接続
  ステータスバッジの `data-testid` 計装)以降で対応するため、このスペックは
  現時点で計装済みの CSS クラス(`status-badge--connected`)を見るに留め、
  正式シナリオの代わりにはしない(#199 実装時にこのファイルは削除して
  よい)

#### 実施内容

- `packages/e2e/playwright.config.ts` を新規作成。`testDir: "./src/ui"` /
  `testMatch: "**/*.spec.ts"` で vitest 側(`src/**/*.test.ts` /
  `src/**/*.unit.test.ts`)と対象が重ならないようにした。`globalSetup` に
  `src/helpers/playwright-global-setup.ts` を指定し、`webServer` で
  `pnpm --filter @chainviz/frontend exec vite --port 5275`(`cwd: repoRoot`、
  `VITE_COLLECTOR_URL=ws://127.0.0.1:4125`、`reuseExistingServer: false`)を
  起動する。`workers: 1` / `fullyParallel: false` で直列実行にした
- `packages/e2e/src/helpers/playwright-global-setup.ts` を新規作成。
  設計メモどおり、既存の `acquireE2eLock` / `ensureChainRunning` /
  `startCollector(4125)` を呼び出し、返した非同期関数を Playwright の
  グローバルティアダウンとして使う(collector 停止 → ロック解放)
- `packages/e2e/src/ui/foundation-smoke.spec.ts` を新規作成。frontend を
  開いてタイトルと接続ステータス(`.status-badge--connected`)を確認する
  最小限の疎通確認テスト
- `packages/e2e/package.json` に `test:e2e:ui: "playwright test"` を追加し、
  ルート `package.json` にも `test:e2e:ui` を配線した
- `packages/e2e/tsconfig.json` の `include` に `playwright.config.ts` と
  `vitest.unit.config.ts`(既存だが漏れていた)を追加し、`pnpm build`
  (`tsc --noEmit`)で設定ファイル自体も型チェック対象になるようにした
- `.gitignore` に `playwright-report/` / `test-results/`(Playwright の
  実行成果物)を追加した
- `docs/CONTRIBUTING.md` に「UI 層 E2E(Playwright)テスト」節を追加し、
  chromium ブラウザ本体・システムライブラリのインストール手順
  (`playwright install chromium` / `sudo ... install-deps chromium`)と
  UI 層専用ポート(collector 4125 / frontend 5275)を明記した

#### 動作確認

- `pnpm build` / `pnpm lint` / `pnpm test`(全パッケージのユニットテスト)
  が通ることを確認した
- `pnpm test:e2e:ui` を実際に実行し、疎通確認テストが green になることを
  確認した。この開発環境には Playwright chromium 実行に必要なシステム
  ライブラリ(`libnspr4` / `libnss3` / `libasound2` 系)が入っておらず、
  かつ `sudo` がパスワード無しで使えなかったため、`apt-get download` で
  該当パッケージを取得し `dpkg-deb -x` でユーザー権限のまま展開した一時
  ディレクトリを `LD_LIBRARY_PATH` に指定して検証だけを行った(この
  回避策はこのセッションでの動作確認のためだけに使ったものでリポジトリには
  含めていない。通常の開発環境では CONTRIBUTING.md 記載どおり
  `sudo pnpm exec playwright install-deps chromium` を使う)。最初の実行
  ではシステムライブラリ未導入により chromium 起動失敗
  (`libnspr4.so: cannot open shared object file`)を実際に確認し、
  ライブラリを揃えた状態で再実行して green になることの両方を確認した
- 実行順序に関する注意: Playwright は `webServer`(プラグイン扱い)を
  `globalSetup` より先に起動する(`playwright/lib/runner/index.js` の
  `createGlobalSetupTasks` で確認)。そのため vite dev server は
  Docker/collector の起動確認より先に立ち上がるが、実際に WebSocket 接続を
  試みるのはブラウザがページを開いた時点(テスト実行時、globalSetup 完了後)
  なので動作上の問題は無い

#### 次の担当への注意点

- `packages/e2e/src/ui/foundation-smoke.spec.ts` は基盤確認用の暫定テスト。
  #199(基本表示シナリオの実装)で `SCENARIOS.md` の `UI-CONN-01` 等を正式
  実装したら、このファイルは削除してよい
- `UI-CONN-01` 等の正式シナリオは `data-testid` 計装(#198)が前提。#198 が
  終わるまでは `.status-badge` のような CSS クラスでの代替検証に留める
  必要がある
- Playwright の chromium 実行に必要なシステムライブラリが入っていない
  開発機では `pnpm test:e2e:ui` がブラウザ起動失敗で即座に落ちる。
  CONTRIBUTING.md に導入手順を記載済みなので、初回はそちらに従うこと

### テスト強化記録(異常系・境界値の追加)

実装担当は `playwright-global-setup.ts` を「既存ヘルパーの単純な配線で
新規ロジックは無い」としてユニットテスト対象外と判断していたが、実際には
「ロックを取得した後に Docker 起動確認/collector 起動が失敗した場合の
ロック解放(後片付け)」「teardown での停止と解放の順序」という
異常系・順序依存のオーケストレーションロジックが含まれている。ここは
リークやリソース残留に直結するため、テストで固定した。実装ロジックの
変更は行っていない。

- `helpers/playwright-global-setup.unit.test.ts`(新規, 6件):
  - 正常系: ロック取得 → Docker 起動確認 → collector 起動の実行順序。
  - 境界値: UI 層専用ポート 4125 が `startCollector` に渡ること
    (既存の dev 4000 / vitest e2e 4123 / ポート衝突テスト 4199 と
    衝突しない固定値。定数値そのものも固定)。
  - teardown の後片付け順序が「collector 停止 → ロック解放」であること
    (ロックを解放する前に collector を確実に止める)。setup 完了時点では
    まだ後片付けが走っていないことも確認。
  - 異常系: ロック取得失敗時は同じエラーを伝播し、Docker/collector に
    進まず、ロックパスを含む原因の分かるメッセージをログに出すこと。
  - 異常系: Docker 起動確認の失敗時に、取得済みロックを解放してから
    エラーを伝播し、collector 起動に進まないこと(ロックリーク防止)。
  - 異常系: collector 起動の失敗時に、取得済みロックを解放してから
    エラーを伝播すること。
  - このファイルは本パッケージの他ユニットテスト(依存注入・純粋関数で
    書かれ vi.mock 不使用)と異なり、`vi.mock` で依存 3 ヘルパーを
    差し替えている。`globalSetup` は Playwright の仕様上引数無しで
    呼ばれ依存注入の口が無いため、実装を変えずに配線ロジックだけを
    検証する目的で例外的に採用した(理由をファイル冒頭コメントに明記)。
  - 回帰検出の確認: teardown の順序を意図的に反転(release → stop)させると
    順序テストが失敗すること、元に戻すと通ることを実際に確認した。
- `ui/foundation-smoke.spec.ts` は UI 層 E2E のためユニットテスト強化の
  対象外。#199 での削除方針・data-testid(#198)前提の暫定検証である旨が
  ファイル先頭に明記されており、引き継ぎ状態として問題なし。参照している
  `.status-badge` / `status-badge--connected` は frontend 側
  (`styles.css` / `App.tsx`)に実在することを確認済み。
- 確認コマンド: `pnpm --filter @chainviz/e2e test`(5 test files /
  50 tests、全通過)、`pnpm --filter @chainviz/e2e build`(`tsc --noEmit`)。
- 実装バグらしきものは検出されなかった。ロック解放の順序・失敗時の
  クリーンアップはいずれも設計どおりに動作している。

### レビュー記録(chainviz-reviewer)

- 判定: **合格**
- 確認内容:
  - ARCHITECTURE.md §8.2/§8.3/§8.6 との整合: パッケージ構成(`playwright.config.ts`・
    `src/ui/*.spec.ts`・helpers 共有)、起動トポロジ(acquireE2eLock →
    ensureChainRunning → startCollector(4125) → webServer vite dev 5275 →
    teardown で collector 停止 → ロック解放、Docker スタック残置)、
    ポート割り当て(4125/5275)がすべて設計どおり
  - 既存ヘルパーの再利用: `e2e-lock.ts` / `docker.ts` / `collector.ts` を
    変更なしにそのまま使っており、UI 層専用の重複ロジックは無い。
    `startCollector(port)` のシグネチャとも一致
  - エラー処理: ロック取得失敗時はロックパス入りのログを出して元の
    エラーを伝播、Docker/collector 起動失敗時は取得済みロックを解放して
    から伝播。握りつぶし箇所なし
  - `vi.mock` の例外的採用: Playwright の globalSetup が引数無しで呼ばれる
    仕様上、依存注入の口が無いことが理由としてファイル冒頭に明記されて
    おり妥当。テストは実行順序・異常系3種・teardown 順序をカバーし、
    回帰検出能力も worklog 記載のとおり確認済み
  - タイムアウト定数(webServer 30s / テスト 60s / 接続バッジ 30s)は
    いずれも「起動待ちの上限」であり、チェーンの稼働時間・進行済み
    ブロック数に依存する値ではない(過去の固定120秒問題とは性質が異なる)
  - `pnpm build` / `pnpm lint` / `pnpm test`(e2e パッケージのユニット
    50件含む)がすべて通ることを確認
  - docs 整合: PLAN.md チェック+Issue リンク、WORKLOG.md 索引行、
    CONTRIBUTING.md の前提記載、いずれも実装と一致
  - コミット粒度: 5コミットとも単一関心事で適切
- 軽微な指摘(差し戻し不要):
  - teardown 内で `collector.stop()` が例外を投げると `lock.release()` が
    スキップされるが、プロセス終了後は e2e-lock の stale ロック回収
    (保持 PID の死亡判定)で自己修復されるため実害なし
  - c6c9022 の tsconfig.json 変更に既存の漏れ(`vitest.unit.config.ts` の
    include 追加)の修正が同居しているが、worklog に明記されており許容範囲
