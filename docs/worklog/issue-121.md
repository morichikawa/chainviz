# Issue #121 pnpm dev:upがdist/の古いビルドを検知せず気づかないまま起動してしまう

### 2026-07-06 Issue #121 バックログ登録のレビュー

- 担当: reviewer
- ブランチ: docs-plan-add-121-backlog
- 内容: Issue #121 の起票と `docs/PLAN.md` バックログへの追加（コミット
  5b40949、docs のみの変更）をレビューし、合格とした
- 確認したこと:
  - `gh issue view 121` で Issue が OPEN であり、タイトル
    「pnpm dev:upがdist/の古いビルドを検知せず気づかないまま起動してしまう」
    が PLAN.md のバックログ記載（未チェック項目）と一致すること
  - Issue 本文の技術的主張をコードで検証した。`scripts/dev-up.sh` の
    61行目は `[ ! -f "$ROOT_DIR/packages/collector/dist/index.js" ]` で
    ファイルの存在だけを見てビルド要否を判断しており、存在すれば古い
    dist のまま起動する。「存在チェックのみでビルドの鮮度を検知しない」
    という記載は正確
  - 実例として挙がっている `dist/adapters/ethereum/el-peers.js` の欠落も
    整合する。`el-peers.ts` は Issue #106 で collector に追加された
    ソースで、#106 マージ以前のビルド成果物には含まれない
  - `pnpm lint` が通ること（終了コード 0）
  - コミット粒度: docs のみの1コミットで問題なし
- 指摘（非ブロッキング）: Issue #121 のラベルが `frontend` になっているが、
  対象は `scripts/dev-up.sh`（リポジトリ直下のスクリプト）と collector の
  dist であり、frontend パッケージとは無関係。`collector` への付け替え、
  またはパッケージ外である旨の整理を推奨する（PLAN.md の記載自体には
  影響しないため合格判定は変えない）
- 決定事項・注意点: 実装時は「今観測できる値」への依存を避ける観点から、
  mtime 比較よりも Issue 本文の案にある「ビルド時に git commit hash を
  マーカーファイルへ書き込み、起動時に HEAD と比較する」方式のほうが
  worktree 間コピーや clock skew の影響を受けにくい

### 2026-07-06 Issue #121 実装(collector: ビルドマーカー方式)

- 担当: collector
- ブランチ: issue-121-detect-stale-build
- 内容: `pnpm build`(`packages/collector`)実行時に、ビルド時点の
  `git commit hash` と `git status --porcelain` の結果（未コミット変更が
  あるか）を `packages/collector/dist/.build-commit` に書き込むようにした。
  `scripts/dev-up.sh` は起動前にこのファイルと現在の `git rev-parse HEAD`
  を比較し、以下の3パターンで警告をログに出す(いずれも起動は止めない)。
  - マーカーファイルが存在しない、または中身が壊れている →
    「ビルド情報が見つかりません」
  - マーカーの commit hash が現在の HEAD と一致しない →
    「dist/が古い可能性があります(ビルド時: <hash>、現在: <hash>)」
  - hash は一致するが、ビルド時に未コミットの変更があった(dirty) →
    「uncommittedな変更を含んだ状態でビルドされています」
- 実装の内訳:
  - `packages/collector/src/build-info/build-marker.ts`: マーカーファイルの
    フォーマット/パースだけを行う純粋関数（`formatBuildMarker` /
    `parseBuildMarker`）。commit hash と dirty フラグを2行のテキストに
    変換する（bash 側が `sed` だけで読める形式にするため、JSON 等は使わない）
  - `packages/collector/src/build-info/write-marker.ts`: 実際に
    `git rev-parse HEAD` / `git status --porcelain` を実行し
    `dist/.build-commit` に書き込む実行スクリプト。`git` コマンド自体の
    失敗(`.git` が無い環境等)はビルド全体を失敗させず、警告ログを出して
    スキップする（マーカーが無ければ dev-up.sh 側が「見つからない」と
    警告するため診断能力は失われない。意図的に例外を握りつぶす理由を
    コードコメントに明記した）
  - `packages/collector/package.json` の `build` スクリプトを
    `tsc -b && node dist/build-info/write-marker.js` に変更し、tsc の
    コンパイル成果物として上記スクリプトが `dist/build-info/write-marker.js`
    に出力されてから実行されるようにした
  - `scripts/dev-up.sh` に `check_build_freshness` 関数を追加し、
    collector の既存ビルドを再利用する分岐(dist/index.js が存在する場合)で
    呼び出すようにした
