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

### 2026-07-06 Issue早期クローズ再発防止のドキュメント修正のレビュー(reviewer 差し戻し)

- 担当: reviewer
- ブランチ: fix-premature-issue-close(コミット 4ff3476)
- 内容:
  - Issue #102・#103 の作業中に実装担当がレビュー・QA前に `gh issue close`
    してしまった事故の再発防止として、実装担当3エージェント定義
    (`chainviz-collector.md` / `chainviz-frontend.md` /
    `chainviz-node-env.md`)の該当箇所の書き換えと、CLAUDE.md
    「品質ゲートを骨抜きにしない運用ルール」への新ルール追記をレビューした。
  - 3エージェント定義の書き換え文言は3ファイルとも完全に一致しており、
    揺れは無い。旧文言(`gh issue close <番号> -R morichikawa/chainviz`)の
    残存も無いことを grep で確認した。
  - `pnpm lint` 通過。コミットは1件(docs:)で単一の関心事に対応しており
    粒度は適切。
- 差し戻し理由:
  - CLAUDE.md「開発ルール」66〜67行目に「チェックボックスにチェックを
    付けたら対応する Issue も閉じ、`docs/PLAN.md` にその Issue 番号への
    リンクを併記する」という旧来の記述が残っている。実装担当は作業前に
    CLAUDE.md を必ず読む決まりのため、今回の事故原因と同種の誤解を招く
    文言が最上位ドキュメントに残ったままでは再発防止として不完全。
    新ルール(109行目)の「PRマージ時の自動クローズに委ねる」運用に
    合わせてこの行も書き換えるべき。
- 軽微な指摘(差し戻し理由ではない):
  - CLAUDE.md への追記箇所で、コードスパン前後のスペースが周辺の既存
    記述(例:「`gh issue view <番号> --json state` 等で」)と異なり
    詰められている(例:「Issueを`gh issue close`しない」)。表記を
    周辺に揃えるとよい。
  - 本変更自体の作業記録が `docs/worklog/meta.md` に無い。CLAUDE.md の
    運用ルール上、修正時に追記するのが望ましい。

### 2026-07-06 Issue早期クローズ再発防止のドキュメント修正の再レビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: fix-premature-issue-close(コミット 3ee1e2e)
- 内容:
  - 前回差し戻し理由だった CLAUDE.md「開発ルール」の旧文言
    (「チェックボックスにチェックを付けたら対応する Issue も閉じ」)が、
    「Issue のクローズは PR マージ時の `Closes #<番号>` による自動クローズに
    委ねる」という新運用に沿った記述へ書き換えられていることを確認した。
  - リポジトリ全体(CLAUDE.md・`.claude/agents/` 全ファイル・`docs/` 配下)を
    grep し、実装担当に Issue の手動クローズを促す旧文言が他に残っていない
    ことを確認した。CLAUDE.md「GitHub Issueの自動クローズを信用しない」節の
    「閉じていなければ手動で閉じる」はマージ後の統括によるフォロー手順で
    あり、新運用と矛盾しない。`chainviz-qa.md` の自動クローズへの言及も
    新運用と整合している。
  - `pnpm lint` / `pnpm build` / `pnpm test` すべてリポジトリ全体で通過。
  - コミットは2件(エージェント定義+新ルール追記 / CLAUDE.md 本体の旧文言
    修正)で、それぞれ単一の関心事に対応しており粒度は適切。
- 判定: 合格。
- 軽微な指摘(合否に影響しない):
  - 3ee1e2e の追記文でもコードスパン前後のスペースが周辺と不統一
    (例:「付けたら`docs/PLAN.md`にその Issue 番号への」)。次回以降、
    周辺の表記に揃えると読みやすい。

### 2026-07-06 QA担当の権限逸脱(独断push/マージ)再発防止のドキュメント修正レビュー(reviewer 差し戻し)

- 担当: reviewer
- ブランチ: fix-qa-overstep-prevention(コミット e78ba97)
- 内容:
  - Issue #103 のQA検証時に `chainviz-qa` が合格判定後、統括の関与なしに
    push・PR作成・mainへのマージ・Issueクローズまで独断実行した事故を受けた
    再発防止の文言追加(CLAUDE.md / chainviz-qa.md / chainviz-reviewer.md /
    chainviz-detective.md の4ファイル)をレビューした。
  - CLAUDE.md の修正は根本原因(「都度の確認を待たずに進めてよい」の主語の
    曖昧さ)に対して的確。「統括(指揮統。このセッション自身)が」の明記と、
    サブエージェントへの明示的な禁止の追記、事故の経緯の記載により、
    同じ誤読は起こりにくくなっている。
  - `pnpm lint` / `pnpm build` / `pnpm test` すべてリポジトリ全体で通過。
    コミットは1件で単一の関心事(再発防止の明文化)に対応しており粒度は適切。
- 判定: 差し戻し(指摘は軽微。修正後は差分確認のみで合格とできる)。
- 差し戻し理由:
  - CLAUDE.md に追記した禁止の列挙が「`git push` / PR作成 / マージ」の
    3項目で、「Issueのクローズ」が抜けている。実際の事故ではIssueクローズも
    独断実行されており、エージェント定義3ファイルの列挙(4項目)とも
    揃っていない。CLAUDE.md 側にも「Issueのクローズ」を加えて4ファイルの
    列挙を統一するべき。
- あわせて指摘(推奨・合否には直接影響しない):
  - `chainviz-designer.md` は Bash と Write/Edit を持ち `packages/shared` の
    実装も許されているのに、全エージェント中で唯一 commit/push/PR作成/
    マージに関する制約の記述が一切無い。今回 reviewer/detective に予防的
    追記をした判断基準(Bashを持ち同様の誤解が起こり得る)を適用するなら、
    designer にも同様の一文を入れるのが一貫する。
- 確認事項への回答:
  - tester/i18n を今回対象外とした判断は妥当。既存の「ユーザーの明示的な
    依頼なしに commit / push / PR作成 / マージはしない」がデフォルト禁止と
    して機能しており、CLAUDE.md の新しい統括限定の明文(全エージェントが
    読む)でも重ねてカバーされる。collector/frontend/node-env にも同種の
    既存記述があることを確認した。
  - 本変更で chainviz-qa を省略する判断について: CLAUDE.md「品質ゲートを
    骨抜きにしない運用ルール」は「『docsだけだから』を理由に qa を省略
    しない。ユーザーからの明示的な指示が無い限り必ず通す」と明記している。
    動作検証の対象が無い変更なので実質的な検証項目は無いが、省略するなら
    手続き上ユーザーの明示的な了承を得ておくべき。

### 2026-07-06 QA担当の権限逸脱再発防止のドキュメント修正レビュー(reviewer 再レビュー・合格)

- 担当: reviewer
- ブランチ: fix-qa-overstep-prevention(コミット e1e56ed, 2b1c4ce)
- 内容:
  - 前回差し戻し(CLAUDE.md の禁止列挙に「Issueのクローズ」が欠落)への
    対応を再レビューした。CLAUDE.md の列挙は「`git push` / PR作成 /
    マージ / Issueのクローズ」の4項目となり、chainviz-qa.md /
    chainviz-reviewer.md / chainviz-detective.md / chainviz-designer.md の
    4エージェント定義と統一されたことを確認した。
  - 推奨指摘だった `chainviz-designer.md` への予防的な一文
    (「git push / PR作成 / mainへのマージ / Issueのクローズは自分で
    行わない」)の追加も確認した。
  - CLAUDE.md・全エージェント定義を横断で再確認し、他に矛盾する記述や
    列挙漏れが無いことを確認した。実装系エージェント
    (collector/frontend/node-env/tester/i18n)は既存の「ユーザーの明示的な
    依頼なしに commit / push / PR作成 / マージはしない」というデフォルト
    禁止があり、Issueクローズについても CLAUDE.md の新しい統括限定の明文
    (どのサブエージェントも実行してはならない)で全員がカバーされる。
  - `pnpm lint` / `pnpm build` / `pnpm test` すべてリポジトリ全体で通過。
    コミット粒度も適切(差し戻し対応1件・worklog記録1件)。
- 判定: 合格。
- 補足(合否には影響しない):
  - 「ドキュメント・エージェント定義のみの変更では今後 chainviz-qa を
    省略してよい」というユーザーの明示的な許可を統括が得たとのこと。
    CLAUDE.md「品質ゲートを骨抜きにしない運用ルール」の例外条件
    (ユーザーからの明示的な指示)を満たすため手続き上の問題は無いが、
    この許可は現状どのドキュメントにも記録されていない。将来のセッションが
    許可の存在を知らずに判断に迷わないよう、CLAUDE.md の該当ルールに
    恒常的な例外として明記しておくことを推奨する。
  - CLAUDE.md の追記文中「ならない**（実際に」の直後の改行位置がやや
    不自然(「実際に」で行末)。次に同ファイルを編集する機会があれば
    整形するとよい。

### 2026-07-06 QA省略例外の恒常化と改行整形のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: fix-qa-overstep-prevention(コミット 53b244d)
- 内容:
  - 前回合格時の推奨2点への対応を再レビューした。
  - CLAUDE.md「品質ゲートを骨抜きにしない運用ルール」の「レビュー・QAの
    手続きに例外を作らない」項に、`docs/` 配下・`.claude/agents/` 配下のみ
    の変更(コード変更を伴わない)は `chainviz-reviewer` の合格のみで
    `chainviz-qa` を省略してよいという例外が明記されたことを確認した。
    文言は正確で、(1) 対象を docs/ と .claude/agents/ のみに限定し
    `packages/*` 等のコード変更を伴う場合を明示的に除外している、
    (2) 根拠を「ユーザーから明示的な許可を得た運用」と明記しており、
    元のルール本文の例外条件(ユーザーからの明示的な指示)と整合する、
    (3)「他の『明らかに正しいから』等の理由による省略を正当化しない」と
    釘を刺しており例外の拡大解釈を防いでいる。
  - 「ならない**（実際に」で行末が切れていた不自然な改行位置も、段落の
    再整形により解消されたことを確認した(文言の変更なし)。
  - CLAUDE.md・全エージェント定義を横断で確認し、新しい例外と矛盾する
    記述が無いことを確認した。「開発ルール」節の
    「`chainviz-reviewer` と `chainviz-qa` のレビューを経てからマージ」等
    の記述は通常フローの説明であり、品質ゲート節の例外が「ユーザーの
    明示的な指示」という元々の解除条件の具体化である以上、矛盾しない。
  - `pnpm lint` / `pnpm build` / `pnpm test` すべてリポジトリ全体で通過
    (collector 512件・frontend 420件)。コミットは1件で、2つの推奨事項は
    どちらも同一項・同一ファイルの文言整備という単一の関心事に収まって
    おり粒度は許容範囲。
- 判定: 合格。本変更自体が docs/ 配下のみの変更のため、明記された例外の
  適用第1号として chainviz-qa は省略でよい(ユーザーからも今回の省略の
  明示的な指示あり)。

### 2026-07-06 chainviz-uxエージェント追加のレビュー(reviewer 差し戻し)

