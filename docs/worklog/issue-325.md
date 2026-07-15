# Issue #325 dev-up.shがdist鮮度の警告のみでpnpm buildを自動実行しない

### 2026-07-15 Issue #325 起票とバックログ追記のレビュー
- 担当: reviewer
- ブランチ: main(docs/PLAN.md のみの未コミット変更をレビュー。実装着手は後日)
- 内容: Issue #325 の起票内容と `docs/PLAN.md` バックログ節への追記1項目を
  レビューした。結果は**合格**
- 確認したこと:
  - Issue本文の現状説明が `scripts/dev-up.sh` の実コードと一致する
    (`check_build_freshness` は57-85行目、呼び出し元の分岐は97-103行目、
    引用されたbashブロックも実コードと同一)。「警告のみで再ビルドは
    ユーザー任せ」「Issue #121 の『過度に複雑にしない』意図による設計」
    という記述も、スクリプト内コメント(51-56行目)と
    `docs/worklog/issue-121.md` の記録で裏付けを確認した
  - 「古い」と判定される条件の説明(マーカーhashとHEADの不一致、または
    dirtyビルド)が実装(80-84行目)と一致する
  - `docs/PLAN.md` の追記はバックログ節の既存項目とフォーマットが一貫
    している(未チェックのチェックボックス+タイトル行、6スペース
    インデントの括弧書き補足、Issueリンク行、節末尾への追加)
  - docsのみの変更だが規定どおり `pnpm lint` / `pnpm build` / `pnpm test`
    をリポジトリ全体で実行し、全件通過(テスト2120件パス)を確認した
- 決定事項・注意点:
  - 実装は後日。着手時はIssue本文の実装方針(判定結果を戻り値で呼び出し元に
    伝え、メインフロー側で `pnpm build` の実行を分岐)を出発点にする。
    マーカー不在/破損時・dirtyビルド時の扱いは実装時に判断する
  - 対象はシェルスクリプト単体のため、着手時は chainviz-tester を経由せず
    chainviz-reviewer → chainviz-qa の順でよい(Issue本文に明記済み)
  - 軽微な指摘(非ブロッキング): PLAN.md追記の「着手は後日」は、バックログ
    節の見出し自体が「後日着手する課題」であるため冗長。実害はないので
    修正必須とはしない

### 2026-07-16 Issue #325 設計メモ(実装着手前)

- 担当: collector
- ブランチ: issue-325-auto-rebuild-on-stale-dist
- 変更対象: `scripts/dev-up.sh` のみ(TypeScriptロジック変更なし)
- 方針: `check_build_freshness` を「警告を出すだけの関数」から「判定結果を
  終了ステータスで呼び出し元に返す関数」に変更する。`set -euo pipefail` が
  有効なため、この関数を裸で呼び出すと非0終了時にスクリプトが即終了して
  しまう。呼び出し側は必ず `if check_build_freshness; then ... else ... fi`
  の条件式として呼ぶ(bashの仕様上、if/while/untilの条件式・`&&`/`||`の
  左右・`!`否定の対象になっているコマンドは `set -e` の対象外になるため、
  非0を返しても即終了しない)。else節の先頭で `$?` を読めば
  `check_build_freshness` の終了コードを取得できる(else節に入るまでに
  他のコマンドを挟まない限り `$?` は上書きされない)。
- 終了コードの割り当て:
  - `0`: distは最新(何もしない)。gitが使えない環境で比較不能な場合も
    従来通り「何もしない」として扱うため`0`を返す
  - `1`: マーカーのcommit hashが現在のHEADと不一致(古い可能性が高い)。
    このケースのみ呼び出し元が `pnpm build` を自動実行する
  - `2`: 「警告はするが自動ビルドはしない」その他のケース
    (マーカーファイル不在、マーカー中身が壊れている、hashは一致するが
    dirtyビルド)をまとめて割り当てる。呼び出し元はこのコードを個別に
    分岐する必要が無く、0/1以外はすべて「警告のみ」として扱えばよい