- 決定事項・注意点:
  - mtime 比較は不採用(前回レビューの通り、clone/checkout でタイムスタンプが
    更新される等、環境に左右されるため)。git commit hash 比較のみを採用した
  - dirty 検知は「ビルド時点で uncommitted な変更があったか」の1ビットのみ
    保持する簡易的なもの。ビルド後にさらに作業ツリーを変更した場合(hash・
    ファイル内容が変わっても HEAD 自体は動かない)までは追跡できないが、
    Issue 本文の「過度に複雑にしすぎない」という指示に沿い、この範囲に留めた
  - `dist/` は `.gitignore` 対象のため `dist/.build-commit` がコミットされる
    ことはない
  - 実際に4パターン(意図的に古いhashを書いたマーカー / hashは最新だが
    dirtyなマーカー / hash最新かつcleanなマーカー / マーカー自体を削除)を
    それぞれ用意し、`pnpm dev:up`(docker compose起動込みの実環境。ポート
    衝突を避けるため `CHAINVIZ_COLLECTOR_PORT` 等を明示指定)を実行して
    警告が出る/出ないことを目視確認した
  - 前回レビューで指摘された「Issue #121 のラベルが frontend になっている」
    点は、実際の変更対象が `scripts/dev-up.sh` と collector のビルド
    スクリプトであることから `collector` 担当として実装した(ラベルの
    付け替えは統括側で対応想定)

### 2026-07-06 Issue #121 テスト強化(異常系・境界値)

- 担当: tester
- ブランチ: issue-121-detect-stale-build
- 内容: collector の基本テスト(build-marker 11件 / write-marker 4件)に、
  異常系・境界値の観点でテストを追加した(build-marker +15件、
  write-marker +5件、合計 599→619件)。実装コードは変更していない。
- build-marker.test.ts に追加した観点:
  - `parseBuildMarker` の入力トリミング: 1行目/2行目の前後空白、CRLF 改行
    (`\r` が trim される)でも復元できること
  - 3行目以降の余分な内容が無視されること
  - dirty トークンの厳密一致: `DIRTY`(大文字)・`dirtyx`(部分一致)は
    dirty 扱いにしないこと。bash 側 `scripts/dev-up.sh` の
    `[ "$marker_dirty" = "dirty" ]` と挙動を揃える意図をコメントに明記
  - `formatBuildMarker`→`parseBuildMarker` の往復不変性を、複数の hash
    (40桁 SHA・短縮 hash・非 hash 文字列)× clean/dirty で確認
  - 空 commitHash の境界: `formatBuildMarker` は入力を検証せず出力するが、
    その出力は `parseBuildMarker` で null になり往復が崩れること(=万一
    hash が空でも dev-up.sh が「中身が壊れている」と警告でき、診断能力は
    保たれる)を回帰テストとして固定
- write-marker.test.ts に追加した観点:
  - `git status --porcelain` が空白のみ(改行・スペース)を返したときは
    clean 扱いになること
  - `rev-parse`→`status`→`ensureDir`→`writeFile` の呼び出し順序
  - `rev-parse` は成功するが `status` が失敗した場合も例外を伝播し、
    ファイル書き込みも `ensureDir` も行わない(副作用を残さない)こと
  - `rev-parse` が空文字列を返す境界: 検証せず書き込むが、その内容は
    `parseBuildMarker` で null になること(diag 能力は保たれる)
  - `collectorDir` を変えると書き込み先パスも追従すること
- 検証: 追加した回帰テストのうち代表(dirty トークン厳密一致)について、
  実装を意図的に `toLowerCase()` 比較へ壊すとテストが失敗し、元に戻すと
  通ることを確認済み(テストが実際に不具合を検出できることの確認)。
  `pnpm build` / `pnpm test`(collector)いずれも通過。
- シェルスクリプト `check_build_freshness`(scripts/dev-up.sh)について:
  リポジトリに bash 用のテスト基盤(bats 等)は存在せず、vitest からは
  検証できない範囲のため今回はテストを追加していない(タスク指示に沿い
  無理にテスト基盤を新設していない)。TS 側の `parseBuildMarker` と bash
  側の読み取り(`sed -n '1p'`/`'2p'` と `= "dirty"` 比較)は、
  `formatBuildMarker` が生成する実際のマーカー(LF 改行・前後空白なし)に
  対しては同じ結果になることを TS テスト側のコメントに残した。
- 実装のバグは発見していない。想定外入力に対する挙動(null 返却・例外
  伝播・診断能力の維持)はいずれもコメントに記された契約どおりだった。
