# その他(特定のIssueに紐付かない作業記録)

### 2026-07-05 WORKLOG.mdのIssue単位分割のレビュー(reviewer)

- 担当: reviewer
- ブランチ: chore-split-worklog
- 内容: `docs/WORKLOG.md`(4500行超)を `docs/worklog/issue-<番号>.md` に
  分割し索引化する2コミットのdocs変更をレビューした。結果は合格。
  - 内容保全: 分割前(`git show HEAD~2:docs/WORKLOG.md`)の「## 記録」以下と
    分割後の `docs/worklog/*.md`(各ファイルのH1を除く)を、行単位の多重集合
    比較とエントリブロック(### 見出し〜次の見出し)単位の多重集合比較の
    両方で突き合わせ、113エントリすべてが欠落・重複・改変なく保存されて
    いることを確認した(差分は各ファイルH1直後の空行27行のみ)。
  - グルーピング: 各ファイル内の見出しのIssue番号がファイル名の範囲に
    収まることを機械的に検査した。範囲外は4件で、いずれも関連Issueの
    記録(#32のチェック修正PR #75、#58/#59計画のPR #60、ステップ5横断QA、
    #76/#77統合QA)であり配置は妥当。
  - 索引: 全27ファイルへのリンクが解決し、索引に載っていないファイルも
    ない。日付レンジ(例: #32の07-04〜07-05)も実態と一致。
  - CLAUDE.md・全7エージェント定義の追記フロー更新は表現が統一されて
    いる。`pnpm lint` / `pnpm build` / `pnpm test`(shared 2、e2e 34、
    collector 483、frontend 353件)すべて合格。コミット2件の粒度も適切。
- 決定事項・注意点(いずれも非ブロッキングの後続候補):
  - `packages/e2e/src/helpers/docker.ts` 冒頭コメントの「判断は
    docs/WORKLOG.md 参照」は、分割後は `docs/worklog/issue-51-54.md` を
    指すのが正確。docsのみのPRなので今回は対象外とし、次にe2eへ触れる
    際に直すとよい。
  - ペルソナ口調禁止の列挙(CLAUDE.md「開発体制」冒頭と collector /
    frontend / node-env / tester / i18n の各定義)には `docs/WORKLOG.md`
    の表記が残る。「docs/ 配下のドキュメント」に包含されるため矛盾では
    ないが、qa / reviewer 定義は `docs/worklog/issue-<番号>.md` に更新
    されており表記に揺れがある。

### 2026-07-05 PR #85 ステップ7(Phase3実装 — C層)のPLAN.md追記のレビュー(reviewer)

- 担当: reviewer
- ブランチ: docs-step7-plan
- 内容: `docs/PLAN.md` へステップ7を追記する1コミットのdocs変更を
  レビューした。結果は合格。
  - 9個のチェックボックスの文言がIssue #76〜#84のタイトルと完全に一致
    し、担当区分(collector: #76/#77/#79/#80、node-env: #78、frontend:
    #81〜#84)もIssueのラベルと整合することを`gh issue view`で確認した。
    全IssueがOPENでmilestone 6に紐づいている(open 9件)。
  - 冒頭のCONCEPT.md Phase 3引用は原文(ロードマップ3項)と一致。
    ステップ8以降のリストからPhase 3の行が除去され、Phase 4〜8が
    正しく繰り下がっている。
  - `pnpm lint` / `pnpm build` / `pnpm test`(collector 353件、
    frontend 301件)がすべて通ることを確認した。
  - コミットは1件で「1変更=1コミット」の規約に適合。
- 決定事項・注意点:
  - CONCEPT.mdのC層定義には「コントラクト呼び出しやイベントログの
    可視化」が含まれるが、ステップ7では範囲外と明記されている
    (先回り実装をしない方針に沿った意図的なスコープ判断)。CONCEPT.md
    ロードマップの「C層 完成」という表現とは厳密には差分があるため、
    C層の残項目に着手する際に別途スコープすること。
  - Issue #81本文はtxのstatusに「failed」を含むが、collector側の
    Issue #76は「pending→included」までしか言及していない。failedの
    データ源をどうするかは実装着手時にcollector/frontend間で調整が
    必要。
  - コミットメッセージ本文の「バックログのPhase3項目」は、正確には
    PLAN.mdの「ステップ7以降(概要のみ)」セクションの項目を指す
    (PLAN.mdには別に「バックログ」セクションがあるため紛らわしい)。
    履歴改変は不要だが、記録として残す。


### 2026-07-05 PLAN.mdバックログの記載漏れ補完(#63/#64/#65/#68/#86/#95)のレビュー(条件付き差し戻し)

- 担当: reviewer
- ブランチ: docs-plan-backlog-catchup
- 内容:
  - PLAN.mdバックログセクションへ追加された6項目のチェック状態を
    `gh issue view`で照合した。#63/#64/#65/#68はCLOSEDで`[x]`、
    #86/#95はOPENで`[ ]`となっており、実態と一致している。
  - 各行の説明文はIssueタイトル(#95は本文の要点を含む)を正確に
    要約しており、「チェックボックス1行=Issue 1つ」の粒度にも
    適合している。コミットは1件で「1変更=1コミット」の規約どおり。
  - docsのみの変更だが`pnpm lint` / `pnpm build` / `pnpm test`
    (frontend 411件ほか全パッケージ)が通ることも確認した。
  - 全Issue(1〜95のうちIssueである57件)とPLAN.md内のリンクを突合した
    ところ、**#28・#30・#41の3件がPLAN.mdのどこにもリンクされて
    いない**ことが判明した(欠番はすべてPR番号で説明がつく)。
    - #28(CLOSED): reth(EL)のブロック受信時刻をbeacon(CL)のstableIdへ
      対応付ける。milestoneはステップ4で、worklog `issue-25-28.md`に
      実装記録がある。ステップ4のcollector欄への追記が妥当。
    - #30(CLOSED): E2E(結合)テストの導入を検討する。ステップ6の発端と
      なった検討Issueであり、ステップ6の導入文への参照併記が妥当。
    - #41(CLOSED): lighthouse-bn.shのset -fが/data初期化のglob展開を
      無効化する不具合。worklog `issue-41.md`あり。#43/#46と同種の
      node-envバグ修正で、バックログまたはステップ5関連記述への
      追記が妥当。
- 決定事項・注意点:
  - 追加済みの6項目自体には問題なし。上記3件の補完を依頼元へ差し戻した。
  - QA(chainviz-qa)はdocsのみの変更のため省略可と判断(実行環境の動作に
    影響する変更が無く、検証対象が存在しないため)。

### 2026-07-05 PLAN.md記載漏れ補完(#28/#30/#41)の再レビュー(合格)

- 担当: reviewer
- ブランチ: docs-plan-backlog-catchup(コミット bb443fe)
- 内容:
  - 前回差し戻した3件の追記を確認した。
    - #28: ステップ4のcollector欄、#20と#21の間に`[x]`で追加。
      Issueのmilestoneは「ステップ4: Phase 2実装 — B層」・labelは
      collectorで、配置と一致。購読(#20)→対応付け(#28)→配信(#21)の
      順序も処理の流れとして自然。
    - #30: ステップ6の導入文に「([#30]で導入方針を検討)」として参照を
      併記。#30はmilestone無しの検討Issueであり、チェックボックスでは
      なく導入文への参照とする扱いが適切。
    - #41: バックログに`[x]`で追加。#41はmilestone無しのnode-envバグ
      修正で、同種の#43/#56と同じくバックログ配置で一貫している。
      行の文言はIssueタイトルと一致。
  - 全Issue番号との突合を独自に再実施した(`gh issue list --state all`
    の57件と、PLAN.md内の`issues/<番号>`リンク57件を`comm`で比較)。
    双方向とも差分ゼロで、記載漏れ・存在しないIssueへのリンクは無い。
  - コミット履歴は2件(2c5d760: 最初の6項目、bb443fe: 差し戻し対応の
    3項目)で、それぞれ単一の関心事に収まっている。
  - `pnpm lint && pnpm build && pnpm test`(collector 498件・frontend
    411件ほか)が全パッケージで通ることを確認した。
- 決定事項・注意点:
  - 合格。push・PR作成・マージへ進んでよい。
  - QA(chainviz-qa)はdocsのみの変更のため省略可と判断(前回レビューと
    同じ理由)。

### 2026-07-05 開発用一括起動/停止スクリプト(dev-up/dev-down)のレビュー(差し戻し)

- 担当: reviewer
- ブランチ: chore-dev-up-down-scripts(コミット 9d846e0, 548eeb9)
- 内容:
  - `scripts/dev-up.sh` / `scripts/dev-down.sh`、`package.json` の
    `dev:up`/`dev:down`、`.gitignore` の `.dev-pids/` 追加、
    `docs/CONTRIBUTING.md` の使い方追記をレビューした。
  - `pnpm lint && pnpm build && pnpm test` は全パッケージで通ることを確認
    (collector 498件・frontend 411件ほか全パス)。
  - 環境変数名(`CHAINVIZ_COLLECTOR_PORT`/`CHAINVIZ_PROXY_PORT`/
    `VITE_COLLECTOR_URL`)が collector/frontend の実装と一致していること、
    collector が WebSocket listen をポーリング開始より先に行うため
    コールドスタートでも `wait_for_port` が成立することを確認した。
  - `.gitignore` 追加は適切。シェルスクリプトは `packages/*` のロジック
    ではないため vitest 対象外とする判断は妥当。境界原則(フロントは
    collector 経由のみ)にも違反なし。コミット粒度(本体+配線 / docs の
    2コミット)も適切。
- 差し戻し理由(要修正):
  - (1) `dev-up.sh` に二重起動ガードがない。起動済みの状態でもう一度
    実行すると、新しい collector は EADDRINUSE で即死するのに
    `wait_for_port` は旧インスタンスのポートを見て成功し、「起動しました」
    と偽の成功を報告する。さらに pid ファイルが死んだ PID で上書きされ、
    ログも truncate されるため、以後 `dev-down.sh` では旧インスタンスを
    停止できず孤児プロセス化する。起動前に pid ファイル+`kill -0` で
    稼働中インスタンスを検出したら exit 1 するガードが必要。
  - (2) `dev-down.sh` が `kill -9` 後の生存確認をせず、失敗しても
    pid ファイルを削除して exit 0 する。SIGKILL 後に `kill -0` で再確認し、
    まだ生きていれば pid ファイルを残してエラーを報告し非0で終了すること。
- 推奨(必須ではない):
  - frontend の記録 PID は pnpm ラッパーのもの。SIGKILL フォールバック時は
    pnpm だけが死んで vite が孤児化しポートを握り続ける可能性がある。
    `setsid` で起動してプロセスグループごと `kill -- -$pid` するのが堅い。
  - Docker 再利用判定が「running コンテナが1つでもあるか」だけで、
    一部コンテナだけ exited のスタックを修復せず再利用する。E2E ハーネス
    (docker.ts)はチェーン進行の健全性で判定し不健全なら up -d する。
    genesis は Issue #56 で冪等化済みなので、全サービスが running で
    なければ up -d する形に寄せられる。
  - `wait_for_port` の 30回×1秒という固定リトライは「ローカルプロセスの
    listen 開始待ち」でありチェーン進行状態に依存しないため許容だが、
    その前提を示すコメントを1行添えるとよい。
- 決定事項・注意点:
  - CONTRIBUTING.md の既存記述「稼働中に up -d すると genesis が作り
    直され P2P に失敗する」は Issue #56(genesis 冪等化)以前の理由で、
    docker.ts のコメントとは食い違っている(このブランチ起因ではない
    既存の docs ドリフト。別途整理が望ましい)。
  - この作業には対応する GitHub Issue が無く、ブランチ名も
    `issue-<番号>-<スラッグ>` 規約に沿っていない。ユーザー要望起点の
    PLAN 外作業だが、追跡のため Issue を作成して紐付けるか、規約の
    例外とする判断を統括が明示すること。

### 2026-07-05 devスクリプト差し戻し対応の再レビュー(再差し戻し)

- 担当: reviewer
- ブランチ: chore-dev-up-down-scripts(コミット 4945f6c, 3c26d69)
- 内容:
  - 前回差し戻し2件への対応を確認した。
    - (1) 二重起動ガード: `check_not_already_running` はpidファイル+
      `kill -0` で稼働中インスタンスを検出し、collector/frontend
      それぞれの起動直前に `|| exit 1` で呼ばれている。ロジックは正しい。
      pidファイルが空・不正な場合は「起動していない」扱いになり後で
      上書きされるので安全。解消済み。
    - (2) SIGKILL失敗の握りつぶし: `kill -9` 後に `sleep 1` を挟んで
      `kill -0` で再確認し、生存していればpidファイルを残してstderrに
      エラーを出し `FAILED=1` + `return 1` する。`dev-down.sh` には
      `set -e` が無いため、frontendの停止に失敗してもcollectorの停止
      処理は続行され、末尾の `exit "$FAILED"` で非0終了する。伝播も
      正しい。解消済み。
  - `pnpm lint && pnpm build && pnpm test` は全パッケージで通ることを
    確認(collector 498件・frontend 411件ほか全パス)。
  - コミット粒度は4件(feat: スクリプト本体+配線 / docs: CONTRIBUTING /
    fix: 差し戻し対応 / docs: 指摘記録)で、それぞれ単一の関心事に
    収まっている。問題なし。
- 差し戻し理由(要修正):
  - 修正コミット(4945f6c)で `dev-down.sh` 末尾に追加された
    `exit "$FAILED"` が、`--docker` 指定時の `docker compose down` の
    失敗を隠す退行を生んでいる。修正前はスクリプト最後のコマンドとして
    `docker compose down` の終了コードがそのまま伝播していたが、修正後は
    downが失敗しても `FAILED` は 0 のままなので exit 0 になる
    (CLAUDE.md「失敗しているのにok相当を返さない」に抵触。今回の修正が
    直そうとしたのと同じ種類の問題)。`docker compose down || FAILED=1`
    のように失敗を `FAILED` へ反映すること。`cd "$PROFILE_DIR"` の失敗も
    同様に続行してしまうため、あわせて `cd ... || exit 1` 等にするとよい。
- 推奨(必須ではない):
  - frontendの二重起動ガードがcollector起動後に走るため、「frontendだけ
    起動中」のケースでは新collectorを起動してから exit 1 する部分起動が
    起きる。pidファイルは書かれているので案内どおり `pnpm dev:down` で
    回収でき実害は小さいが、2つのガードを起動処理の前にまとめて実行する
    方が部分起動自体を避けられる。
- 決定事項・注意点:
  - 上記1点のみ修正のうえ再レビューに出すこと。修正は数行で済む見込み。
  - Issue化せず`chore-`ブランチで進める判断(WORKLOG分割PR #92等と同様の
    開発ツール整備扱い)は統括の明示判断として了承した。

### 2026-07-05 devスクリプト再々レビュー(合格)

- 担当: reviewer
- ブランチ: chore-dev-up-down-scripts(コミット 5297303)
- 内容:
  - 前回差し戻し(dev-down.sh の `--docker` 実行時に `docker compose down`
    の失敗が `FAILED` に反映されず exit 0 になる退行)への対応を確認した。
    - `docker compose down` / `down -v` の双方に `|| FAILED=1` が付き、
      末尾の `exit "$FAILED"` へ正しく伝播する。`dev-down.sh` は
      `set -e` 無し(`set -uo pipefail`)なので、失敗後も後続処理は
      続行しつつ最終終了コードだけ非0になる設計として一貫している。
    - `cd "$PROFILE_DIR"` の失敗も if 分岐で捕捉し、stderr にエラーを
      出して `FAILED=1` とし、誤ったディレクトリで compose を実行しない
      よう down 自体をスキップする。妥当。
  - 前回推奨だった二重起動ガードの前倒しも確認した。
    `check_not_already_running collector/frontend` がスクリプト冒頭
    (Docker確認・ビルドより前)に移動し、「frontendだけ起動中」のケースで
    collector を部分起動してから exit する問題が解消された。ガードは
    絶対パスの pidファイルのみ参照し cwd に依存せず、`mkdir -p $PID_DIR`
    より後に実行されるため、順序変更による副作用は無い。
  - `pnpm lint && pnpm build && pnpm test` は全パッケージで通ることを
    確認(shared 6件・collector 498件・frontend 411件・e2e unit 34件)。
  - コミット粒度: 今回の追加は 5297303 の1件。dev-down.sh の握りつぶし
    修正(必須指摘)と dev-up.sh のガード順序整理(推奨指摘)が同居して
    おり、厳密には fix と refactor を分けるのが理想だが、前回の差し戻し
    対応コミット(4945f6c、同じく2指摘を1コミットで対応)を許容した判断
    との一貫性から「レビュー指摘対応一式」として許容する。
- 決定事項・注意点:
  - 静的レビューとしては合格。残タスクは chainviz-qa による実機確認
    (二重起動ガード・`--docker` での停止/復旧)と push・PR作成。
  - 前回までに記録した非ブロッキング事項(Docker再利用判定が running
    1つ以上で判定される点、CONTRIBUTING.md の genesis 記述ドリフト、
    wait_for_port の固定リトライへの前提コメント)は未対応のまま。
    いずれも本ブランチのマージを妨げないが、別途整理が望ましい。

### 2026-07-05 devスクリプト(dev-up/dev-down)の実機検証(qa 合格)

- 担当: qa
- ブランチ: chore-dev-up-down-scripts(コミット 8223054)
- 内容:
  - 稼働中の共有 `profiles/ethereum` スタックを壊さないため、別ポート
    (collector 14000 / proxy 14001 / frontend 15173)を環境変数で指定し、
    `--docker` オプションは実行しない方針で検証した。
  - `pnpm dev:up`(別ポート指定)を実行し、以下を確認した。
    - Docker スタックは「既に起動中のスタックを再利用します」と表示され、
      `docker compose up -d` は呼ばれなかった(再利用ロジックが機能)。
    - collector は 14000、ロギングプロキシは 14001、frontend(vite)は
      15173 で起動し、いずれのポートも LISTEN 状態になった。
    - collector の WebSocket(ws://127.0.0.1:14000)へ接続すると、
      chainType=ethereum の snapshot が届き、entities に7ノード
      (beacon1/2・reth1/2・validator1/2・workbench)が含まれていた。
    - Playwright(chrome-headless-shell)で http://localhost:15173 を開き、
      接続バッジが「接続済み」(`.status-badge--connected`)になること、
      infra-card が7枚描画されること、コンソールエラーが無いことを確認した。
  - 二重起動ガード: 起動中に同ポートで `pnpm dev:up` を再実行すると、
    「collector は既にpid ... で起動中です」と表示され exit 1 で即座に
    停止した。PIDファイル・既存プロセスはいずれも変化せず、新プロセスを
    起動して旧プロセスを孤児化させることはなかった。
  - `pnpm dev:down`: collector・frontend の両プロセスが終了し、
    14000/14001/15173 が解放され、PIDファイルも削除された。Docker
    スタックには触れず(「Dockerスタックはそのままにしています」表示)、
    実行前後で7コンテナが Up のまま維持された。プロセス未起動状態で
    再実行しても「記録された起動プロセスがありません」と表示され exit 0
    で冪等に完了した。
  - CONTRIBUTING.md の「手動で動かして触ってみる」節の記述(既定ポート、
    Docker 再利用の挙動、dev:down が既定で Docker を残す点、環境変数での
    ポート変更)は、いずれも実挙動と一致していた。
  - `pnpm lint && pnpm build && pnpm test` を全パッケージで実行し、すべて
    通過した(lint exit 0 / build exit 0 / test は collector 498件・
    frontend 411件ほか全件 pass、exit 0)。
- 決定事項・注意点:
  - `docs/PLAN.md` の完了条件・依頼された確認項目をすべて満たしており
    合格と判定。push・PR 作成・マージに進んでよい。
  - 検証で起動した collector/frontend は `pnpm dev:down` で後始末済み。
    共有 Docker スタックには一切変更を加えていない。
  - 検証環境に Playwright のブラウザ実行用システムライブラリ
    (libnspr4 等)が未導入だったため、scratchpad に展開済みの共有
    ライブラリを `LD_LIBRARY_PATH` で参照して chrome-headless-shell を
    起動した(スクリプト本体の検証には影響しない環境依存の補足)。

### 2026-07-05 chainviz-detectiveエージェント追加のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: chore-add-detective-agent(コミット 602ff6b)
- 内容:
  - `.claude/agents/chainviz-detective.md`(新規)と CLAUDE.md「開発体制」
    チーム一覧への追記(計1コミット)をレビューした。結果は合格。
  - frontmatter: name はファイル名と一致。tools(Read, Bash, Grep, Glob)は
    「コードを書かない」役割の chainviz-qa / chainviz-reviewer と同一構成。
    model: fable は chainviz-reviewer に前例あり。description は既存の
    慣例(使いどき→役割の線引き→「コードは書かない・直さない」で締める)
    に沿っている。
  - 役割の線引き: qa(完了条件との照合・E2E検証)・reviewer(静的レビュー)
    との相互参照が description と本文の両方に明記され、重複・矛盾なし。
    「原因特定後は直すべき担当へ引き継ぐ」「環境要因ならコード側に原因を
    求めず正直に報告する」という切り分けも既存の責務分担と整合する。
  - CLAUDE.md 追記: 他メンバーと同じ体裁(太字ペルソナ名 = エージェント名:
    役割説明+役割の線引き)・粒度で、リスト末尾への追加。既存記述への
    変更はない。「使い方の目安」に detective が無い点は、i18n も同様に
    記載が無いため慣例の範囲内と判断。
  - 命名: 姓「究明」が原因究明の役割そのものを表し、CLAUDE.md の
    「役割そのものが名は体を表す」方式に適合。名「徹」の由来も本文で
    説明されている。
  - `pnpm lint` 合格(ドキュメント・エージェント定義のみの変更で
    ロジック変更なしのため、ユニットテスト追加義務の対象外)。
    コミットは1件で単一の関心事に収まっており粒度も適切。
- 決定事項・注意点(非ブロッキング):
  - 本文の記録先の表現「`docs/worklog/issue-<番号>.md`(無ければ
    `docs/worklog/meta.md`)」は、「issueファイルが未作成なら meta.md へ」
    とも読める。WORKLOG.md のルールは「対応する Issue があればファイルを
    新規作成、Issue に紐付かない作業のみ meta.md」なので、いずれ
    「(対応する Issue が無ければ meta.md、あればファイルを新規作成)」の
    ように明確化するとよい。今回のマージは妨げない。

### 2026-07-06 調査: WSL2環境でブラウザから collector(4000/4001)へ ERR_CONNECTION_REFUSED になる件
- 担当: detective(原因究明)
- ブランチ: main(調査のみ。コード変更なし)
- 症状: WSL2 + VS Code Remote 環境で、Windows 側ブラウザから vite dev server
  (5173)には接続できるのに、collector の WebSocket サーバー(4000)と
  ロギングプロキシ(4001)には毎回 `net::ERR_CONNECTION_REFUSED` になる。
- 実測で確認した事実:
  - collector は WebSocket サーバー(`server/websocket-server.ts` の
    `new WebSocketServer({ port })`)・ロギングプロキシ(`proxy/logging-proxy.ts`
    の `server.listen(port)`)ともホスト指定なしで listen しており、この環境
    (WSL2, Node 系)ではどちらも IPv6 `::` に dual-stack で bind される
    (`ss`/`lsof` で確認。WSL2 内からは 127.0.0.1 でも ::1 でも接続できる)。
  - vite は `127.0.0.1:5173`(IPv4)で listen している。
  - WSL2 の NAT モード localhost 転送は、WSL 側 listener のアドレスファミリを
    そのまま Windows 側に写す。Windows 側 netstat での実測:
    5173(WSL側 IPv4) → `127.0.0.1:5173` で LISTEN、
    4000/4001(WSL側 IPv6 `::`) → `[::1]:4000` / `[::1]:4001` のみで LISTEN
    (`127.0.0.1:4000/4001` には誰も listen していない)。
  - `scripts/dev-up.sh` は `VITE_COLLECTOR_URL="ws://127.0.0.1:4000"` と
    IPv4 loopback を明示指定している。そのためブラウザは Windows 側の
    `127.0.0.1:4000` に接続し、connection refused になる(PowerShell の
    TcpClient で同一症状を再現済み。`::1:4000` へは接続できる)。
  - bind 方式別の対照実験(ポート14000〜14002)でも同結果:
    WSL側 `::` bind → Windows `[::1]` のみ / `0.0.0.0` bind → Windows
    `127.0.0.1` のみ / `127.0.0.1` bind → Windows `127.0.0.1` のみ。
- 根本原因: 「collector/プロキシの IPv6 `::` bind」×「WSL2 localhost 転送が
  アドレスファミリを写す挙動」×「フロントの接続先が `ws://127.0.0.1:4000`
  固定」の組み合わせ。WSL2 内では dual-stack で IPv4 接続も受け付けるため
  問題が顕在化せず、Windows 側からのみ落ちる。
- 対処方針: collector 側の listen を `0.0.0.0` に明示指定する修正が妥当
  (chainviz-collector に引き継ぎ)。プロキシ(4001)はワークベンチコンテナが
  `host.docker.internal`(Docker bridge の IPv4)経由で叩くため、`127.0.0.1`
  bind は不可で `0.0.0.0` が必要。`ws://localhost:4000` へ URL を変える案は
  ブラウザ・OS の名前解決順序に依存するため採らない。

### 2026-07-06 PLAN.mdバックログへのIssue #102追加のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: docs-plan-add-102-backlog(コミット bf33761)
- 内容:
  - `docs/PLAN.md` のバックログセクションへIssue #102(ノード/ワークベンチ
    追加時に仮の半透明カードと即時フィードバックを表示する)を1行追加する
    docsのみの変更をレビューした。結果は合格。
  - `gh issue view 102` で照合: 状態はOPENで `[ ]`(未チェック)と一致。
    PLAN.mdの行の文言はIssueタイトルと完全一致。ラベルはfrontendで、
    フロント側の視覚フィードバック改善という内容とも整合。特定の
    ステップに紐づかないユーザー要望起点の課題であり、バックログ配置は
    既存の #86/#95 と一貫している。リンク先URLも正しい。
  - Issue本文は既存の `pendingRef`(useCommands.ts)の拡張方針を示して
    おり、コマンドはcollector経由のままなので境界原則(フロントは
    Docker/ノードに直接触れない)との矛盾はない。チェーン固有語彙の
    漏れもない。
  - 変更は `docs/PLAN.md` のみ3行の追加で、コミットは1件
    (Conventional Commits形式の `docs:`)。「1変更=1コミット」
    「チェックボックス1行=Issue 1つ」の規約に適合。
  - `pnpm lint` / `pnpm build` / `pnpm test`(shared 6件・e2e 34件・
    collector 500件・frontend 411件)がすべて通ることを確認した。
- 決定事項・注意点:
  - QA(chainviz-qa)はdocsのみの変更のため省略可とする依頼元の判断を
    了承(過去のPLAN.mdバックログ補完レビューと同じ理由。実行環境の
    動作に影響する変更が無く、検証対象が存在しない)。
  - push・PR作成・マージに進んでよい。

### 2026-07-06 chainviz-designerエージェント追加のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: chore-add-designer-agent(コミット eb49fdc)
- 内容:
  - 設計専任エージェント `chainviz-designer`(ペルソナ: 設計 想)の新規定義と
    CLAUDE.md(チーム一覧・使い方の目安)への追記をレビューした。結果は合格。
  - frontmatter(name/description/tools/model)は既存エージェントの慣例と整合。
    tools は Read/Write/Edit/Bash/Grep/Glob で、docs/ARCHITECTURE.md の更新と
    packages/shared の型実装という役割に対して適切。model: fable は
    reviewer/detective と同じく分析寄りの役割への割り当てとして一貫している。
  - 役割分担に矛盾なし。「packages/shared の型は designer が実装着手前に
    先に実装してよい」という新方針に合わせ、CLAUDE.md の使い方の目安が
    「設計範囲を超えて実装途中で追加の型変更が必要になった場合は
    chainviz-reviewer に調整させる」と書き換えられており、reviewer 定義
    (実装中の要望を受けて型を更新する)・実装担当定義(型変更は reviewer と
    調整)の既存記述とも両立する。実装ロジックは書かないという線引きも明確。
  - ペルソナの命名(姓「設計」が役割そのものを表す)は命名規約に適合。
    チャット時のみ口調を使い docs/worklog では平易な日本語、という
    使い分けの明記も既存エージェントと同じ形式。
  - コミットは1件(feat:)で、エージェント定義+CLAUDE.md 追記という構成は
    chainviz-detective 追加時(602ff6b)の前例と同粒度。`pnpm lint` 通過。
- 指摘(非ブロッキング、任意対応):
  - パイプラインの表記が CLAUDE.md では「設計 → 実装 → 試験学 → 査読誠 →
    検証大地」(工程名と人名の混在)、designer 定義では「設計 → 実装 →
    テスト強化 → レビュー → QA」(工程名のみ)と揺れている。どちらかに
    統一するとよい。
  - designer は docs/ARCHITECTURE.md と packages/shared を編集する役割の
    ため、CLAUDE.md の「実装担当への割り振り時に Issue 番号のブランチを
    使わせる」の対象に designer も含まれることを明確にしておくと、設計時の
    ARCHITECTURE.md 更新が実装と同じブランチで merge され、main 上の docs が
    未実装の設計を先行して記述する期間が生じない(「main 上で直接作業
    しない」の全体ルールで実質カバーはされている)。

### 2026-07-06 実装担当3エージェントのモデルをsonnetへ変更のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: chore-implementers-to-sonnet(コミット 783b223)
- 内容:
  - `.claude/agents/chainviz-collector.md` / `chainviz-frontend.md` /
    `chainviz-node-env.md` の3ファイルについて、frontmatter の
    `model: opus` → `model: sonnet` への変更をレビューした。結果は合格。
  - `git diff main..HEAD` で確認し、差分は3ファイル各1行(model行)のみ。
    name/description/tools や本文への意図しない変更は無い。
  - コミットは1件(chore:)で、「実装担当3体のモデル変更」という単一の
    関心事に対応しており粒度は適切。作業ツリーもクリーン。
  - `pnpm lint` 通過。コード変更を伴わないため build/test への影響は無い
    (念のためのlint確認のみ)。
- 決定事項・注意点:
  - 変更理由は「設計担当 chainviz-designer を fable にしたのに合わせ、
    実装担当は sonnet にする」という方針(ユーザー指示)。分析寄りの
    reviewer/detective/designer は fable、実装担当は sonnet という
    役割ベースのモデル割り当てになった。