- 呼び出し元(97-103行目)の分岐を、`check_build_freshness` の結果に応じて
  3方向(未ビルド/自動リビルド/そのまま再利用)に拡張する。メッセージの
  詳細(hashの値など)は関数内で標準エラーに出力し、呼び出し元は
  「[2/4] ...」という進捗ログの体裁のみを整える(既存の役割分担を踏襲)。
- 2点の判断とその理由:
  1. マーカーファイルが無い/壊れている場合は**自動ビルドしない**
     (従来通り警告のみ)。理由: マーカー不在は「dist/が古い」ことを意味
     するとは限らない(例: Issue #121より前の仕組みでビルドされたdist、
     または将来マーカー形式自体が変わった場合)。fresh/staleのどちらか
     判定できない不明な状態であり、不明な状態を「stale」寄りに倒して
     毎回自動ビルドしてしまうと、事情があって手動でdist/を配置している
     利用者(あまり想定しないが)の意図しない上書きにもなりうる。判定できる
     場合(hash不一致)だけを自動化対象とし、判定できない場合は人間の
     確認に委ねるという保守的な設計を維持する
  2. dirty state(hashは一致するが、ビルド時にuncommittedな変更を含んで
     いた)の場合も**自動ビルドしない**。理由はIssue本文の推奨どおり:
     hashが一致している以上、今再ビルドしても同じuncommitted差分が
     再度dist/に焼き込まれるだけで、鮮度は変わらない(HEAD自体は動いて
     いないため)。自動ビルドしても実利が無く、単にビルド時間が余計に
     かかるだけなので、警告のみに留めてユーザーの判断(コミットするか、
     意図した変更か確認する)に委ねる