- 非ブロッキングな観察(バグではない): TS `parseBuildMarker` は行を
  `trim()` するため CRLF や前後空白を吸収するが、bash 側 `sed` は
  トリムしないため、仮にマーカーファイルが CRLF で書かれると bash の
  `marker_hash` に `\r` が残り hash 比較が常に不一致になりうる。ただし
  `formatBuildMarker`+Node の `writeFileSync` は LF のみで書き込むため
  実運用では発生しない。将来マーカー生成側を変更する際の注意点として記録。

### 2026-07-06 Issue #121 実装のレビュー

- 担当: reviewer
- ブランチ: issue-121-detect-stale-build（worktree: /home/zoe/workspace/chainviz-wt-121）
- 結果: **合格**（非ブロッキングの観察事項あり。下記）
- 確認したこと:
  - 設計判断: mtime 比較ではなく git commit hash マーカー方式を採用しており、
    CLAUDE.md の「今この瞬間に観測できる状態に依存した固定値を埋め込まない」
    原則に沿う。決め打ちのタイムアウト・件数上限等の固定値も無い。
    mtime を不採用にした理由は `build-marker.ts` 冒頭コメントと worklog の
    両方に記録されている
  - 境界の遵守: 変更は `packages/collector`（build-info/ 新設と package.json）、
    `scripts/dev-up.sh`、docs のみ。`packages/shared` / frontend への変更なし。
    チェーン固有の語彙の漏れもなし
  - エラーの握りつぶし: `writeBuildMarker` は git 失敗を呼び出し側へ伝播し、
    main() 側でのみ意図的に catch して `console.warn` でエラー内容ごと出力する。
    握りつぶす理由（マーカーは診断情報でありビルド失敗の理由にならない、
    マーカー欠落時は dev-up.sh 側が警告するため診断能力は失われない）が
    コードコメントに明記されており、CLAUDE.md の運用ルールを満たす。
    dev-up.sh 側で git が使えない場合に黙って return する箇所も、理由の
    コメントが付いている
  - テストの質: 35件（build-marker 26 / write-marker 9）を精読。往復不変性、
    dirty トークンの厳密一致（bash 側の `= "dirty"` 比較と整合）、CRLF・
    空白・空文字列の境界、git 失敗時の例外伝播と副作用ゼロ（writeFile /
    ensureDir が呼ばれない）、呼び出し順序まで押さえており、実装をなぞる
    だけの無意味なテストではない。tester が「意図的に壊すと失敗する」ことを
    確認済みである点も worklog で確認した
  - `pnpm lint` / `pnpm build` / `pnpm test` 全通過（collector 619件、
    frontend 539件、shared 10件、e2e 34件）。ビルド後
    `dist/.build-commit` に現在の HEAD と dirty が正しく書き込まれることも
    確認した（作業中 worktree のため dirty になり、期待どおり）
  - `check_build_freshness`（scripts/dev-up.sh）のロジックを直接読解:
    マーカー欠落 → 警告、hash 不一致 → 警告、hash 一致かつ dirty ビルド →
    警告、いずれも起動は止めない。`set -euo pipefail` 下でも
    `|| true`・`local` 宣言と代入の分離が正しく、`bash -n` も通る。
    `pnpm build` 実行分岐（dist/index.js 欠落時）ではビルドが必ずマーカーを
    書き直すため整合する
  - docs との齟齬: `docs/ARCHITECTURE.md` / `docs/CONCEPT.md` に dev-up.sh や
    ビルド手順の記述は無く、齟齬なし。`docs/WORKLOG.md` 索引に issue-121 は
    登録済み
- 非ブロッキングの観察事項:
  - 「clean な HEAD でビルド後、コミットせずにソースを編集して起動」した
    場合は検知できない（hash 一致・マーカー clean のため）。worklog に
    Issue の「過度に複雑にしすぎない」方針に沿った意図的なスコープ限定と
    して記録済みであり、合格判定には影響しない
  - マーカーファイル名 `.build-commit` が TS 側定数
    （`BUILD_MARKER_FILENAME`）と bash 側リテラルの2箇所に重複している。
    言語をまたぐため機械的な共有は難しいが、将来変更する際は両方の更新が
    必要（build-marker.ts のコメントに bash 側との対応が書かれているので
    追跡は可能）
- 統括への申し送り: このブランチには**まだコミットが1つも無い**
  （`git log main..HEAD` が空。全変更が未コミット）。コミット時は
  「1つの変更内容 = 1コミット」に従い、少なくとも
  (1) collector のビルドマーカー実装 + package.json、
  (2) scripts/dev-up.sh の check_build_freshness、
  (3) tester によるテスト強化、
  (4) docs（PLAN.md チェック・worklog）
  の粒度で分割することを推奨する