- 担当: reviewer
- ブランチ: chore-add-ux-agent(コミット ec32c04)
- 内容:
  - UX専任エージェント `chainviz-ux`(体験優)の新規追加
    (`.claude/agents/chainviz-ux.md` + CLAUDE.md への登録)をレビューした。
  - 合格点: frontmatter の name/description/model は既存慣例
    (特に chainviz-designer.md)と整合。description は「役割 + 隣接担当との
    境界 + コードは書かない」という既存の書き方に揃っている。
    CLAUDE.md への追記(チーム一覧の designer 直後への配置、使い方の目安の
    「UXが課題の中心なら ux、併用も可」の使い分け、designer/ux 共通の
    ブランチ運用ルールへの docs/CONCEPT.md の追加)は書式・粒度とも既存と
    整合。命名「体験 優」も「名は体を表す」方式に沿う。コミットは1件で、
    designer 追加時(eb49fdc)と同じ「エージェント定義 + CLAUDE.md 登録」の
    構成であり粒度も妥当。`pnpm lint` 通過。差分は .md のみ(git diff --stat
    で確認)のため build/test は main と同一結果。
  - 差し戻し理由(要修正2点):
    1. frontmatter の tools に Edit が無い(`Read, Write, Bash, Grep, Glob`)。
       本文で職務とされている「docs/CONCEPT.md の該当箇所の更新」
       「docs/worklog/ への追記」「docs/WORKLOG.md 索引への1行追加」は
       いずれも既存ファイルの部分編集であり、Edit 無しでは Write で
       ファイル全体を書き直すしかなく破壊事故のもと。同じく docs 更新を
       担う chainviz-designer は Edit を持っており慣例とも不整合。
       `tools: Read, Write, Edit, Bash, Grep, Glob` に揃えること。
    2. 「やること」冒頭の起動手順「`pnpm dev:up`または`pnpm dev`で
       モック起動し」が事実と異なる。(a) ルート package.json に `dev`
       スクリプトは存在しない(存在するのは packages/frontend の `dev`
       (vite)のみ)。(b) `pnpm dev:up`(scripts/dev-up.sh)は Docker スタック
       + collector + frontend の実環境一括起動であり「モック起動」では
       ない。モックが使われるのは VITE_COLLECTOR_URL 未設定で frontend の
       vite dev server を起動した場合(packages/frontend/src/app/
       defaultClient.ts)。「実環境なら `pnpm dev:up`、UI のみモックで
       確認するなら `pnpm --filter @chainviz/frontend dev`(VITE_COLLECTOR_URL
       未設定)」のように実態に合わせて書き直すこと。
  - 推奨(差し戻し理由ではない):
    - 「Playwright等でスクリーンショット・操作を確認する」とあるが、
      Playwright はリポジトリに導入されていない(packages/e2e は vitest)。
      都度導入する前提なのか、既存の手段で確認するのかを明確にするとよい。
    - description に chainviz-qa との境界(完了条件との照合は qa、こちらは
      分かりやすさの評価)が無い。detective/qa/reviewer が隣接役割との
      境界を description で明示している慣例に合わせる一文を推奨。
    - docs/CONCEPT.md は「正」(決定事項の原典)であるため、「守ること」に
      「CONCEPT.md の決定事項を変える更新はユーザー・統括の確認を経る」
      旨の歯止めを追加することを推奨(現状は『決めきれない判断は確認する』
      のみで、決定済み事項の書き換えへの明示的な歯止めが無い)。
- 判定: 差し戻し(要修正2点の対応後に再レビュー)。なお本変更は
  docs/ + .claude/agents/ のみの変更のため、修正後の再レビュー合格を
  もって chainviz-qa の省略は CLAUDE.md の明記済み例外に該当し妥当。

### 2026-07-06 chainviz-uxエージェント追加の再レビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: chore-add-ux-agent(コミット 93168f0)
- 内容:
  - 前回差し戻し2点の修正を確認した。
    1. frontmatter の tools が `Read, Write, Edit, Bash, Grep, Glob` に
       なり、Edit の欠落が解消。chainviz-designer.md と同一のツール構成で
       慣例と整合。
    2. 起動手順の記述が実態と一致することをコードと突き合わせて確認。
       `pnpm dev:up`(scripts/dev-up.sh: Docker + collector + frontend の
       実環境一括起動)と `pnpm --filter @chainviz/frontend dev`
       (packages/frontend の vite。`VITE_COLLECTOR_URL` 未設定時は
       packages/frontend/src/app/defaultClient.ts が mockData.ts の
       モッククライアントを返す)の説明はいずれも正確。
  - 前回の非ブロッキング推奨3点への対応も確認した。
    - description 末尾に chainviz-qa との境界(完了条件との照合は qa、
      こちらは分かりやすさの評価に特化)を追記。chainviz-detective.md の
      description が隣接役割との境界を明示する書き方と整合。
    - docs/CONCEPT.md の決定事項を変える更新はユーザー・統括に先に確認する
      という歯止めを追記(補強程度の追記は除くという例外付き)。なお統括の
      報告では「守ること」への追加とされていたが、実際の配置は「やること」の
      CONCEPT.md 更新の項目内。内容としては更新作業の直近に置かれており
      むしろ読みやすく、問題としない。
    - Playwright 未導入の件も「未導入なら都度導入する」と明記され解消。
  - `pnpm lint` 通過。main との差分は .md 3ファイルのみ
    (.claude/agents/chainviz-ux.md、CLAUDE.md、docs/worklog/meta.md)で、
    build/test は main と同一結果。コミットは差し戻し対応1件で粒度も妥当。
- 判定: 合格。docs/ + .claude/agents/ のみの変更のため、CLAUDE.md の
  明記済み例外により chainviz-qa の省略は妥当。push / PR / マージは
  統括に委ねる。

