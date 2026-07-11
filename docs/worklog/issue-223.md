# Issue #223 パッケージごとのREADME(設計情報)整備

### 2026-07-11 Issue #223 パッケージごとにREADME(設計情報)を用意し、タスクのたびに更新する運用にしたい

- 担当: designer
- ブランチ: issue-223-package-readmes
- 内容:
  - `packages/shared`・`packages/collector`・`packages/frontend`・
    `packages/e2e` に README.md を新設した。共通の見出し構成は
    「役割と境界 / モジュール構成(ディレクトリ単位の責務テーブル) /
    実行・テスト / 関連ドキュメント」。`profiles/ethereum/README.md` は
    既に存在し役割・境界・使い方を十分に説明していたため変更していない
    (テンプレートへの機械的な合わせ込みはしない。中身が目的を満たして
    いるかで判断する)
  - `docs/ARCHITECTURE.md` §1 にあった各パッケージ内部の `src/` ツリー
    (モジュール一覧)を削除し、各パッケージ README への参照に置き換えた。
    あわせて「ドキュメントの役割分担」(CONCEPT = なぜ / ARCHITECTURE =
    パッケージ間の契約と横断的な設計判断 / パッケージ README = 各
    パッケージの現在地 / worklog = 経緯)を §1 に明文化した
  - ルート `README.md` を現状に合わせて書き直した(「現在は構想段階」の
    記述が実態と乖離していた)。クイックスタート(`pnpm dev:up`)・
    パッケージ一覧(各 README へのリンク)・ドキュメントマップを載せた
- 決定事項・注意点:
  - **モジュール構成(ディレクトリ単位の責務一覧)の正は各パッケージ
    README とし、`docs/ARCHITECTURE.md` §1 には重複して書かない**。
    根拠: 着手時点で §1 の旧記載は既に実装と乖離していた(frontend の
    `operations/` ディレクトリが未記載、collector に実在しない
    `adapters/chain-adapter.ts` を記載)。コードから遠い場所に詳細を
    重複して置くと乖離は避けられないため、詳細はコードに最も近い
    README に一本化し、ARCHITECTURE はパッケージ間の契約(スキーマ・
    プロトコル・チェーンプロファイル 3 点セット・E2E 構成)に専念する
  - README には**設計判断の経緯・Issue 番号の羅列を持ち込まない**
    (それは worklog と ARCHITECTURE の役割)。README は「今どうなって
    いるか」だけを書き、詳細は該当ドキュメントへのポインタで済ませる。
    これにより README の更新は「実態と食い違った行を直す」だけの
    軽い作業になり、「タスクのたびに更新する」運用が現実的になる
  - README の記述粒度は**ディレクトリ単位**に留める(ファイル単位まで
    書くと更新頻度が上がりすぎて運用が破綻する)。ディレクトリの
    新設・廃止・責務変更があったときに更新が必要になる
  - ルート README のクイックスタートは `pnpm dev:up`
    (`scripts/dev-up.sh`)を正とした。個別起動の手順は各パッケージ
    README に分散して持たせている

## CLAUDE.md への運用ルール明文化の提案(統括向け)

CLAUDE.md の編集権限は統括にあるため、ここでは提案文言のみ残す。
「開発ルール」セクションの箇条書きに以下を追加することを提案する:

> - パッケージごとの `README.md`(`packages/*/README.md`・
>   `profiles/*/README.md`・ルート `README.md`)は「今そのパッケージが
>   どうなっているか」(役割・境界・モジュール構成・実行方法)の現在地を
>   示すドキュメント。タスク完了時に、変更が影響するパッケージの README
>   が実態と食い違っていないかを確認し、古くなっていれば同じ変更の中で
>   更新する(sync-docs スキルでの齟齬確認の対象にも含める)。特に
>   ディレクトリの新設・廃止・責務変更、ポート・環境変数・起動手順の
>   変更は README 更新が必要になりやすい。経緯の記録は従来どおり
>   `docs/worklog/`、パッケージ間の契約は `docs/ARCHITECTURE.md` の
>   役割であり、README には持ち込まない。各パッケージ内部のモジュール
>   構成(ディレクトリ単位の責務一覧)は各パッケージ README を正とし、
>   `docs/ARCHITECTURE.md` §1 には重複して書かない(Issue #223)

補足の提案(任意): `chainviz-reviewer` の確認項目に「変更が影響する
パッケージの README が更新されているか(実態と食い違う記述が残って
いないか)」を追加すると、運用ルールが品質ゲートとして機能する。

### 2026-07-11 レビュー(chainviz-reviewer)

- 担当: reviewer
- 判定: **差し戻し(軽微2件)**。修正後の再レビューは差分確認のみでよい
- 確認した内容:
  - 4つの新設README(shared/collector/frontend/e2e)のモジュール構成
    テーブルを実際の`src/`ディレクトリ一覧と突き合わせ、全ディレクトリが
    過不足なく記載されていることを確認した
  - 記載された依存関係(各package.jsonのdependencies)・ポート
    (collector 4000/4001、frontend 5173、e2e 4123/4125/4199/4210/4211/
    5275)・スクリプト名(`pnpm dev:up`・`test:e2e`・`test:e2e:ui`・
    `--filter`各コマンド)・`0.0.0.0` bindの記述を、コード・設定ファイル
    の実物と照合し一致を確認した
  - `docs/ARCHITECTURE.md` §1の置き換え(内部ツリー削除→README参照+
    役割分担の明文化)が旧記載の実装乖離(`operations/`未記載・実在しない
    `adapters/chain-adapter.ts`)を正しく解消していることを確認した
  - 変更が.mdファイルのみ(コード変更なし)であること、コミットが3件とも
    Conventional Commits準拠で関心事ごとに分かれていることを確認した
  - `pnpm lint && pnpm build && pnpm test` がリポジトリ全体で通ることを
    確認した
  - CLAUDE.mdへの運用ルール追加の提案文言は、README/worklog/
    ARCHITECTUREの役割分担が明確で、更新が必要になる典型条件(ディレクトリ
    の新設・廃止・責務変更、ポート・環境変数・起動手順の変更)まで具体化
    されており、提案の質として妥当と評価する(採否は統括の判断)
- 差し戻しの指摘(いずれも「READMEを実態の正とする」という本Issueの
  目的に直結する記載漏れ・残存乖離のため、軽微だが修正を求める):
  1. `packages/collector/README.md` の「主な環境変数」に
     `CHAINVIZ_COLLECTOR_PORT` が漏れている。collectorが読む環境変数を
     全数確認したところ `CHAINVIZ_COLLECTOR_PORT` / `CHAINVIZ_PROXY_PORT` /
     `CHAINVIZ_PROXY_TARGET` / `CHAINVIZ_WORKBENCH_RPC_HOST` /
     `CHAINVIZ_ETHEREUM_PROFILE_DIR` の5つで、WebSocket待受ポート自体を
     変える最重要の変数だけが未記載になっている(プロキシ側の
     `CHAINVIZ_PROXY_PORT` は記載されているため不整合が目立つ)
  2. `docs/ARCHITECTURE.md` §1冒頭の「3パッケージに分割し」が、直下の
     ツリー(shared/collector/frontend/e2eの4パッケージ)と食い違ったまま
     残っている。e2e追加以前の記述の残存であり、本Issueで§1を書き換えた
     際に更新すべきだった
