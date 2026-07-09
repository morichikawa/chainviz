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