- テストについて: シェルスクリプト単体の変更であり、Issue本文の指示通り
  chainviz-testerは経由せずchainviz-reviewer→chainviz-qaに進む
  (Issue #121実装時と同様、リポジトリにbash用テスト基盤が無いため)。

### 2026-07-16 Issue #325 実装と動作確認

- 担当: collector
- ブランチ: issue-325-auto-rebuild-on-stale-dist
- 実装: 上記設計メモの通り `scripts/dev-up.sh` の `check_build_freshness`
  を終了ステータスで判定結果を返す関数に変更し、呼び出し元(dist/index.js
  の存在チェック直後の分岐)を3方向(未ビルド/自動リビルド/そのまま再利用)
  に拡張した。`packages/shared` を含むTypeScriptロジックの変更は無い。
- 動作確認:
  1. `check_build_freshness` 単体をリポジトリの実ファイルパス・実HEADに
     対して5パターン(マーカー不在/hash不一致/hash一致+dirty/hash一致+
     clean/マーカー中身破損)で実行し、意図した終了コード(2/1/2/0/2)と
     メッセージが返ることを確認した
  2. 呼び出し元の分岐ロジックを実ファイルと同一の内容で抽出し、`pnpm`を
     モック関数に差し替えた上で4シナリオ(fresh→スキップ、stale→自動
     リビルド呼び出し、マーカー不在→警告のみでリビルドされない、
     dirty→警告のみでリビルドされない)を実行し、いずれも期待通りの
     分岐(pnpm buildが呼ばれるか否か)になることを確認した
  3. 実環境での確認: 事前に `pnpm --filter @chainviz/collector build`
     でdist/を作成した後、マーカーのhashを意図的に古い値(`0000...`)へ
     書き換えてから実際に `scripts/dev-up.sh` を実行(ポート衝突を避ける
     ため `CHAINVIZ_COLLECTOR_PORT=4100` 等で別ポートを指定。docker
     スタックはメイン作業ディレクトリで既に起動中のものを共有プロジェクト
     `chainviz-ethereum` として再利用し、`docker compose up -d` 自体は
     実行されないことを確認済み)。ログに
     「dist/が古いため pnpm build を自動的に再実行します」が出力され、
     続けて実際に `pnpm -r build` が走ってcollector/frontendが起動する
     ことを確認した。`scripts/dev-down.sh`(`--docker`無し。dockerスタック
     は停止していない)で後始末した後、今度は本ブランチ自体の作業ツリーが
     未コミット状態だったため実際にdirtyマーカーが書き込まれ、
     「警告: dist/はcommit ... の時点でuncommittedな変更を含んだ状態で
     ビルドされています...再ビルドしても同じ差分が再度反映されるだけの
     ため自動リビルドは行いません」という警告が出て、`pnpm build`は
     呼ばれずにそのまま起動することも実環境で確認できた(意図せず
     dirty→自動テストで想定していたシナリオDが本番同様の条件で再現された)
  4. `pnpm build` / `pnpm test` をリポジトリ全体で実行し、全件通過を確認
     (シェルスクリプトの変更のみで、TypeScript側のビルド・テストへの
     影響は無い)
- 2点の判断は上記設計メモの通り: (1)マーカー不在/破損は自動ビルドしない、
  (2)hash一致のdirtyビルドも自動ビルドしない。いずれも実環境の動作確認で
  意図通りに機能していることを確認済み
- 統括への申し送り: `docs/PLAN.md` の該当チェックボックスは実装コミットと
  分けてdocsコミットとして追加する(1変更1コミットの方針)。テスト強化
  (chainviz-tester)は対象外(Issue本文・CLAUDE.mdの方針通り、シェル
  スクリプト単体でbash用テスト基盤が無いため)。git push / PR作成 /
  マージ / Issueクローズは行っていない(統括の判断に委ねる)

### 2026-07-16 Issue #325 実装レビュー

- 担当: reviewer
- ブランチ: issue-325-auto-rebuild-on-stale-dist
- 内容: `scripts/dev-up.sh` の自動リビルド実装(コミット f0e88b0)と
  docs更新(d9c8b53)をレビューした。結果は**合格**
- 確認したこと:
  - `set -euo pipefail` 下での終了ステータスの扱い: `elif check_build_freshness; then`
    の条件式呼び出しは `set -e` の対象外であり、else節先頭の
    `freshness_status=$?` が条件式の終了コードを正しく取得することを
    実際のbashで検証した(status=1/2の両方)。裸呼び出し禁止の注意書きも
    関数コメントに明記されている
  - 関数を抽出して5パターン(マーカー不在/hash不一致/hash一致+dirty/
    hash一致+clean/中身破損)の終了コードが仕様通り(2/1/2/0/2)であること、
    git非リポジトリ環境で0(従来通り何もしない)を返すことを確認した
  - 呼び出し元の3方向分岐をpnpmモックで4シナリオ実行し、hash不一致の
    場合のみ `pnpm build` が呼ばれ、他は起動を止めずに継続することを確認した
  - マーカー書式(1行目hash/2行目dirty|clean)が書き込み側
    `packages/collector/src/build-info/build-marker.ts` の定義と一致する
  - エラーの握りつぶし: `git rev-parse` / `sed` の `|| true` はいずれも
    直後に空チェック+警告出力または意図を説明するコメントがあり、
    無言で失敗を隠す箇所は無い。判定不能ケースはすべて警告メッセージを
    stderrに出している
  - 決め打ち定数の追加は無い。マーカー不在/破損時・dirtyビルド時に
    自動ビルドしない理由は設計メモに明記されており妥当
    (不明な状態をstale側に倒さない保守的設計、hash一致dirtyは再ビルド
    しても鮮度が変わらない)
  - コミット分割は「実装(dev-up.shのみ)」「docs(PLAN.md+worklog)」の
    2コミットで1変更1コミットの方針に沿う。Conventional Commits形式も準拠
  - `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で実行し
    全件通過(テスト2120件)を確認した
  - docsとの齟齬なし(`docs/ARCHITECTURE.md`・`docs/CONCEPT.md` に
    dev-up.shの鮮度チェック挙動の記述は無く、矛盾は生じない)
- 軽微な指摘(非ブロッキング。修正必須とはしない):
  - `check_build_freshness` が elif の条件式として「==> [2/4]」ヘッダの
    出力**前**に評価されるため、警告メッセージ(stderr)がヘッダより先に
    表示される。従来(ヘッダ→警告)と順序が逆になるが、実害は無い
  - git非リポジトリ環境(通常想定しない)で0を返した場合、呼び出し元が
    「dist/は最新です」と表示するのは厳密には「判定不能」であり不正確。
    関数コメントに理由が明記されているため許容

### 2026-07-16 Issue #325 QA(実環境検証)

- 担当: qa
- ブランチ: issue-325-auto-rebuild-on-stale-dist
- 結論: 合格。Issue本文の要望(distが古いと判定した場合に自動で
  `pnpm build` を実行する。最新なら従来通りスキップ。dirtyは警告のみ)を
  すべて満たすことを実環境で確認した。
- 検証環境の注意: メインworktreeが別途default port(4000/4001/5173)で
  稼働していたため、衝突を避けて本検証は
  `CHAINVIZ_COLLECTOR_PORT=4200 / CHAINVIZ_PROXY_PORT=4201 /
  CHAINVIZ_FRONTEND_PORT=5273` のカスタムポートで実施した。docker compose
  プロジェクト名は `chainviz-ethereum` で共有され、本worktreeからも
  `docker compose ps -q` で既存スタックを検出できることを確認済み
  (重複起動しない)。
- 実施した検証と結果:
  1. dist最新(marker hash == HEAD, clean): `scripts/dev-up.sh` を実行し
     「[2/4] ビルド済みのcollectorを再利用します(dist/は最新です)」で
     再ビルドがスキップされ起動した。pnpm buildは走らないことを確認。
  2. distが古い(markerのhashを過去コミット df35e87 に書き換え, HEADは
     3e45e02): dev-up.sh 実行で「dist/が古いため pnpm build を自動的に
     再実行します(ビルド時: df35e87..., 現在: 3e45e02...)」と表示され、
     実際に `pnpm -r build` が走り、マーカーがHEAD(3e45e02)に更新された
     (=ビルドが実行された確証)。docker既存スタックは再利用。collector/
     frontendとも正常起動。
  3. dist dirty(marker hash == HEAD だが2行目が dirty): dev-up.sh 実行で
     「警告: ...uncommittedな変更を含んだ状態でビルドされています...
     自動リビルドは行いません」の警告のみ表示、「[2/4] ビルド済みの
     collectorを再利用します」で自動ビルドされず起動。実行後もマーカーの
     2行目が dirty のまま(作業ツリーはcleanなので、もしビルドが走れば
     clean に書き換わるはず。書き換わらないことがビルド未実行の確証)。
  4. 起動後の実動作: collector WebSocket(port 4200)に接続し、初回に
     `snapshot`(type/payload、payload内に chainType・timestamp・entities
     配列)、続いて `diff` メッセージが配信されることを確認。ロギング
     プロキシ(port 4201)経由の `eth_blockNumber` RPCも疎通し、ブロックが
     進行していることを確認(docker composeスタックとの疎通OK)。frontend
     (vite, port 5273)も起動を確認。
- 後片付け: 各シナリオ後に `scripts/dev-down.sh` でcollector/frontendを
  停止。検証で書き換えたマーカーは最後に `pnpm build` を実行して
  HEAD/clean の正常状態に復元済み。git status clean、カスタムポートに
  残存プロセスなしを確認。dockerスタックは dev-down のデフォルト挙動に
  従い停止せず残置。
- 差し戻しなし。
