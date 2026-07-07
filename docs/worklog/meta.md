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
