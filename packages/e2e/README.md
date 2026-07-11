# @chainviz/e2e — E2E 結合テスト(プロトコル層 + UI 層)

実 Docker スタック(`profiles/ethereum`)と collector / frontend を実際に
動かして検証する結合テストのパッケージ。2 層で構成する
(`docs/ARCHITECTURE.md` §8)。

| 層           | ランナー             | 対象                                                  | 実装場所           |
| ------------ | -------------------- | ----------------------------------------------------- | ------------------ |
| プロトコル層 | vitest + `ws`        | collector の WebSocket 契約(UI から到達できない検証)  | `src/*.test.ts`    |
| UI 層        | Playwright(chromium) | frontend + collector + 実 Docker をユーザー視点で操作 | `src/ui/*.spec.ts` |

**シナリオの正は `SCENARIOS.md`**(自然言語の箇条書きカタログ)。テスト
コードはこれを実装する。新しい UI 機能を実装するときは SCENARIOS.md に
シナリオを追記してから UI 層テストを実装する(`docs/ARCHITECTURE.md` §8.4)。

## モジュール構成

| ディレクトリ / ファイル                                               | 責務                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `SCENARIOS.md`                                                        | シナリオカタログ(ID・前提/操作/確認。実装状況の凡例つき)                                                |
| `src/*.test.ts`                                                       | プロトコル層テスト(WebSocket 直接検証)                                                                  |
| `src/ui/*.spec.ts`                                                    | UI 層テスト(Playwright)。`test()` タイトルはシナリオ ID と 1 対 1                                       |
| `src/ui/support/`                                                     | UI 層の共通操作ヘルパー                                                                                 |
| `src/helpers/`                                                        | 両層で共有するハーネス(Docker 起動待ち・collector 起動/レジストリ・ホスト単位の排他ロック・globalSetup) |
| `src/helpers/*.unit.test.ts`                                          | ハーネス自体の Docker 非依存ユニットテスト(`pnpm test` 対象)                                            |
| `vitest.config.ts` / `vitest.unit.config.ts` / `playwright.config.ts` | プロトコル層 / ユニット / UI 層それぞれの設定                                                           |

## 実行

```sh
pnpm test:e2e      # プロトコル層(リポジトリルートから。実 Docker 必要・数分)
pnpm test:e2e:ui   # UI 層(同上。要 Playwright chromium)
pnpm --filter @chainviz/e2e test   # Docker 非依存ユニットのみ(pre-push 対象)
```

- **pre-push フックの `pnpm test` には e2e(実 Docker)を含めない**方針
  (実行時間のため)。実行順の推奨はプロトコル層 → UI 層
- Docker スタックは既存のものを再利用し、テスト後も残置する。並行実行は
  ホスト単位の排他ロック(`helpers/e2e-lock.ts`)で防ぐ
- ポート割り当て(collector WebSocket / ロギングプロキシは +1 の組):
  vitest e2e 4123/4124・UI 層 4125/4126・ポート衝突テスト 4199/4200・
  プロキシポート衝突テスト 4210/4211、frontend UI 層 5275。dev 環境
  (4000/4001・5173)と同時に使っても衝突しない。**新しく固定ポートを
  追加する際は +1 が既存ポートと重複しないか確認する**(Issue #254)
- Playwright chromium の導入: `pnpm exec playwright install chromium`
  (システムライブラリが無いホストでは `install-deps` も。
  `docs/CONTRIBUTING.md` 参照)

## 関連ドキュメント

- 二層の責務分担・起動トポロジ・シナリオ記法・計装方針:
  `docs/ARCHITECTURE.md` §8
- 検証対象のプロトコル: `docs/ARCHITECTURE.md` §3