### 2026-07-06 PLAN.mdバックログへのIssue #129追加のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: docs-plan-add-129-backlog(コミット 8e3a5c7)
- 内容:
  - `docs/PLAN.md` のバックログセクションへIssue #129(動的追加ワーク
    ベンチのRPCがロギングプロキシを経由せずreth1に直結している)を
    1項目追加するdocsのみの変更をレビューした。結果は合格。
  - `gh issue view 129` で照合: 状態はOPENで `[ ]`(未チェック)と一致。
    PLAN.mdの行の文言はIssueタイトルに補足「(操作エッジが描画されない)」
    を添えたもので、補足内容はIssue本文の記述と一致しており正確。
    リンク先URLも正しい。milestoneは未設定で、特定のステップに
    紐づかないバックログ配置(既存の #102/#103/#126 と同様)と整合。
  - Issue本文の技術的主張をコードと突き合わせて確認:
    `packages/collector/src/adapters/ethereum/node-lifecycle.ts` の
    `DEFAULTS.ethRpcUrl` が `http://172.28.1.1:8545` で、この IP は
    `profiles/ethereum/docker-compose.yml` の reth1 の
    `ipv4_address`(172.28.1.1)と一致。一方、静的ワークベンチの
    `ETH_RPC_URL` は `http://host.docker.internal:4001`(ロギング
    プロキシ)であり、「動的追加のみプロキシを経由しない」という
    ギャップの説明は実装と一致している。
  - ラベルは collector。修正箇所が `node-lifecycle.ts`(collector側の
    RPC接続先決定ロジック)であることと整合し妥当。
  - 変更は `docs/PLAN.md` のみ3行の追加で、コミットは1件
    (Conventional Commits形式の `docs:`)。「1変更=1コミット」
    「チェックボックス1行=Issue 1つ」の規約に適合。
  - `pnpm lint` / `pnpm build` / `pnpm test`(shared 10件・e2e 34件・
    collector 584件・frontend 539件)がすべて通ることを確認した。
- 決定事項・注意点:
  - Issue本文が参照する `docs/worklog/issue-123.md` は未マージの
    ブランチ `issue-123-ux-design-node-addition` 上にのみ存在する。
    #123 のマージ後に参照が解決される前提であり、本変更の合否には
    影響しない(差し戻し理由としない)。
  - QA(chainviz-qa)はdocsのみの変更のため省略可とする依頼元の判断を
    了承(CLAUDE.mdに明記された例外に該当。実行環境の動作に影響する
    変更が無く、検証対象が存在しない)。
  - push・PR作成・マージは統括の判断に委ねる。

### 2026-07-06 Issue #123/#124 共通のshared型設計(p2pRole / rpcTargetNodeId)

- 担当: designer
- ブランチ: design-issue-123-124-shared-types
- 内容: Issue #123(ノード/ワークベンチ追加時の接続先予告)と Issue #124
  (P2Pメッシュ形成の正常性の伝達)のUX設計(それぞれ
  `issue-123-ux-design-node-addition` / `issue-124-ux-design-p2p-mesh`
  ブランチの `docs/worklog/issue-123.md` / `issue-124.md` に記録)が
  重複して必要としていた `packages/shared` の型変更を、単一の設計に
  統合して実装した。実装ロジック(collector/frontend)は書いていない。
- 実装した型(`packages/shared/src/world-state/entities.ts`):
  1. `NodeEntity.p2pRole?: "bootnode" | "peer"` — P2P上の役割。
     - #123は `"boot" | "peer"`、#124は `"bootnode"`(単一値)を提案して
       いたが、値は `"bootnode"` に統一(用語集・UI文言の「ブートノード/
       bootnode」と1対1で対応し、略語 "boot" より誤読が少ない)。
     - `"peer"` も残した2値のユニオンにした。collectorはラベルの有無から
       どちらかを常に確定できるため「知っていることを明示する」形にし、
       「省略 = 不明(旧スナップショット)」の意味論を `removable` の前例と
       同じく明確にするため。フロントの判定は `=== "bootnode"` のみで
       よく、省略時は自然にフォールバック(#123 §4-5)に倒れる。
     - bootnodeという語彙はチェーン非依存のP2P一般概念(Bitcoinのseed
       node、libp2pのbootstrap peerも同値に正規化する想定)と判断し、
       ChainAdapter境界には抵触しないとした。
  2. `WorkbenchEntity.rpcTargetNodeId?: string` — RPC呼び出しが最終的に
     届くノードのid。#123の提案は `string | null` だったが、null は
     採らず「解決不能・旧スナップショット = 省略」に一本化した(「無い」
     の表現が2通りあると collector/frontend で解釈が割れる。
     `WalletEntity.ownerWorkbenchId` の null は「所有者が削除された」
     という意味のある状態であり、こちらには区別すべき状態が無い)。
- テスト: `entities.test.ts` にJSON往復・省略時の意味論のテストを3件追加
  (既存の removable テストと同じ流儀)。`pnpm build && pnpm test && pnpm
  lint` を全パッケージで実行し、collector/frontend のビルド・既存テストを
  壊さないことを確認した(shared 13 / collector 584 / frontend 539 passed)。
- docs: `docs/ARCHITECTURE.md` のワールドステートスキーマ(NodeEntity /
  WorkbenchEntity)に両フィールドと導出方法のコメントを反映した。
- PR戦略の判断(統括への提案): **型定義+docsのみの独立した先行PRとして
  このブランチをマージし、#123と#124はこれを前提に並行実装する**(案a)。
  - 理由: `p2pRole` は両Issueが必要とするため、どちらか一方のPRに
    同梱すると他方への直列依存または entities.ts の二重編集(コンフリクト)
    が生じる。optionalフィールドのみのスキーマ追加は動作に影響せず
    (旧collector/旧frontendのどちらとも互換)、両Issueの実装が直後に
    始まるため「未実装の設計だけがmainにある期間」は最小で済む。
  - CLAUDE.mdの「先行してmainに未実装の設計だけが反映される期間を
    作らない」原則からの例外になるため、採否は統括が判断すること。
    #123のフォールバック設計(§4-5)により、#123/#124はどちらが先に
    マージされても動作が破綻しない(値が来るまでは表示を出さないだけ)。
- collector側の正規化ロジック設計(実装はcollector担当。ここでは設計のみ):
  1. `p2pRole`(#124のブランチで実装):
     - `adapters/ethereum/labels.ts` にラベルキー定数
       `P2P_ROLE_LABEL = "com.chainviz.p2p-role"` を追加する。
     - `adapters/ethereum/index.ts` の `toEntity()`(nodeを返す分岐)で
       `p2pRole: obs.labels[P2P_ROLE_LABEL] === "bootnode" ? "bootnode"
       : "peer"` を設定する(ラベル無し・想定外の値はすべて peer)。
     - addNodeで追加するノードは常にpeer役なので `node-lifecycle.ts` は
       ラベルを付与しない(現状のままでよい。#124の設計どおり)。
  2. `rpcTargetNodeId`(#123のブランチで実装):
     - 値の出所はコンテナenvではなく **collectorの設定**とする。全ワーク
       ベンチの実効的なRPC到達先はロギングプロキシの転送先
       (`CHAINVIZ_PROXY_TARGET`、既定 `http://172.28.1.1:8545`)であり、
       Alice(compose起動)のenv `ETH_RPC_URL` はプロキシ自身
       (`host.docker.internal:4001`)を指すためenvからは解決できない。
       また `ContainerObservation` はenvを持たない(listContainersは
       envを返さず、inspect追加はポーリング負荷増)。
     - `EthereumAdapterDeps` に `rpcTargetHost?: string` を追加し、
       collector本体 `src/index.ts` が `resolveProxyTarget()` の結果から
       URLのhost部を取り出して渡す。`pollInfra()` 内で、同じポーリングの
       観測結果から `ip === rpcTargetHost` のノードを探し、その
       `stableId` を全 `WorkbenchEntity.rpcTargetNodeId` に設定する。
       見つからなければ省略する。毎ポーリングで解決し直すので、後から
       ブートノードが再作成されても追従する(固定の解決結果を埋め込まない)。
     - 注意: 動的追加ワークベンチは現状プロキシを経由せず
       `node-lifecycle.ts` の既定 `http://172.28.1.1:8545` へ直結する
       (#123 §1で発見された実装ギャップ)。既定値同士は同一ホストのため
       上記の一括解決で表示上は正しいが、`CHAINVIZ_PROXY_TARGET` を
       変更した環境では動的追加分の表示が実態とずれ得る。プロキシ経由化
       (#123 判断事項3の別Issue)が入れば一致する。この前提は実装時に
       コード上のコメントにも明記すること。
- node-env側の設計(#124のブランチで実装): `profiles/ethereum/
  docker-compose.yml` の reth1・beacon1 サービスに
  `labels: { com.chainviz.p2p-role: "bootnode" }` を追加する(2サービス
  各1〜2行)。**ラベル追加は必要**と判断した。理由: 既存の
  `RETH_ROLE`/`BEACON_ROLE` env はlistContainersの観測に含まれず、
  collectorに「reth1/beacon1がブート役」という構成知識をハードコード
  するのはチェーンプロファイル追加時の差し替え単位を壊すため。ラベルは
  既に `ContainerObservation.labels` として収集済みで、Issue #65の
  「Dockerラベルを単一の真実の情報源とする」方針とも整合する。既存の
  `com.chainviz.role`(execution/consensus/workbench)はクライアント
  種別の別軸なので値を混ぜない。ラベル変更は既存コンテナの再作成を
  伴う点に注意(QAは既存スタックへの適用を一度実際に通すこと)。
- 未決事項: なし(型・値の意味論・データの出所は本記録で確定。#123の
  案A/案Bの採否など UX 上の未決事項は各Issueのworklogを参照)。

### 2026-07-06 Issue #123/#124 共通shared型のテスト強化(異常系・境界値)

- 担当: tester
- ブランチ: design-issue-123-124-shared-types
- 対象: `NodeEntity.p2pRole` / `WorkbenchEntity.rpcTargetNodeId` の追加。
  型定義のみの変更で、これらを設定・利用する実装ロジックは #123/#124 で
  今後実装予定のため、テストは「型の追加が既存のdiff/store動作を壊さない
  こと」の確認に範囲を絞った。runtime バリデーション(zod等)は
  `packages/shared` に存在しないため、既存の `removable` の前例に倣った
  シリアライズ/不変条件のテスト水準に合わせた。
- 追加したテスト:
  - collector `world-state/diff.test.ts`:
    - `p2pRole` の変化(peer→bootnode)が entityUpdated の patch に載る
    - 省略→bootnode(役割が後から判明)も差分として検出される
    - `rpcTargetNodeId` の変化が workbench の patch に載る
    - optional フィールドが present→absent になっても clearing patch は
      出ない(既知の制約。下記参照)
  - collector `world-state/store.test.ts`:
    - `p2pRole` が無関係フィールドの patch 適用後も保持される
    - `p2pRole` / `rpcTargetNodeId` がスナップショットを素通しで保持される
  - frontend `world-state/store.test.ts`:
    - `applySnapshot` が両フィールドを保持し、省略エンティティは undefined
      のまま残る(後方互換)
    - `applyDiff` の `p2pRole` patch が他フィールドを壊さずマージされる
- 既存実装のバグではない既知の制約(実装担当への申し送り): `diff.ts` の
  `fieldPatch` は `Object.keys(after)` のみを走査するため、before にあって
  after で省略された optional フィールドは差分に現れず、store に旧値が
  残る。全 optional フィールド共通の挙動で、bootnode/peer は一度確定すると
  消えない運用のため現状は実害なし。#123/#124 で「役割の取り消し」
  （bootnode を再び不明へ戻す）を扱う必要が出た場合はこの制約に留意する
  こと。この挙動は上記 diff.test.ts のテストで固定化済み。
- 確認: `pnpm build` / `pnpm test`(shared/collector/frontend)いずれも通過。
  shared 13、collector 590、frontend 541 テストが green。

### 2026-07-06 Issue #123/#124 共通shared型のレビュー(reviewer)

- 担当: reviewer
- 対象: ブランチ `design-issue-123-124-shared-types`(designerのコミット
  2件 + testerのテスト強化(レビュー時点で未コミット))
- 判定: **合格**(内容面の差し戻しなし。ただし下記「マージ前の要対応」あり)
- 確認した内容:
  1. 型設計: `NodeEntity.p2pRole?: "bootnode" | "peer"`(省略 = 不明の
     3状態)と `WorkbenchEntity.rpcTargetNodeId?: string`(省略 = 解決
     不能/旧スナップショット)は、いずれもチェーン非依存の語彙で
     CLAUDE.mdの境界原則に沿う。"bootnode" はCONCEPT.md(386行目・
     556行目)で既に使われている確立済みの語彙であり、`eth_getLogs` の
     ようなチェーン固有RPC語彙の漏出には当たらない。導出ロジック
     (Dockerラベル `com.chainviz.p2p-role`)はcollector(ChainAdapter)側に
     閉じる設計で、境界を壊していない。null を使わず省略に一本化した
     判断も、`ownerWorkbenchId` の null(意味のある状態)との対比が
     コメントで説明されており妥当
  2. testerの申し送り(optionalフィールドの「値あり→省略」が差分に
     反映されない)は `diff.ts` の `fieldPatch`(`Object.keys(after)` のみ
     走査)で事実と確認した。挙動を固定化するテストも追加済みで、
     記録として十分。**補足(#123実装担当への追加の申し送り)**:
     `p2pRole` は「一度確定したら取り消さない」運用で影響なしだが、
     `rpcTargetNodeId` は「解決済み→解決不能(省略)」がランタイムで
     起こり得る(転送先ノードが観測から消えた場合)。このときstoreには
     旧idが残るが、同じポーリング周期で対象ノード自体に entityRemoved が
     出るため、フロントが「参照先エンティティが存在しないidは無視する
     (エッジを描かない)」というダングリング参照のガードを入れていれば
     表示上の実害はない。#123のフロント実装ではこのガードを必ず入れること
  3. 「型定義+docsのみの先行mainマージ」: CLAUDE.mdの「先行してmainに
     未実装の設計だけが反映される期間を作らない」原則の例外に当たるが、
     (a)ユーザーの明示的な許可済み、(b)#123/#124の両方が同一フィールドを
     必要とし、どちらかのPRに同梱すると直列依存かコンフリクトが生じる、
     (c)optionalフィールドのみで旧collector/旧frontendと双方向互換、
     (d)両Issueの実装が直後に控えており「未実装の設計」期間は最小、
     という条件が揃っており今回に限り妥当と判断する。本記録をもって
     例外適用の経緯とする(他のケースの前例として流用しないこと)
  4. `pnpm lint` / `pnpm build` / `pnpm test` を全パッケージで実行し
     すべて通過(shared 13 / collector 590 / frontend 541、testerの
     報告値と一致)
  5. テストの質: 型のみの変更でランタイムロジックが無いため、JSON往復・
     diff/storeの素通し・後方互換(省略時undefined)という水準は既存の
     `removable` の前例と整合し適切。既知の制約を固定化するテスト
     (clearing patchが出ないこと)は、将来 `fieldPatch` の走査方式を
     変えたとき意図的な仕様変更として検出される点で意味がある。
     エラー握りつぶし・環境依存の決め打ち定数は該当なし(定数追加なし)
  6. コミット粒度: designerの2件(feat(shared)のコード+テスト / docsの
     スキーマ反映+設計記録)は関心事が分かれており適切
- **マージ前の要対応(統括へ)**: testerのテスト強化3ファイルと
  meta.md追記がレビュー時点で未コミットのまま残っている。マージ前に
  `test:` コミットとして確定させること(テスト強化とその記録は同一の
  関心事なので1コミットで差し支えない)。本レビュー記録の追記分も
  同様にコミットが必要

### 2026-07-06 PLAN.mdバックログへのIssue #135追加のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: docs-plan-add-135-backlog(コミット 882df22)
- 内容:
  - `docs/PLAN.md` のバックログセクションへIssue #135(eth_subscribeの
    WebSocket接続が切断時に自動再接続しない)を1項目追加するdocsのみの
    変更をレビューした。結果は合格。
  - `gh issue view 135` で照合: 状態はOPENで `[ ]`(未チェック)と一致。
    PLAN.mdの行の文言はIssueタイトルそのままで正確。リンク先URLも
    正しい。特定のステップに紐づかないバックログ配置(既存の
    #125/#129 等と同様)と整合。
  - Issue本文の技術的主張をコードと突き合わせて確認:
    `packages/collector/src/adapters/ethereum/eth-ws-client.ts` の
    `subscribe()` は `socket.on("open")`(購読開始)・
    `socket.on("message")`(通知処理)・`socket.on("error")`(コールバック)
    のみを配線しており、`socket.on("close")` ハンドラと再接続処理は
    存在しない。「接続断時に自動再接続しない」という主張は実装と一致。
    newHeads / newPendingTransactions の両方が同じ `subscribe()` を
    経由するため、タイトルが両購読を対象にしている点も正確。
  - Issue本文の対応方針にある「再接続の待機時間等を固定値にする場合は
    前提条件をコメントとworklogの両方に明記する」という注意書きは、
    CLAUDE.mdの品質ゲート運用ルール(環境状態依存の固定値の禁止)と
    整合しており適切。
  - ラベルは collector。修正箇所が `eth-ws-client.ts`(collector側の
    ChainAdapter実装内)であることと整合し妥当。
  - 変更は `docs/PLAN.md` のみ3行の追加で、コミットは1件
    (Conventional Commits形式の `docs:`)。「1変更=1コミット」
    「チェックボックス1行=Issue 1つ」の規約に適合。
  - `pnpm lint` / `pnpm build` / `pnpm test`(shared 13件・e2e 34件・
    collector 625件・frontend 550件)がすべて通ることを確認した。
- 決定事項・注意点:
  - 統括が実運用でBlockEntity配信の停止を観測済み(コンテナRecreate後、
    collector再起動まで復旧しない)とのことで、Issue本文の再現手順・
    完了条件の記述はその観測と矛盾しない。実際の再現・修正後の動作
    検証は #135 実装時のQA(chainviz-qa)の担当となる。
  - QA(chainviz-qa)はdocsのみの変更のため省略可とする依頼元の判断を
    了承(CLAUDE.mdに明記された例外に該当。実行環境の動作に影響する
    変更が無く、検証対象が存在しない)。
  - push・PR作成・マージは統括の判断に委ねる。

### 2026-07-07 PLAN.mdバックログへのIssue #139追加のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: docs-plan-add-139-backlog(コミット be5415e)
- 内容:
  - `docs/PLAN.md` のバックログセクションへIssue #139(PC停止等で
    チェーンが長時間停止すると、beacon再起動がweak subjectivity period
    エラーで失敗する)を1項目追加するdocsのみの変更をレビューした。
    結果は合格。
  - `gh issue view 139` で照合: 状態はOPENで `[ ]`(未チェック)と一致。
    PLAN.mdの行の文言はIssueタイトルそのままで正確。リンク先URLも
    正しい。既存のバックログ項目(#125/#129/#135)と同じ配置・書式で
    整合している。
  - Issue本文の内容を確認: lighthouseの実際のエラーメッセージ
    ("The current head state is outside the weak subjectivity period")
    が引用されており、現状の回避策(`down -v` によるチェーンデータ
    全削除)とその問題点(ブロック履歴の喪失)、対応方針の3案
    (A: エラー検知して確認の上で自動再初期化、B: `--ignore-ws-check`
    の付与、C: 停止期間に応じた自動判定)、完了条件が明記されている。
    案の選定をchainviz-designerの検討に委ねる旨、閾値を設ける場合は
    CLAUDE.mdの「環境状態依存の固定値の禁止」原則に従い根拠を明記する
    旨の注意書きも適切。
  - ラベルは node-env。原因がprofiles/ethereumのgenesisタイムスタンプ
    固定とlighthouseの起動オプションにあるため妥当(案Aが
    `scripts/dev-up.sh` に触れる可能性はあるが、主たる担当領域として
    node-envで整合)。
  - 変更は `docs/PLAN.md` のみ3行の追加で、コミットは1件
    (Conventional Commits形式の `docs:`)。「1変更=1コミット」
    「チェックボックス1行=Issue 1つ」の規約に適合。
  - `pnpm lint` / `pnpm build` / `pnpm test`(shared 13件・e2e 34件・
    collector 638件・frontend 761件)がすべて通ることを確認した。
- 決定事項・注意点:
  - 統括が実際にPC停止後の `docker compose up -d` でbeacon1の起動失敗を
    確認済みとのこと。実際の再現・修正後の動作検証は #139 実装時のQA
    (chainviz-qa)の担当となる。
  - Issue本文の「具体的な閾値は未調査」(weak subjectivity periodの長さ)
    は実装着手時に要調査。lighthouseのデフォルトではvalidator数・
    バランスに依存して算出されるため、設計時に実測すること。
  - QA(chainviz-qa)はdocsのみの変更のため省略可とする依頼元の判断を
    了承(CLAUDE.mdに明記された例外に該当)。
  - push・PR作成・マージは統括の判断に委ねる。

### 2026-07-07 PLAN.mdバックログへのIssue #141追加のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: docs-plan-add-141-backlog(コミット 1e2afe1)
- 内容:
  - `docs/PLAN.md` のバックログセクションへIssue #141(reth(EL)同士の
    エッジにブロック伝播パルスが構造的に一切走らない)を1項目追加する
    docsのみの変更をレビューした。結果は合格。
  - `gh issue view 141` で照合: 状態はOPENで `[ ]`(未チェック)と一致。
    PLAN.mdの行の文言はIssueタイトルそのままで正確。リンク先URLも
    正しい。既存のバックログ項目(#125/#129/#135/#139)と同じ配置・
    書式で整合している。
  - Issue本文の技術的主張をコードで裏取りした:
    - `packages/collector/src/adapters/ethereum/targets.ts` の
      `executionTargets()` は `receivedAtKey: beaconStableId ?? obs.stableId`
      としており、対応するbeaconが存在する通常構成では
      `BlockEntity.receivedAt` のキーは常にbeacon(CL)側のstableIdに
      なる(EL自身のstableIdはbeaconが見つからない場合のフォール
      バックのみ)。主張どおり。
    - フロントの `packages/frontend/src/entities/blockPulse.ts` は
      「両端点がともに `receivedAt` に記録されているエッジだけ」を
      パルス対象とするため、端点がEL(reth)のstableIdである
      `-execution` ネットワークのエッジは構造的にパルス対象外になる。
      「構造的に一切走らない」という表現は正確。
    - 対応方針が参照先として挙げる `subscribeBlocks()`・`blockTracker`
      は `packages/collector/src/adapters/ethereum/index.ts` に実在し、
      `target.receivedAtKey` をキーに `blockTracker.record()` している
      ことを確認した。
  - ラベルは collector。修正箇所がcollectorの
    `targets.ts` / `index.ts`(receivedAtの記録側)なので妥当。
    frontend側(blockPulse.ts)は両端点が揃えば既存ロジックのまま
    動くため、collector単独のラベルで整合。
  - 変更は `docs/PLAN.md` のみ2行の追加で、コミットは1件
    (Conventional Commits形式の `docs:`)。「1変更=1コミット」
    「チェックボックス1行=Issue 1つ」の規約に適合。
  - `pnpm lint` がリポジトリ全体で通ることを確認した(exit 0)。
- 決定事項・注意点:
  - 対応方針の「CL側の記録と両方持たせる」を実装する際は、同一論理
    ノードのEL/CL両方のキーが同じ `receivedAt` に入ることになるため、
    フロントのパルス計算(波の起点判定・鮮度ウィンドウ)がCL/ELの
    ネットワークごとに正しく分離されるかを設計時に確認すること。
  - QA(chainviz-qa)はdocsのみの変更のため省略可とする依頼元の判断を
    了承(CLAUDE.mdに明記された例外に該当)。
  - push・PR作成・マージは統括の判断に委ねる。

### 2026-07-07 PLAN.mdバックログへのIssue #143追加のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: docs-plan-add-143-backlog(コミット 5c7fc73)
- 内容:
  - `docs/PLAN.md` のバックログセクションへIssue #143(eth_subscribeの
    エラー応答(JSON-RPCエラー)を検知できず、購読失敗に気づけない)を
    1項目追加するdocsのみの変更をレビューした。結果は合格。
  - `gh issue view 143` で照合: 状態はOPENで `[ ]`(未チェック)と一致。
    PLAN.mdの行の文言はIssueタイトルそのままで正確。リンク先URLも
    正しい。既存のバックログ項目(#125/#129/#135/#139/#141)と同じ
    配置・書式で整合している。
  - Issue本文の技術的主張をコードで裏取りした:
    - `packages/collector/src/adapters/ethereum/eth-ws-client.ts` の
      `parseSubscriptionResult()` は `message.method !== "eth_subscription"`
      の場合に即 `undefined` を返す。ノードが `eth_subscribe` リクエスト
      をJSON-RPCエラーで拒否した応答(`{id: 1, error: {...}}`)は
      `method` を持たないため `undefined` になり、`subscribe()` 内の
      `message` ハンドラで `onResult` が呼ばれない。主張どおり。
    - `JsonRpcMessage` インターフェースには `error` フィールド自体が
      定義されておらず、エラー応答を解釈する経路がどこにも無い。
    - `onError` が呼ばれるのは `socket.on("error")`(トランスポート層の
      エラー)のみで、接続確立後のJSON-RPCレベルの拒否では発火しない。
      「購読ハンドルは見かけ上生きているが通知は永遠に届かない」という
      記述は正確。
    - Issue本文の「`eth_subscribe` リクエストのid(`id: 1` 固定)」も
      `subscribe()` の送信コードと一致する。
  - ラベルは collector。修正箇所が `packages/collector` の
    `eth-ws-client.ts` なので妥当。
  - 変更は `docs/PLAN.md` のみ3行の追加で、コミットは1件
    (Conventional Commits形式の `docs:`)。「1変更=1コミット」
    「チェックボックス1行=Issue 1つ」の規約に適合。
  - `pnpm lint` がリポジトリ全体で通ることを確認した(exit 0)。
- 決定事項・注意点:
  - 対応方針(案)は「id: 1 に対応するレスポンスに `error` があれば
    `onError` を呼ぶ」だが、実装時はIssue #135(切断時の自動再接続)と
    修正箇所が同じ `subscribe()` に重なるため、両Issueの着手順・依存
    関係を統括が調整するとよい(再接続時に購読リクエストを再送する
    設計になれば、エラー検知も再送ごとに効く必要がある)。
  - QA(chainviz-qa)はdocsのみの変更のため省略可とする依頼元の判断を
    了承(CLAUDE.mdに明記された例外に該当)。
  - push・PR作成・マージは統括の判断に委ねる。

### 2026-07-07 PLAN.mdバックログへのIssue #148追加のレビュー(reviewer 合格)

- 担当: reviewer
- ブランチ: docs-plan-add-148-backlog(コミット 22acde1)
- 内容:
  - `docs/PLAN.md` のバックログセクションへIssue #148(長時間停止後の
    再起動で--ignore-ws-checkだけでは不十分(genesisからの再構築が
    1 slot以内に収まらずハング))を1項目追加するdocsのみの変更を
    レビューした。結果は合格。
  - `gh issue view 148` で照合: 状態はOPENで `[ ]`(未チェック)と一致。
    PLAN.mdの行の文言はIssueタイトルそのままで正確。リンク先URLも
    正しい。既存のバックログ項目(#139/#141/#143)と同じ配置・書式で
    整合している。
  - Issue本文の技術的主張をリポジトリの実体で裏取りした:
    - 「lighthouseは再起動のたびに`/data`を初期化してgenesisからやり直す」
      は main の `profiles/ethereum/scripts/lighthouse-bn.sh` の
      `find /data -mindepth 1 -delete`(Issue #41/#43由来)と一致。
    - 「Issue #139で`--ignore-ws-check`フラグを追加」は未マージの
      `issue-139-weak-subjectivity` ブランチの `lighthouse-bn.sh` に
      実在する(#139のPRマージ後にmainへ入る)。
    - ハング閾値(約1.5〜1.8時間)・weak subjectivity period(約4.6時間)・
      検知方法(`head_slot`が0のまま)・復旧手段(`docker compose down -v`)
      の記述は、同ブランチの `docs/worklog/issue-139.md` と
      `profiles/ethereum/README.md` の検証記録・記載と一致。
    - Issue本文が参照する `docs/worklog/issue-139.md` は現時点のmainには
      無いが、#139ブランチ上に存在するため参照切れにはならない。
  - ラベルは node-env。対応方針(checkpoint sync導入・`/data`初期化設計の
    見直し)がいずれも `profiles/` 配下の変更なので妥当。milestoneは
    無し(バックログは特定ステップに紐づかない)で整合。
  - 変更は `docs/PLAN.md` のみ3行の追加で、コミットは1件
    (Conventional Commits形式の `docs:`)。「1変更=1コミット」
    「チェックボックス1行=Issue 1つ」の規約に適合。
  - `pnpm lint` がリポジトリ全体で通ることを確認した(exit 0)。
- 決定事項・注意点:
  - Issue #148の対応方針の1つ「`/data`を再起動のたびに初期化しない設計への
    変更」はIssue #43(EL/CL乖離)・#56(genesis再生成の不整合)を解決した
    現行設計の前提を崩すため、着手時はIssue本文のとおりchainviz-designer
    による設計検討を先行させること。
  - Issue #148は#139の実機検証から派生した課題であり、#139のPRマージ前に
    #148へ着手すると`--ignore-ws-check`が無い状態での作業になる。着手順は
    #139のマージ後とするのが自然。
  - QA(chainviz-qa)はdocsのみの変更のため省略可とする依頼元の判断を
    了承(CLAUDE.mdの例外規定に該当)。
  - push・PR作成・マージは統括の判断に委ねる。

### 2026-07-07 PLAN.mdバックログへのIssue #153追加のレビュー(reviewer 合格)

- 担当: reviewer
- 対象: ブランチ `docs-plan-add-153-backlog`(コミット c6f2513、
  `docs/PLAN.md` のみ3行追加)
- 内容:
  - `docs/PLAN.md` のバックログセクションへIssue #153
    (beaconStableIdForExecutionがdocker composeプロジェクトをスコープ
    しない(複数プロジェクト同時観測時にキー混線の恐れ))を1項目追加する
    docsのみの変更をレビューした。結果は合格。
  - `gh issue view 153` で照合: 状態はOPENで `[ ]`(未チェック)と一致。
    PLAN.mdの行の文言はIssueタイトルそのままで正確。リンク先URLも
    正しい。既存のバックログ項目(#148)と同じ配置・書式で整合している。
  - Issue本文の技術的主張をコードで裏取りした:
    - `packages/collector/src/adapters/ethereum/targets.ts` の
      `beaconStableIdForExecution()`(173〜186行)は、composeサービス名から
      役割プレフィックスを剥がしたノード群キー(例: "reth1"/"beacon1" →
      "1")の一致だけでbeaconを探しており、stableIdのプロジェクト部
      (`projectOf()` は同ファイルに存在するがここでは未使用)を比較して
      いない。Issueの主張どおり。
    - 呼び出し元 `executionTargets()`(`index.ts` 経由)には観測値が
      プロジェクトで絞り込まれずに渡るため、同一Docker daemon上に
      同名サービス(reth1/beacon1)を持つ別プロジェクトが同居すると
      プロジェクト跨ぎの対応付けが起こり得る。
    - 既存テスト `targets.test.ts` の "returns the first beacon
      encountered when several share the node key"(443行付近)が、
      別プロジェクトのbeaconが観測順で先にあればそちらを返すという
      現行挙動を明示的に文書化しており、Issueの内容と完全に一致する。
    - 対応方針(案)の「プロジェクトでスコープする」は、既存の
      `projectOf()` を流用できるため実現可能性も妥当。
  - ラベルは collector。修正対象が `packages/collector` 内なので妥当。
    milestoneは無し(バックログは特定ステップに紐づかない)で整合。
  - 変更は `docs/PLAN.md` のみ3行の追加で、コミットは1件
    (Conventional Commits形式の `docs:`)。「1変更=1コミット」
    「チェックボックス1行=Issue 1つ」の規約に適合。
  - `pnpm lint` がリポジトリ全体で通ることを確認した(exit 0)。
- 決定事項・注意点:
  - Issue本文の「実運用への影響」の記載どおり、通常運用(1 collectorが
    1プロジェクトのみ観測)では発生しない低優先度の潜在バグ。着手時は
    上記の既存テスト(現行挙動を文書化したもの)を「修正後は自プロジェクト
    のbeaconのみ返す」という仕様のテストへ書き換えることになる点に注意。
  - QA(chainviz-qa)はdocsのみの変更のため省略可とする依頼元の判断を
    了承(CLAUDE.mdの例外規定に該当)。
  - push・PR作成・マージは統括の判断に委ねる。

### 2026-07-07 新Phase 4（C層拡張: コントラクト可視化）の設計

- 担当: designer
- ブランチ: design-phase4-contract-visibility
- 内容: ユーザー要望（「支払い等の一般操作をGUIで」「コントラクトはどこで
  動いているか・何の役割か・なぜ必要かを伝える」）を受け、Phase 3で範囲外と
  していたコントラクト呼び出し・イベントログ可視化を新Phase 4として設計した。
  - CONCEPT.md: ロードマップを振り直し（新Phase 4を挿入、旧Phase 4〜8を
    Phase 5〜9へ）。C層の説明を具体化（コントラクトカード・カタログ復号・
    定型操作）。未決事項にPhase繰り込み/ABIの扱い/「どこで動くか」の見せ方の
    3決定を追記。
  - ARCHITECTURE.md: §2にContractEntity拡張（name/catalogKey/deployer等・
    削除しないチェーン側状態）、TransactionEntityのcontractCall/
    createdContractAddress/contractEvents、WalletEntity.tokenBalancesを追加。
    §3にrunWorkbenchOperationコマンド（transfer/deployContract/callContract。
    ワークベンチ内cast/forge実行でRPCがロギングプロキシを自然に通る方式）。
    §4にsubscribeContracts（省略可）とコントラクトカタログ
    （profiles/ethereum/contracts/。ソースとcatalog.jsonをコミット、自動
    デプロイはしない）を追記。
  - packages/shared: 上記の型（DecodedArgument/ContractCall/ContractEvent/
    TokenBalance/ContractEntity刷新/TransactionEntity拡張/
    WorkbenchOperation/Command拡張/ChainAdapter.subscribeContracts?）を実装し
    型テストを追加。Command網羅チェックに掛かるfrontendの機械的追従
    （エラーメッセージキー追加・mockクライアントの未対応応答）のみ実施。
    pnpm lint/build/test全パッケージ合格（shared 23・collector 719・
    frontend 791・e2e 34）。
  - PLAN.md: ステップ8（UX 1項目・node-env 2・collector 5・frontend 5）を
    追加し、ステップ9以降の概要リストを振り直した。
- 決定事項・注意点:
  - デプロイ検知はeth_getBlockReceiptsの正規化拡張（receiptの
    contractAddress/logs）で行い、ブロックあたりRPC回数を増やさない
    （Issue #86の方針を維持）。関数呼び出しの復号はpending検知時の
    eth_getTransactionByHashにinputを加えて行うため、pendingを経ず取り込み
    のみ観測したtxはcontractCall（関数名）が付かないことがある。フロントは
    toとContractEntity.addressの照合でフォールバックする。
  - ABIはワールドステートに載せず、復号結果（関数名・引数・イベント名の
    文字列）だけをチェーン非依存語彙で載せる（ChainAdapter境界）。復号
    できないものはrawFunctionId/rawEventId（生識別子。解釈はフロントの
    表現セット責務。OperationEdge.operationと同じ扱い）。
  - ContractEntityはWalletEntity同様チェーン側状態として削除しない。新規
    DiffEvent種別は追加しない（entityAdded/entityUpdatedに同乗）。
  - deployContractコマンド経由のデプロイはコマンド処理側がアドレス→
    カタログキーをアダプタへ登録して照合する。手動forge createは「未知の
    コントラクト」表示（バイトコード照合による特定は実装時オプション）。
  - collector起動時にカタログが読めない場合はコントラクト復号を無効化して
    起動継続（mnemonic欠落時のウォレット追跡と同じ縮退。エラーはログ）。
  - コントラクトカードのレイアウト・文言・色・定型操作UIの具体はUX担当
    （chainviz-ux）が設計してからfrontendへ引き継ぐ（PLAN.mdステップ8の
    先頭項目）。
  - 実装時の追加事項: DockerOperationsにはexecが無いため、
    runWorkbenchOperation実装時にコンテナ内コマンド実行口の追加が必要。
    引数はシェル文字列連結ではなく配列で渡すこと（インジェクション防止）。

### 2026-07-07 新Phase 4（C層拡張）のUX設計

- 担当: ux
- ブランチ: design-phase4-contract-visibility
- 内容: PLAN.mdステップ8の先頭項目（コントラクトカード・定型操作・
  イベントログ表示のUX設計）を実施した。成果物は
  `docs/ARCHITECTURE.md` §6（frontendへの着手指示を兼ねる実装仕様）。
  実装コードは書いていない。
- 進め方: frontendをモックデータで起動し
  （`pnpm --filter @chainviz/frontend dev`、VITE_COLLECTOR_URL未設定）、
  Playwright（スクラッチパッドに都度導入。手順はissue-123.md §8と同じ。
  chromiumの依存libはapt-get download+展開+LD_LIBRARY_PATHで解決）で
  日英両言語の画面・ポップオーバー・操作エッジパルス・tx確定フラッシュを
  実際に確認してから設計した。designerの設計（本ファイル前項・
  ARCHITECTURE.md §2〜§4・shared型）と矛盾しないことを型定義ベースで
  確認済み。
- 設計の要点（詳細は ARCHITECTURE.md §6）:
  - キャンバスに「コントラクト行」を新設（インフラ行・ウォレット行に続く
    第3の帯。コントラクトはウォレットと同じ「チェーン側の状態」のため）。
    配置・新着発光はIssue #123の流儀を踏襲。
  - 「全ノードで実行される」は、(1)カード常設ピル（evm用語アンカー）、
    (2)ポップオーバー冒頭の誤解防止文、(3)tx確定フラッシュと既存ブロック
    伝播発光のタイミング同期、の3経路で伝える。コントラクト→ノードの
    エッジは張らない（エッジ=実在の接続・呼び出しという既存の視覚語彙を
    守る）。
  - 未知のコントラクトは破線ボーダー+「カタログ外」ピル+ABI用語アンカー
    付き説明で差別化。存在・呼び出し発生・デプロイエッジは既知と同様。
  - 定型操作はワークベンチカード下部の「操作を実行…」ボタン→カード脇の
    操作パネル（送金/デプロイ/呼び出しの3タブ）。確認ダイアログは挟まず、
    結果は既存の観測経路（操作エッジパルス→pendingチップ→確定フラッシュ）
    がそのまま見せる。デプロイのみ仮カード（#102の流儀）。
  - tx チップのラベルを hash から「意味」（関数名/デプロイ/生ID）優先へ。
    確定時に fromウォレット→コントラクトの揮発パルス+コントラクトカードの
    確定フラッシュ。カードに「直近の呼び出し・イベント」チップ列
    （txからの導出。専用フィールド不要）。
  - トークン残高はWalletCardにチップ列で追加（ContractEntity.tokenとの
    照合で解釈。照合できない分は非表示。tokenBalances無しなら行ごと出さず
    Phase 3までの見た目を変えない）。
  - glossary追加（contract/deploy/abi/event-log/evm/token）は「定義→
    なぜ必要か→chainvizではどう見えるか」の3拍子で書き、全用語にUI上の
    アンカーを対応させる（#124の教訓）。
- 統括・ユーザーに確認が必要な判断（ARCHITECTURE.md §6.10。本文は推奨案で
  記述済み）:
  1. 「全ノードで実行」の表現（推奨: ピル+文言+同期。対案: 全ノードへの
     薄いエッジ）
  2. 操作フォーム定義の置き場所（推奨: フロント表現セット
     chain-profiles/ethereum/ の静的データ。対案: プロトコル拡張で配布。
     後者はshared型変更が要りdesigner調整）
  3. 金額の入力単位（推奨: ETH入力+フロントでwei変換）
  4. 操作パネルの形（推奨: カード脇ポップオーバー）
- あわせて実施: PLAN.mdステップ8のUX項目へ成果物ポインタを追記
  （チェックは統括に委ねる）。CONCEPT.md「体験イメージ」にコントラクト
  カードの1項目を補強追記（決定事項の変更ではなく、C層の決定済み内容の
  体験イメージへの反映）。
- frontend実装への申し送り:
  - モッククライアントの runWorkbenchOperation は現状 ok:false 固定
    （designerのプレースホルダ）。UI実装と同じIssue内で成功シミュレー
    ション（tx追加→確定→contract entityAdded→tokenBalances更新）へ
    差し替えること（オフラインでのUX確認・QAに必要）。
  - i18n文言はARCHITECTURE.md §6.8が初稿。語調の微調整は裁量、構成・意味の
    変更は不可。英語文言はchainviz-i18nのレビュー対象。
  - 各表示のダングリング参照ガード（deployerウォレット不在・ContractEntity
    未観測のtokenBalance等）を必ず入れること（#123の申し送りと同じ流儀）。

### 2026-07-07 新Phase 4（C層拡張）設計フェーズのレビュー

- 担当: reviewer
- ブランチ: design-phase4-contract-visibility（レビュー時点で未コミット）
- 結果: 合格（コード・docsへの修正指示なし）
- 確認内容:
  - Phase番号の振り直し: CONCEPT.md（ロードマップ本文・比較TIPSの前提・
    非EVM着手順・未決事項）、PLAN.md（冒頭のPhase 1〜9・ステップ9以降の
    概要）、ARCHITECTURE.md（D層購読口のPhase 5参照）をgrepで全件照合し、
    旧番号の取り残しが無いことを確認した。worklog内の旧Phase番号は過去の
    記録であり書き換え対象外
  - 設計原則: ABIはprofiles/ethereum/contracts/catalog.json（データファイル）
    に置きアダプタだけが読む。ワールドステートには復号結果（関数名・引数・
    イベント名の文字列）と生識別子（rawFunctionId/rawEventId。解釈はフロント
    表現セットの責務でOperationEdge.operationと同じ既存パターン）のみが載り、
    eth_*等のチェーン固有語彙・ABIそのものはsharedに漏れていない。
    subscribeContractsは省略可でBitcoin等の既存/将来プロファイルに分岐を
    強いない。カタログはデータとコードの分離に沿う
  - shared型: abiRefの削除は全パッケージgrepで利用箇所ゼロを確認。
    ContractEntity.chainType追加も既存の構築箇所が無く破壊なし。省略可
    フィールドの意味論（省略=情報なし）がJSDocに明記されている
  - frontendの機械的追従: ERROR_KEY（Record<Command["action"],...>の網羅）、
    messages.tsのエラー文言、mockDataのswitch網羅の3点で過不足なし。
    useCommands.tsの分岐は非網羅条件で影響なし。collector側のCommandHandlerは
    default節でok:false+具体的なaction名を返すため、実装前に新コマンドが
    届いても握りつぶしにならないことを確認した
  - テストの質: entities.test.ts（省略と空配列の区別、decimals:0のfalsy境界、
    巨大数値の文字列保持、JSON往復での省略キー脱落）、protocol/index.test.ts
    （判別共用体の網羅・混在拒否。@ts-expect-errorはsharedのtsconfigが
    includeにsrc全体を含むためtsc -bで実際に検証される）、
    chain-profile/index.test.ts（subscribeContracts省略アダプタの型充足）は
    いずれも契約を固定する意味のあるテストと判断
  - pnpm lint / build / test 全パッケージ合格（shared 40 / collector 719 /
    frontend 791 / e2e 34）
- 指摘なしの観察事項（統括への申し送り）:
  - 未コミットのためコミット粒度は未レビュー。コミット時は関心事ごと
    （designer分のdocs+shared型+frontend追従 / ux分のdocs / tester分の
    テスト強化）に分けること
  - ARCHITECTURE.md §6.10の判断4点（全ノード実行の表現・操作フォーム定義の
    置き場所・金額入力単位・操作パネルの形）が未確定。frontend実装着手前に
    統括・ユーザーで確定が必要（PLAN.mdステップ8のUX項目のチェックは
    確定後に付ける）
  - mockDataのrunWorkbenchOperationはok:false固定のプレースホルダ。
    ステップ8のfrontend実装で成功シミュレーションへ差し替えること
    （UX担当の申し送りどおり）
  - QA要否の判断: 実装ロジックを伴わない型定義+機械的追従のみで、実行時に
    観測可能な動作変化が無い（新コマンドを送るUIが存在せず、collectorは
    明示的に拒否する）。過去のdesign-issue-123-124-shared-typesと同じ
    パターンであり、tester→reviewerで完結してよいと判断（最終判断は統括）
### 2026-07-07 PLAN.mdステップ8へのIssueリンク追記のレビュー(reviewer 合格)

- 担当: reviewer
- 対象: ブランチ `design-phase4-contract-visibility`(未コミットの
  `docs/PLAN.md` のみの変更。milestone #7 作成と Issue #157〜#169 の
  起票に伴うリンク追記)
- 内容:
  - ステップ8(Phase4実装 — C層拡張)の全13チェックボックスへの
    `[#番号](URL)` リンク追記と、milestoneプレースホルダ行の実URL化を
    レビューした。結果は合格。
  - `gh issue view` で #157〜#169 の全13件を照合: 各Issueのタイトルが
    PLAN.mdの対応するチェックボックスの文言と1対1で正確に対応している
    (UX 1件 #157 / node-env 2件 #158〜#159 / collector 5件 #160〜#164 /
    frontend 5件 #165〜#169)。番号の割り当てにズレや取り違えは無い。
  - 全13件が milestone #7「Phase 4: C層拡張(コントラクト可視化)」に
    紐づいていることを確認(`gh api repos/.../milestones/7` で
    open_issues: 13 とも一致)。milestoneリンクのURL
    (https://github.com/morichikawa/chainviz/milestone/7)も実在する
    正しいURLで、他ステップ(milestone 1〜6)と同じ書式。
  - ラベルも妥当: #158〜#159 は node-env、#160〜#164 は collector、
    #165〜#169 は frontend。#157(UX設計)は専用ラベルが無いため引き継ぎ先の
    frontend ラベルで、PLAN.md上は **UX** 見出し配下に置かれており矛盾なし。
  - リンクの書式・配置(チェックボックス本文の直後にインデント6スペースで
    リンク行を置く)は、他ステップ・バックログの既存項目と一貫している。
  - #157 のチェックボックスは `[x]`(設計済み)だがIssueはOPEN。クローズは
    PR本文の `Closes #157` によるマージ時自動クローズに委ねる規約どおりで
    問題なし(この`[x]`と「§6.10 の判断4点は確定済み」の記述自体は今回の
    差分外の既存記述)。
  - Issue本文も抜き取りで確認(#157/#160/#169): ARCHITECTURE.md §6 や
    Issue #86 への参照など、設計成果物と整合する内容だった。
  - `pnpm lint` がリポジトリ全体で通ることを確認した(exit 0)。
- 決定事項・注意点:
  - QA(chainviz-qa)はdocsのみの変更のため省略可とする依頼元の判断を
    了承(CLAUDE.mdの例外規定に該当)。
  - 未コミットの状態でのレビューのため、コミット時は docs のみの1コミット
    (Conventional Commits の `docs:`)とすること。
  - このブランチのPR作成時、#157 を閉じるなら本文に `Closes #157` を
    Issueごとのキーワードで明記すること(統括への申し送り)。
  - push・PR作成・マージは統括の判断に委ねる。


### 2026-07-07 新Phase4(C層拡張)設計フェーズ PR #170 の実機検証(QA)

- 担当: chainviz-qa
- 対象: ブランチ design-phase4-contract-visibility / PR #170
  (packages/shared の型変更 + packages/frontend の機械的追従 + docs)
- 経緯: reviewer は「実行時に観測可能な動作変化が無い」としてQA省略を提案したが、
  統括の判断で CLAUDE.md の例外規定(docs/・.claude/agents/ 配下のみ)の対象外
  (packages のコード変更を含む)と整理され、実機検証を実施した。
- 検証内容と結果(いずれも合格):
  1. ビルド・lint・テストの独立再実行: `pnpm lint`(exit 0)、`pnpm build`
     (shared/collector/frontend/e2e 全て成功)、`pnpm test` 全パッケージ green
     (shared 40 / うち protocol 10・entities 26・chain-profile 2・events 2、
     collector 719、frontend 791、e2e 34)。
  2. frontend の実機起動確認: VITE_COLLECTOR_URL 未設定(モッククライアント)で
     `build:web` → `vite preview` を起動し、ヘッドレス chromium で描画を確認。
     ノードカード(chainviz-lighthouse-1 / reth-1 / reth-2)、reth 間の P2P
     エッジ、ワークベンチ(alice)、ウォレット2件(EOA・残高/nonce・pending tx)、
     所有エッジ、ワークベンチ→reth の操作エッジが全て描画され、Phase1〜3 の
     既存機能に欠落・崩れは無い。DOM ダンプでも同要素の存在を確認し、
     エラーオーバーレイ(vite-error-overlay 等)・非良性のコンソールエラーは
     ゼロ(ResizeObserver loop の警告のみで無害)。
  3. 型変更が既存 UI/ロジックと衝突しないこと: Command union への
     runWorkbenchOperation 追加は collector の handler.ts が default ケースを
     持つため未対応でも型エラーにならず(この設計フェーズでは collector 実装は
     範囲外)、frontend の commandMessages.ts / i18n messages.ts / mockData.ts の
     機械的追従もビルド・実行時ともに問題なし。mockData の runWorkbenchOperation
     は ok:false(未サポート)を返すが、これを叩く UI はまだ無く(ステップ8の
     frontend 範囲)既存表示に影響しない。
  4. ContractEntity の abiRef 削除の波及確認: リポジトリ全体を grep し、
     abiRef の参照が packages・docs のいずれにも残っていないことを確認
     (置換漏れ・ダングリング参照なし)。
  5. ドキュメント整合性: CONCEPT.md のロードマップ改番(新Phase4=コントラクト
     可視化、旧Phase4以降を1つずつ後送り)、PLAN.md ステップ8、ARCHITECTURE.md
     §2〜§6 が packages/shared の実コードと矛盾しないことをフィールド名単位で
     照合(WorkbenchOperation / subscribeContracts / tokenBalances /
     TokenBalance / contractCall / contractEvents / createdContractAddress /
     catalogKey / deployerAddress / createdByTxHash / ContractCall /
     ContractEvent / DecodedArgument / rawFunctionId / rawEventId、および
     ContractEntity の形 chainType/name?/catalogKey?/token?{symbol,decimals})。
     ARCHITECTURE.md 側にも旧 abiRef の記述は残っていない。
- 判定: 合格。今回の型変更・機械的追従は既存の動くもの(Phase1〜3)を壊して
  いない。新機能本体(コントラクトカード表示・デプロイ検知等)はこのPRの範囲外で
  あり、未実装であること自体は失格理由にしない。
- 注意点・申し送り:
  - このステップ8には qa 担当と明記されたチェックボックスが無い(実装項目
    #158〜#169 は今後の作業、#157 は UX が対応済み)ため、PLAN.md 側で QA が
    付けるべきチェックは無い。
  - push・PR作成・マージ・Issueクローズは統括の判断に委ねる(QAは実行しない)。
  - ヘッドレス表示では日本語が豆腐(□)になったが、これは検証環境に CJK
    フォントが無いためで、アプリの不具合ではない(ラテン文字・数値・
    レイアウトは正常)。

### 2026-07-08 Phase 5(D層: ノード内部)設計メモ

- 担当: designer
- ブランチ: design-phase5-node-internals
- 内容: Phase 5(D層)の設計。packages/sharedの型定義まで実装し、実装ロジックは
  各担当への引き継ぎ事項とした。設計本文は docs/ARCHITECTURE.md §7、ステップの
  分解は docs/PLAN.md ステップ9。
  - 現状確認: profiles/ethereum は既に reth(EL)+lighthouse(CL)のEngine API
    構成(8551+JWT)であり、CONCEPT.mdの「EL/CL構成にして」は構成変更不要。
    フロントに「レイヤー切り替え」機構は存在せず、A〜C層は同一キャンバス
    共存であることをコードで確認した(D層も共存で設計)。
  - 型追加(packages/shared、ビルド・lint・全テストgreenを確認済み):
    NodeEntity.drivesNodeId?(駆動関係。rpcTargetNodeIdと同じ省略流儀)、
    NodeEntity.internals?: NodeInternals(syncStages/mempool)、
    NodeLinkActivity+InternalCallStats(揮発性の増分観測)、
    DiffEventにnodeLinkActivity、ChainAdapter.subscribeNodeInternals?(省略可)。
  - 主要な設計判断:
    1. Kurtosis不採用(compose構成が安定稼働、移行はaddNode/genesis再生成/E2Eの
       前提を壊す)。CONCEPT.md未決事項に記録。
    2. データ源はPrometheusメトリクスのみ(構造化ログのパースは採らない)。
       Engine APIは受け手のreth側メトリクスで観測(lighthouse側の有効化は不要)。
    3. Engine API呼び出しは「観測間隔内の増分」として揮発性イベントで配信
       (Prometheusカウンタから個々の呼び出しは復元できないため。
       operationObservedとの粒度の違いを型コメントに明記)。
    4. CL→ELの駆動関係は snapshot.edges ではなく NodeEntity.drivesNodeId から
       フロントが導出(所有エッジ・操作先エッジと同じ流儀)。
    5. internalsはstoreへのパッチで反映。pollInfraの出力にinternalsキーが
       無い限りfieldPatchは上書きしないため、A層ポーリングと衝突しない
       (store.ts/diff.tsの実装を確認して判断)。
- 決定事項・注意点(実装担当へ):
  - rethのメトリクス名(engine系カウンタ・reth_sync_checkpoint・
    transaction_pool系)は候補であり、実装時に実環境の/metrics出力で確定する
    こと。イメージが:latestのため、欠落時はフィールド省略の縮退動作にする。
  - reth_sync_checkpointが追従運転(Engine API駆動)中も進むかは未確認。
    実測し、syncStatus/blockHeight更新(現状常にsyncing/0の既知ギャップ)の
    情報源決定に使うこと(ARCHITECTURE.md §7.3)。
  - スクレイプ間隔3秒は「slot time 2秒なら毎スクレイプ1〜2件の増分が出て
    パルスが連続的に見える」前提のサンプリング周期。前提をコードコメントにも
    書くこと。カウンタリセット(再起動)は増分=現在値として扱う。
  - reth-node.shへの--metrics追加は、動的追加ノードも同スクリプトを使うため
    1箇所で両方に効く(node-lifecycle.tsのentrypoint確認済み)。
  - UXへ委ねる項目(表示密度・パルス粒度・文言・用語定義)はARCHITECTURE.md
    §7.5に列挙した。スキーマ変更を伴わない範囲に限定してある。

### 2026-07-08 Phase 5(D層: ノード内部)UX設計メモ

- 担当: ux
- ブランチ: design-phase5-node-internals
- 内容: ARCHITECTURE.md §7.5 の委譲4項目(内部リンクエッジ・パルスの見た目、
  同期ステージ・mempool内訳の見せ方、表示密度の制御、D層用語)のUX設計。
  成果物は ARCHITECTURE.md §7.6(frontendへの着手指示を兼ねる)。設計前に
  frontendをモックデータで起動しPlaywrightで実画面を確認した(beacon/rethの
  カードが無関係な2枚に見える、addNodeフォロワーの詳細が「同期中・ブロック高
  0」のまま動かない、等の課題を実際に確認)。
- 主要な設計判断(§7.6.10 の4点は推奨案として統括確認待ち):
  1. D層はA〜C層と同一キャンバス共存。表示切り替え・フィルタは導入しない
     (内部リンクはペア数分しか増えない・既存層に切り替え機構が無い・実害が
     出てからA〜D一貫の仕組みとして別Issue化)。
  2. 内部リンクエッジは無彩色シルバー(候補 #c9d4e8)の二重線(鞘+芯)。
     「有彩色=ネットワーク/チェーン上の関係、無彩色=ノード内部の機構」で
     色の系統を分ける。矢印なし(方向はパルスが伝える)。ホバーで
     PeerEdgePopover同型のポップオーバー(説明文+直近観測のメソッド別増分。
     最終観測から10秒で「最近の呼び出しはありません」に切替)。
  3. 活動パルスは1観測=1本(メソッド別に分けない)。カウンタ増分から個々の
     呼び出しは復元できないため「パルス1本=間隔内の1回以上の呼び出し」と
     視覚・用語解説の両方で誠実に伝える。到達演出は追加せず、既存のブロック
     伝播発光とのタイミング一致で因果を見せる。
  4. 同期ステージはポップオーバーに全件(表示名+checkpoint+ミニバー。分母は
     キャンバス上の全ELノードのblockHeight最大値)。加えてsyncing中のELカード
     面のみ「同期中: {ステージ} {checkpoint}/{目標}」の1行+バーを常設し、
     addNode後のバックフィルを目立たせる(syncedで消える)。
  5. txpoolはポップオーバーのみ(pending/queued)。C層glossaryのmempool
     (チェーン全体の概念)とD層txpool(ノード内実体)をrelatedTermsで相互
     リンクし概念と実体の対応を学べるようにする。
  6. ステージ表示名(Headers→ヘッダ取得等)とEngine APIメソッド分類ラベル
     (engine_newPayload→ブロックの実行依頼等)はchain-profiles/ethereum/の
     静的データに置く(チェーン固有語彙の解釈はフロント表現セットの責務)。
     生ステージ名は実装時に実環境の/metricsで確定すること。
  7. 用語はd-internal.yamlにengine-api / el-cl-separation / staged-sync /
     txpoolの4件。全用語にUIアンカーを対応済み(§7.6.9の表)。
- 実装担当への注意点:
  - i18n文言(§7.6.8)は初稿。語調の微調整はfrontend裁量、構成・意味の変更は
    不可。英語訳はi18n担当のレビュー対象。
  - エッジポップオーバー用の「エッジごとの最終観測」はstoreに畳み込まず
    描画側ローカルstateで保持する(operationPulsesと同じ分離経路)。
  - カード面の進行表示の「現在のステージ」は配列順で最初のcheckpoint<目標高。
    目標高が0/導出不能ならバー無しでステージ名+checkpointのみに縮退。

### 2026-07-08 Phase 5(D層: ノード内部)設計フェーズのレビュー

- 担当: reviewer
- 対象: ブランチ design-phase5-node-internals(未コミットの作業ツリー)。
  docs(CONCEPT.md 未決事項・ARCHITECTURE.md §7/§7.6・PLAN.md ステップ9・
  worklog)+ packages/shared の型追加(NodeEntity.drivesNodeId/internals、
  NodeInternals、SyncStageProgress、InternalCallStats、NodeLinkActivity、
  DiffEvent.nodeLinkActivity、ChainAdapter.subscribeNodeInternals)+
  tester のテスト強化。
- 結果: **合格**(修正指示なし)。
- 確認内容:
  1. EL/CL 構成の実態: profiles/ethereum/docker-compose.yml と
     scripts/reth-node.sh を実地確認。reth(EL)+ lighthouse(CL)が
     EXECUTION_ENDPOINT http://rethN:8551 + /genesis/jwt/jwtsecret で
     接続される構成が Phase 2 以降既に存在し、「EL/CL 構成にして」は構成
     変更不要・Kurtosis 不採用という designer の判断根拠は正しい。
     reth-node.sh は compose 起動ノードと addNode 動的追加ノード
     (node-lifecycle.ts が同スクリプトを bind mount)の両方で共用されて
     おり、「--metrics 追加は1箇所で両方に効く」も実装確認済み。
  2. 設計原則との整合: Prometheus メトリクスの語彙(メトリクス名・スクレイプ)
     は collector(EthereumAdapter)と node-env に閉じ、packages/shared の
     スキーマは中立語彙(drivesNodeId=駆動関係、internals、method=生識別子)
     のみ。ステージ表示名・Engine API メソッド分類はフロントのチェーン
     プロファイル表現セットの静的データに置く設計で、ChainAdapter 境界・
     データとコードの分離・プロファイル単位の増設のいずれにも適合。
     reth メトリクス名が未確定な点は「候補として明記+実測で確定+欠落時は
     フィールド省略の縮退」と設計されており、実装時に破綻しない。
  3. 型変更: subscribeNodeInternals は省略可能で、既存アダプタ・collector
     の配線を壊さない(全パッケージのビルドが通ることで確認)。drivesNodeId
     は rpcTargetNodeId と同じ「参照整合性を型で保証しない生 id + フロントの
     ダングリングガード」の既存流儀に一致し妥当。
  4. UX 設計(§7.6): 既存の表現体系(カード=要約/ホバー=詳細、エッジの
     色体系、useOperationPulses の分離経路)との一貫性を確認。「パルス1本=
     観測間隔内の1回以上の呼び出し」を視覚と用語解説の両方で明示する設計は
     増分観測という性質に誠実。§7.6.10 の確定4点(切り替え不採用・1観測
     1本・カード常設は進行1行のみ・無彩色二重線)はいずれも本文の理由付けが
     成立しており妥当。
  5. 固定値の前提明記: スクレイプ間隔3秒(slot 2秒前提)・最終観測10秒での
     表示切替(3秒×3回+余裕)はいずれも前提条件が本文に明記されており、
     CLAUDE.md「観測できる状態への依存」ルールに適合。実装時は 10 秒を
     スクレイプ間隔定数から導出する形が望ましい(実装担当への注意)。
  6. テストの質: falsy 0(checkpoint/latencyMs/pending/queued)の保持、
     空配列と省略の区別、バージョン付きメソッド名の生値保持、optional 購読口
     2つの独立性、DiffEvent 全7種の網羅 switch(never による網羅性の番人)
     など、型契約として意味のある検証になっている。JSON 往復テストは shared
     パッケージの既存流儀(型契約の文書化+コンパイル時検証)に一致。
  7. pnpm lint / pnpm build / pnpm test を全て実行し green
     (shared 58 / collector 944 / frontend 1205 / e2e 34)。
- 非ブロッキングの指摘(統括への申し送り):
  - PLAN.md ステップ9は milestone リンク未設定・UX 項目([x]済み)に Issue
    番号リンクが無い。ステップ8の前例(#157)どおり、着手時の Issue 化の際に
    UX 設計にも Issue を割り当てて遡ってリンクすること。
  - 未コミットのため、コミット時は Phase4 設計フェーズの前例(feat(shared)
    型追加 / docs(ux) / docs 記録)に倣い関心事ごとに分割すること。
  - QA の要否: Phase4 設計フェーズ(PR #170)では reviewer の QA 省略提案を
    統括が却下し実機検証(独立ビルド・テスト再実行+frontend モック起動での
    既存機能非退行確認)を実施した記録がある(2026-07-07 の QA 記録)。
    本件も packages/shared のコード変更を含み CLAUDE.md の QA 省略例外
    (docs/・.claude/agents/ のみ)の対象外のため、同等の軽量 QA を
    chainviz-qa で実施すべき。

### 2026-07-08 Phase 5(D層: ノード内部)設計フェーズの実機検証(QA)

- 担当: chainviz-qa
- 対象: ブランチ design-phase5-node-internals(未コミットの作業ツリー)。
  packages/shared の型追加(NodeEntity.drivesNodeId/internals、NodeInternals、
  SyncStageProgress、InternalCallStats、NodeLinkActivity、
  DiffEvent.nodeLinkActivity、ChainAdapter.subscribeNodeInternals /
  NodeInternalsHandlers)+ docs(CONCEPT.md 未決事項・ARCHITECTURE.md §7/§7.6・
  PLAN.md ステップ9・worklog)+ tester のテスト強化。
- 経緯: reviewer が Phase4 設計フェーズ(PR #170)と同等の軽量 QA を提案。
  packages/shared のコード変更を含み CLAUDE.md の QA 省略例外(docs/・
  .claude/agents/ のみ)の対象外のため実施した。新機能本体(D層データの実際の
  観測・可視化)は未実装であり、それが「見えない」ことは失格理由にしない。
- 検証内容と結果(いずれも合格):
  1. 既存ノード環境への影響: `git status` / `git diff main -- profiles/` で
     profiles/ 配下に変更が無いことを確認。reth-node.sh への --metrics 追加
     等はこのフェーズ未実施(実装ステップ待ち)で設計どおり。
  2. ビルド・lint・テストの独立再実行: `pnpm lint`(exit 0)、`pnpm build`
     (exit 0、全パッケージ成功)、`pnpm test`(exit 0)。テスト件数は
     shared 58 / collector 944 / frontend 1205 / e2e 34 で全 green。
     reviewer 報告の件数と一致。
  3. frontend の実機起動での既存機能非退行: VITE_COLLECTOR_URL 未設定
     (モッククライアント)で `build:web` → `vite preview`(127.0.0.1:15180)を
     起動し、ヘッドレス chromium で描画とDOMを確認。接続バッジ「接続済み」、
     ノードカード3枚(chainviz-lighthouse-1 / reth-1 / reth-2、bootnode
     バッジ2件・同期済みステータス)、ワークベンチ(alice、操作UI)、ウォレット
     3枚(EOA・残高/nonce・トークン残高チップ・pending tx・orphan表示)、
     コントラクトカード3枚(Counter / ChainvizToken / 未知コントラクト、
     activity チップ)が全て描画。エッジは peer / ownership / deploy /
     operation / interaction / desc が描画され、Phase1〜4 の既存機能に欠落・
     崩れは無い。vite-error-overlay は0件、非良性のコンソールエラーも無し。
  4. 型変更の非破壊性: 追加フィールドは全て optional / 追加 union メンバーで、
     ChainAdapter.subscribeNodeInternals も省略可。既存アダプタ・collector の
     配線を壊さない(全パッケージのビルド・テスト green で確認)。drivesNodeId
     は rpcTargetNodeId と同じ「生 id + フロントのダングリングガード」の既存
     流儀に一致。
  5. ドキュメント整合性: entities.ts / events/index.ts / chain-profile/index.ts
     の実コードと ARCHITECTURE.md §7・CONCEPT.md 未決事項・PLAN.md ステップ9 を
     照合し、フィールド名・型の記述に矛盾なし。
- 判定: 合格。今回の型変更・テスト強化・docs は既存の動くもの(Phase1〜4)を
  壊していない。新機能本体(D層観測・可視化)はこのフェーズの範囲外で未実装で
  あること自体は失格理由にしない。
- 注意点・申し送り:
  - PLAN.md ステップ9 に qa 担当と明記されたチェックボックスは無い(実装項目は
    今後の作業、UX 項目は [x] 済み)ため、PLAN.md 側で QA が付けるチェックは
    無い(Phase4 設計フェーズと同じ)。
  - push・PR作成・マージ・Issueクローズは統括の判断に委ねる(QAは実行しない)。
  - ヘッドレス表示では日本語が豆腐(□)になるが、検証環境に CJK フォントが
    無いためで、アプリの不具合ではない(ラテン文字・数値・レイアウトは正常。
    Phase4 QA と同じ環境要因)。検証で起動した preview は後始末済み
    (ポート15180 解放確認)。profiles/ の共有 Docker スタックには一切触れていない。

### 2026-07-08 ステップ9のIssue起票に伴う docs/PLAN.md へのIssueリンク追記のレビュー
- 担当: reviewer
- ブランチ: design-phase5-node-internals
- 内容: docs/PLAN.md ステップ9(Phase5実装 — D層)への milestone リンクと
  Issue リンク(#183〜#191)追記(未コミットの docs のみの変更)を静的レビュー
  した。
- 確認内容と結果(いずれも合格):
  1. Issue との対応: #183〜#191 の全9件を `gh issue view` で確認。各
     チェックボックスの内容と Issue のタイトル・本文が一致し、リンク先の
     番号の取り違えは無い。担当ラベル(UX=frontend 1件・node-env 1件・
     collector 3件・frontend 3件・e2e 1件=collector ラベル)も PLAN.md の
     セクション分けと整合。e2e を collector ラベルにするのは過去の e2e
     Issue(#51〜#54 等)の慣例どおり。全 Issue が milestone
     「Phase 5: D層(ノード内部可視化)」(milestone #8)に紐付いている。
  2. 記述形式の一貫性: milestone リンクは既存ステップと同じ
     `GitHub: [milestone](URL)` 形式、Issue リンクは既存ステップと同じ
     「チェックボックス本文末尾に6スペースインデントで
     `[#番号](URL)`」形式で一貫している。
  3. milestone URL: `https://github.com/morichikawa/chainviz/milestone/8` が
     実在し、ステップ9に対応する milestone であることを GitHub API で確認。
  4. #183(UX設計)のみ [x] 済みだが、Issue 自体は OPEN。クローズは PR マージ
     時の自動クローズに委ねる運用どおりで問題ない。
- 判定: 合格。docs/ のみの変更(コード変更なし)のため、CLAUDE.md の例外規定
  により chainviz-qa は省略してよい。
- 注意点・申し送り: milestone のタイトルは #1〜#6 が「ステップN:」接頭辞
  付き、#7〜#8 が Phase 名のみで命名が揺れているが、直近の #7 の前例に
  沿っており PLAN.md 側の記述の問題ではない(気になるなら統括判断で改名可)。

### 2026-07-08 設計メモ: E2E テストの Playwright 移行(UI シナリオテスト)
- 担当: designer
- ブランチ: design-e2e-playwright-migration
- 内容: ユーザー指示「E2E は Playwright で。自然言語ベース(箇条書き)の
  シナリオで基本操作から異常系まで網羅。UI でやれるところは全部 UI で。
  既存分も見直し、今後も追加し続ける」を受けた設計。成果物は
  `docs/ARCHITECTURE.md` §8(二層構成・起動トポロジ・シナリオ記法・計装
  方針・実測値)、`packages/e2e/SCENARIOS.md`(シナリオカタログ。既存 WS
  テストの棚卸し表 + UI シナリオ 24 件 + 残すプロトコル層シナリオ 10 件)、
  `docs/PLAN.md` の新ステップ 10(チェックボックス 7 件。旧「ステップ 10
  以降」は 11 以降へ繰り下げ)、`packages/e2e/package.json` への
  `@playwright/test` 追加。
- 設計上の主な判断:
  1. 二層構成: UI で同等以上に検証できる WS テストは Playwright へ一本化
     (両層とも実 Docker 相手で、重複させると実行時間が倍加するため)。
     UI から到達不能な検証(不正フレーム・不正コマンド・タイミング競合・
     ポート衝突・receivedAt の数値検証・RPC でのブロック追従判定)は
     プロトコル層(vitest + ws)に残す。WS 版の削除は対応する UI シナリオが
     green になったコミットと同時(空白期間を作らない)。
  2. パッケージは新設せず `packages/e2e` に同居(helpers のハーネスを両層で
     共有するため)。Playwright は `src/ui/*.spec.ts` + playwright.config.ts。
     vitest の include(`*.test.ts`)と重ならない。
  3. 排他ロック(`helpers/e2e-lock.ts`)は既定パスのまま Playwright の
     globalSetup でも取得し、`test:e2e` と `test:e2e:ui` の同時実行を防ぐ。
  4. ポートは UI 層専用に collector 4125 / frontend 5275 を割り当て
     (dev 4000/5173・vitest e2e 4123・衝突テスト 4199 と重ねない)。
  5. シナリオ記法は Gherkin(cucumber)を採用せず、SCENARIOS.md(Markdown
     箇条書き、前提/操作/確認)を正として `test()` タイトルにシナリオ ID、
     各箇条書きを `test.step()` で同文実装する方式。依存と間接層を増やさず
     同等の可読性を得るため。
  6. pre-push フックの `pnpm test` には UI 層も含めない(既存方針を維持)。
- 実測・実証(2026-07-08、WSL2):
  - 既存プロトコル層 21 テストはスタックのコールドスタート込みで 3 分 07 秒
    (全 green)。vite dev の起動は 0.6 秒。
  - `@playwright/test` 1.61.1 + chromium で、vite dev(モックモード)に対する
    起動・DOM 操作・ロケータ取得が成立することをスモークスクリプトで実証
    (カード 7 枚・ツールバー・エッジ 6 本を検出)。
  - **注意**: このホストは chromium のシステムライブラリ(libnspr4 /
    libnss3 / libasound2 等)が未導入で、`playwright install chromium`
    だけでは起動しない。実装 Issue では `sudo playwright install-deps`
    等の導入(または LD_LIBRARY_PATH での注入)が前提。CONTRIBUTING.md への
    記載をステップ 10 の基盤導入チェックボックスに含めた。
- 決定事項・注意点(実装担当への申し送り):
  - frontend の計装は追加が必要(接続バッジ・ツールバー・言語トグル・
    用語/インフラポップオーバー)。カード類は 34 箇所計装済み。React Flow
    エッジは `data-id` で特定できるため追加不要。
  - frontend の WebSocket クライアントは自動再接続を持たない(仕様)。
    再接続系 UI シナリオはリロードで表現する(UI-ERR-01 / UI-MULTI-02)。
  - PROTO-CMD-01(ブロック追従)は現在 addNode テストの副産物に依存して
    いるため、UI 移行時に addNode 送信を自己完結する形へ再構成が必要。
  - UI-ERR-02(collector 停止中の追加操作)の実挙動(60 秒のゴースト
    タイムアウト後のトースト)は実装時に確認し、シナリオ記述を実態に
    合わせて確定させること。
  - UI-D(D層シナリオ)はステップ 9 の #188/#189 完了が前提。#191(WS レベルの
    D層 E2E)はプロトコル層として従来どおりステップ 9 で実装する。

### 2026-07-08 レビュー: E2E テストの Playwright 移行(設計)
- 担当: reviewer
- ブランチ: design-e2e-playwright-migration(worktree)
- 結果: **合格**(軽微な記録訂正1件と実装時の申し送り2件あり。差し戻しなし)
- 確認した内容:
  - 棚卸しの正確性: 既存 E2E 5 ファイルを全読し、テスト数 21 件
    (a-b-layer 3 / commands 6 / error-paths 6 / reconnect 5 / port-collision 1)
    が SCENARIOS.md §1 の棚卸し表(移行 8 行・残す 10 行)と過不足なく対応
    することを確認。「compose 起動ノードの削除拒否はプロトコル層のみ」の
    判断は InfraNodeCard.tsx が `entity.removable === true` のときだけ削除
    ボタンを描画する実装(テストも既存)と整合し正しい。「ブロック追従は
    RPC 判定」も、waitForBlockCatchUp の動的タイムアウト+進捗停止検出に
    よる数値判定が UI から再現不能なため正しい
  - ポート設計: collector 既定 4000 / vitest e2e 4123 / 衝突テスト 4199 /
    vite dev 5173 を実コードで確認し、UI 層の 4125/5275 が衝突しないこと
    を確認。排他ロックは e2e-lock.ts の既定パス(os.tmpdir() 固定)共用で
    worktree をまたいで有効
  - pre-push 整合: root `pnpm test` → e2e は vitest.unit.config.ts
    (`*.unit.test.ts` のみ)で、`src/ui/*.spec.ts` はどの vitest include
    にも合致しない。PLAN ステップ 10 の完了条件にも明記済み
  - シナリオ記法: Markdown(前提/操作/確認)+ `test.step()` 同文実装は
    ユーザー要望「自然言語ベース(箇条書き)」を満たす。Gherkin 不採用の
    理由(間接層・依存増)も妥当
  - 検証: `pnpm lint && pnpm build && pnpm test` 全通過。vite dev 起動を
    実測(81ms。設計メモの 0.6 秒と整合)。playwright-core 1.61.1 の要求
    chromium revision 1228 が ~/.cache/ms-playwright に配置済みであること、
    ldconfig に libnspr4/libnss3/libasound が 1 件も無いこと(設計メモの
    環境注意と一致。issue-165 等の過去 QA の deb 展開記録とも整合)を確認。
    プロトコル層 21 テストのフル実行(実 Docker)の再現は QA に委ねる
  - コミット粒度: 5 コミットすべて単一関心事で規約どおり
- 記録の訂正: 上記設計メモの「UI シナリオ 24 件」は誤りで、実数は
  **32 件**(UI-CONN 1 / UI-A 5 / UI-B 3 / UI-CMD 7 / UI-C 7 / UI-D 3 /
  UI-ERR 4 / UI-MULTI 2)。プロトコル層 10 件は正しい
- 実装担当(ステップ 10-1 以降)への申し送り:
  - Playwright の既定 testMatch は `*.test.ts` も拾うため、
    playwright.config.ts では `testDir` を `src/ui` に限定すること
    (さもないとプロトコル層の vitest ファイルを Playwright が誤実行する。
    ARCHITECTURE §8.2 は vitest 側の非重複しか述べていない)
  - UI-ERR-01/02 は共有 collector(4125)を停止させるため、他シナリオと
    並列実行すると巻き添えで失敗する。単一 Docker スタック共有の性質上、
    UI 層は workers=1(直列)を基本とするか、UI-ERR 系だけ専用 collector
    ポートで隔離すること(設計文書に並列度の記述が無いため実装時に確定)

### 2026-07-08 QA検証: E2E テストの Playwright 移行(設計)
- 担当: qa
- ブランチ: design-e2e-playwright-migration(worktree)
- 結果: **合格**(この設計フェーズで実機確認できる範囲はすべて確認。差し戻しなし)
- このフェーズは設計・シナリオ確定のみで、Playwright テストの実装コードは
  未着手。以下は実機で確認できる範囲を検証した。
- 確認した内容:
  - 静的ゲート(独立実行): `pnpm install --frozen-lockfile`(lockfile 変更なし)、
    `pnpm lint`(clean)、`pnpm build`(shared/collector/frontend/e2e 全 OK)、
    `pnpm test` 全通過(shared 58 / collector 1026 / frontend 1205 /
    e2e ユニット 34)。package.json への @playwright/test 追加は既存の
    ビルド・テストに影響していない。
  - 既存プロトコル層テストの健全性: `vitest list`(e2e 設定)で 21 件の
    テストがすべて収集されることを確認(a-b-layer 3 / commands 6 /
    error-paths 6 / reconnect 5 / port-collision 1)。SCENARIOS.md §1 の
    棚卸し・§3 の PROTO 表と一致。これらのテストは ws とヘルパのみを
    import し @playwright/test に依存しないため、今回の依存追加は
    ランタイム挙動に影響しない。
  - Playwright chromium の実行可否: この環境では headless_shell が
    libnspr4/libnss3/libasound2 を欠き起動失敗することを実際の launch で
    再現(reviewer 報告と一致)。過去 QA の手法(`apt-get download` で
    libnspr4 / libnss3 / libasound2t64 の deb を取得 → `dpkg-deb -x` で展開
    → `LD_LIBRARY_PATH` に追加)で headless chromium の起動・DOM 描画・
    data-testid ロケータ取得まで成功することを確認。root 権限なしで UI 層
    テストを回せる回避策が有効(実装フェーズ・CONTRIBUTING 記載の参考)。
  - ドキュメント整合性: SCENARIOS.md の UI シナリオは 32 件
    (CONN1/A5/B3/CMD7/C7/D3/ERR4/MULTI2)、PROTO は 10 件で、§1「残す」
    10 行と §3 表が一致。ARCHITECTURE §8.6 の「プロトコル層 21 テスト」も
    実数と一致。`pnpm test:e2e:ui` は §8.2/§8.3・PLAN §10 で配線予定の
    成果物として言及され、package.json に未追加なのは設計フェーズとして
    整合。矛盾は見つからなかった。
- 実機で「今回は実行しなかった」項目とその理由:
  - フル Docker 実行(21 テストの実走): 依頼元より「本物の稼働中スタックに
    は触れないでください」との明示指示があり、現在ホスト上で
    chainviz-ethereum スタック(6 ノード + ワークベンチ)が稼働中。E2E
    ハーネスは稼働中スタックを再利用する設計(ensureChainRunning が
    172.28.1.1 の健全性を見て再利用)で、フル実行すると managed ノードの
    追加・削除でこのスタックに触れるため、隔離した別スタックでの実行は
    現ハーネス構成では不可能。指示を優先し、フル実行は行わなかった。
    なお実行時点で当該スタックに接続中の collector(4000)/frontend/e2e
    ロックは無く(能動的な利用者は検出されず)、統括が「このスタックは
    使い捨ててよい」と判断すれば低リスクでフル実行可能。判断は統括に委ねる。
- PLAN §10 のチェックボックスは全て実装タスク(未着手)であり、この設計
  フェーズで qa がチェックを付ける項目は無い。

### 2026-07-08 E2Eプロトコル層21テストのフル実走検証(qa)

- 担当: qa(検証)
- ブランチ: design-e2e-playwright-migration
- 背景: 前回検証で「稼働中のchainviz-ethereumスタックに触れるため見送り」と
  していたフル実走について、統括がユーザーに確認し「このスタックは使い捨てて
  よい(触れてよい)」との回答を得たため、実際に実行して検証した。
- 実施内容: `pnpm --filter @chainviz/e2e test:e2e` を稼働中の
  chainviz-ethereumスタック(6ノード + ワークベンチ)を再利用する形で実行。
- 結果: 21件すべて合格(合格)。
  - reconnect 5 / error-paths 6 / commands 6 / a-b-layer 3 /
    collector-port-collision 1、Test Files 5 passed、Duration 約262秒。
  - package.json への @playwright/test 追加後もプロトコル層テストの
    ランタイム挙動に影響が無いことを実走で確認した(これらのテストは ws と
    ヘルパのみ import し @playwright/test に依存しない)。
- 実行後のスタック状態確認(放置破損が無いことの確認):
  - コンテナ数は実行前と同じ8個に戻っており(reth1/reth2, beacon1/beacon2,
    validator1/validator2, workbench の稼働7 + genesis の Exited(0) 1)、
    addNode/addWorkbench で動的に追加されたコンテナは afterAll で正しく
    クリーンアップされ、orphan コンテナは残っていない。
  - reth1(172.28.1.1:8545)の eth_blockNumber が 0x4ec→0x4ef と6秒で進行
    しており、チェーンは健全に稼働継続している。
- 結論: 完了条件(既存21テストが依存追加後も全通過)を満たす。スタックも
  破損せず稼働継続。
