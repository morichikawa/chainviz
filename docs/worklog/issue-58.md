# Issue #58 作業記録

### 2026-07-04 PR #60 ステップ6へのE2E拡張シナリオ(#58・#59)追記のレビュー

- 担当: reviewer
- ブランチ: docs-step6-e2e-expansion
- 内容: docs/PLAN.md ステップ6セクションへの追記(1コミット・9行の
  docs変更)を静的レビューした。結果は合格。
  - 追加された2つのチェックボックスの文言が Issue #58(異常系シナリオ:
    不正なchainProfile・存在しないID・不正なコマンド)・#59(再接続
    シナリオ: 切断→再接続後のスナップショット整合性)のタイトル・本文と
    一致していることを確認した。
  - 両 Issue とも milestone 5(ステップ6)に紐づいており、PLAN.md 上の
    記載位置(ステップ6セクション末尾)と整合する。ラベル collector も
    既存のE2E関連 Issue(#51〜#54)の前例と一致する。
  - 「上記の完了後、...以下を追加する」という但し書きにより、達成済みの
    ステップ6完了条件(チェック済み4項目)と追加分が明確に区別されており、
    矛盾はない。着手順(異常系→再接続)の明記も Issue #59 本文の経緯と
    一致する。
  - コミットは1つ(docsのみ)で Conventional Commits 形式に従っており、
    粒度も適切。
- 決定事項・注意点: Issue #58 には PLAN.md のチェックボックス文言に
  現れない作業(addWorkbench のラベル重複時の挙動確認、collector 側の
  エラー握りつぶし箇所の調査・報告)も含まれる。着手時は Issue 本文を
  正として作業すること。

### 2026-07-04 Issue #58 再々レビュー（CONTRIBUTING.md 差し戻し対応の確認）

- 担当: reviewer
- ブランチ: issue-58-e2e-error-paths
- 内容: 前回レビューの差し戻し1点と再発防止の推奨事項への対応（統括による
  修正）を再レビューした。結果は合格。
  - 差し戻し対応: docs/CONTRIBUTING.md の E2E テスト本体の列挙に
    `error-paths.test.ts` が追記された。`packages/e2e/src/` の実ファイル
    構成、`vitest.config.ts`（include: `src/**/*.test.ts`、exclude:
    `**/*.unit.test.ts`）とも一致することを確認した。
  - 推奨事項対応: CONTRIBUTING.md「前提条件」に「`pnpm test:e2e` は同時に
    複数実行しない」の注意書きが追加された。記述内容（`profiles/ethereum`
    スタックとポート 4123 の共有、`websocket is not open` でのタイムアウト
    という症状、Issue #58 のレビューで特定した経緯）は前回レビューでの
    調査結果・実装（`helpers/collector.ts` の port 4123）と正確に一致する。
  - 恒久対応として Issue #64 が起票済みであることを確認した。本文は
    前回レビューで提案した2案（startCollector の子プロセス所有確認 /
    ホスト単位の flock 排他）と発覚の経緯を正確に記録している。
  - `pnpm lint` は成功（前回レビューからの差分は docs のみで、build/test は
    前回レビューで全パッケージ通過を確認済み）。
- 決定事項・注意点:
  - 任意の改善提案（差し戻しではない）: CONTRIBUTING.md の注意書きは
    Issue #58 のみを参照しているが、恒久対応の追跡先である Issue #64 への
    言及もあると、将来この運用制約を撤廃してよいか判断しやすくなる。
  - 静的レビューとしての差し戻し事項は無し。次は chainviz-qa の検証へ。
  - コミットはまだ無い（意図どおり）。

### 2026-07-04 Issue #58 再レビュー（差し戻し対応の確認とE2E flaky調査）

- 担当: reviewer
- ブランチ: issue-58-e2e-error-paths
- 内容: 前回指摘2点の修正確認と、フルスイート実行時に報告された
  removeWorkbench の60秒タイムアウト（flaky）の原因調査。
  - 修正(1) node-lifecycle.ts の addNode 後始末: `.catch(() => {})` →
    try/catch + `console.error` + 元の beacon エラーを優先して再 throw、
    理由コメントつき。指摘どおりで適切。追加されたユニットテスト
    （後始末も失敗した場合に元のエラーが伝播・後始末の試行・ログ出力まで
    検証）も質は良好。collector 324 テスト。
  - 修正(2) error-paths.test.ts のコメント: 「待機は不要（commandResult は
    CommandHandler が addNode の完了を await した後に返る）」という記述に
    修正済み。websocket-server.ts / handler.ts の実装と一致することを確認した。
  - `pnpm lint` / `pnpm build` / `pnpm test` は全パッケージ通過。
  - `pnpm test:e2e` フルスイートを3回実行。隔離状態（他のテストランなし・
    ポート4123空き）での2回は15件全通過（removeWorkbench は15秒前後で完了）。
    3回目は commands.test.ts の4件が "websocket is not open" で失敗したが、
    docker events とプロセス観測により、**別ワークツリーの E2E ランが同時
    実行されていたことによる干渉**と特定した（調査中に wt-issue56 / wt-issue63
    の `pnpm test:e2e` + collector プロセスの同時稼働を実際に観測）。
- 決定事項・注意点（flaky の真因と再発防止）:
  - E2E ハーネスはホスト上で単一の Docker プロジェクト（chainviz-ethereum）と
    固定ポート4123を共有するが、排他制御が無い。さらに startCollector の
    `canConnect` は「誰かが4123で応答するか」しか見ないため、別ランの
    collector が既に4123を占有していると、自分の collector 子プロセスが
    EADDRINUSE で即死しても**他人の collector に接続してテストが進行**して
    しまう。その状態で相手のランが終了して collector を kill すると、
    こちらの sendCommand は返信を永遠に待って60秒タイムアウトする。
    収集悟が観測した removeWorkbench のタイムアウトはこれで説明でき、
    「docker 負荷による無関係な flaky」ではなく実在の構造的問題。
    残骸コンテナ `chainviz-ethereum-e2e-alice-2-2`（`-2` 付き service 名は
    同一 collector プロセス内で e2e-alice が登録済みのときのみ採番される＝
    2つのランが1つの collector を共有した動かぬ証拠）も観測した。
  - ただしこれは #51-#54 で作られたハーネスの既存設計の問題であり、#58 の
    変更自体の欠陥ではない。隔離実行では2回連続全通過しており #58 は合格。
    再発防止は別 Issue として起票し、(a) スイート全体をホスト上のロック
    ファイル（flock 等）で排他する、(b) startCollector を「自分の子プロセス
    がポートを所有していること」の確認（例: 子プロセスの listening ログ行を
    待つ）に変える、のいずれか/両方を行うこと。CONTRIBUTING.md にも
    「E2E スイートはホストごとに同時に1つだけ実行する」制約を明記すること。
  - 軽微な差し戻し1点: docs/CONTRIBUTING.md の「E2E テスト本体
    (`a-b-layer.test.ts` / `commands.test.ts`)」という列挙に、本 Issue で
    追加した `error-paths.test.ts` が含まれていない。コミット前に追記すること。

### 2026-07-04 Issue #58 レビュー（E2E異常系シナリオ）

- 担当: reviewer
- ブランチ: issue-58-e2e-error-paths
- 内容: `error-paths.test.ts`(6シナリオ)とヘルパー追加(`countProjectContainers` /
  `sendRaw` / `isOpen`)の静的レビュー。`pnpm lint` / `pnpm build` / `pnpm test` は
  全パッケージ通過(collector 323 / frontend 301)。
  - テストの質は良好。エラーメッセージの具体性(`/bitcoin/` の照合で汎用メッセージ
    へのすり替えを検出できる)・コンテナ数不変・不正フレーム送信後の接続維持と
    後続コマンド処理・collector プロセス生存(exitCode null)まで検証しており、
    「壊れたコードでも通るテスト」にはなっていない。不正フレームの commandId
    "bad-cmd" はクライアントの `e2e-<n>` 連番と衝突しないため、後続 sendCommand
    の返信と取り違える競合も無い。commands.test.ts(ハッピーパス)との住み分けも妥当。
  - 握りつぶし3件の判断:
    - (1) `dockerode-operations.ts` `stopAndRemove` の `container.stop()` 全 catch
      → **記録に留めて可**。意図のコメントがあり、後続の `remove({force:true})` が
      実行中コンテナも強制削除しつつ非404エラーを伝播するため、真の失敗は
      remove 側で表面化する(事後条件は担保されている)。任意の改善として catch を
      304/404 に絞る余地はある。
    - (2) `node-lifecycle.ts` `addNode` の後始末 `.catch(() => {})` → **要修正**。
      後始末が失敗すると孤立 reth がA層観測でキャンバスに表示されるのに
      `this.nodes` 未登録のため removeNode で消せない「見えるが消せない」状態に
      なり、その痕跡がどこにも残らない。既存慣行
      (`console.error("[ethereum] ...", err)`)でログを出し、元の beacon エラーを
      優先して再 throw する(後始末エラーに差し替えない)理由をコメントに残すこと
      (CLAUDE.md「品質ゲートを骨抜きにしない運用ルール」)。あわせて「後始末も
      失敗した場合に元の beacon エラーが伝播する」ことのユニットテストを推奨
      (現状は後始末が成功するケースのみテストされている)。
    - (3) `websocket-server.ts` `onMessage` の不正メッセージ黙殺 → **記録に留めて
      可**。不正 JSON 側には理由コメントがあり、挙動自体が今回の E2E で仕様として
      固定された。フロント側バグの調査性向上のための warn ログ追加は後日の
      改善候補とする。
  - その他の指摘: `error-paths.test.ts` の addNode 異常系にある「少し待ってから
    数え直しても増えていないことを確認する」というコメントは、実コードに待機が
    無く実態と不一致。commandResult は CommandHandler が `addNode` の完了を
    await した後に返るため待機自体は不要であり、コメント側を実態に合わせて
    修正すること。
- 決定事項・注意点: 上記(2)のログ追加とテストコメント修正の2点で collector に
  差し戻し。未コミットのため、コミット分割(test(e2e) のヘルパー+テスト /
  collector のログ修正 / docs 更新)にも留意すること。

### 2026-07-04 Issue #58 E2Eテストに異常系シナリオを追加する

- 担当: collector
- ブランチ: issue-58-e2e-error-paths
- 内容: 既存E2E(commands.test.ts)がハッピーパス中心だったため、操作コマンドと
  WebSocketプロトコルの異常系を検証する`packages/e2e/src/error-paths.test.ts`を
  新設した。検証シナリオは以下の6件。
  - addNodeに未対応のchainProfile("bitcoin")を指定 → ok:falseかつエラー
    メッセージにプロファイル名が含まれること、さらにプロジェクトのコンテナ数が
    変化しない(コンテナが一切作られない)ことを確認。コンテナ計数は
    `com.docker.compose.project=chainviz-ethereum`ラベルで絞った`docker ps -a`で行う
    (helpers/docker.tsに`countProjectContainers`を追加)。
  - removeNodeに存在しないnodeId → ok:false。
  - removeWorkbenchに存在しないworkbenchId → ok:false。
  - addWorkbenchでラベル重複 → 拒否ではなく一意化して成功する実挙動を先に
    確認した上でテスト化。同ラベルで2回追加すると2つ目は`<label>-2`のIDで
    別ワークベンチとして共存する(EthereumNodeLifecycle.uniqueWorkbenchService)。
  - 不正JSON・type欠落・未知type・空command本体をWebSocketで送信しても接続が
    切れずcollectorプロセスも落ちず、直後に正常なコマンドを処理できること。
    生フレーム送信のためhelpers/ws-client.tsに`sendRaw`と`isOpen`を追加した。
  - `pnpm test:e2e`で全15件(既存9件+新規6件)が成功することを確認した。
- 決定事項・注意点:
  - エラーハンドリングの握りつぶし調査を実施。CommandHandlerは例外を握りつぶさず
    実際のエラーメッセージ付きでok:falseに変換しており(汎用メッセージへの
    すり替えなし)、エラー時にok:trueを返す箇所は無いことを確認した。
  - 借りの残るコード(バグではないが留意点):
    (1) dockerode-operations.tsのstopAndRemoveで`container.stop()`の例外を
    ログ無しで握りつぶす。「既に停止/不在」を意図した処理だが、真の停止失敗も
    覆い隠す。ただし後続のremoveが非404エラーを伝播するため実害は限定的。
    (2) node-lifecycle.tsのaddNodeでbeacon起動失敗時のreth後始末
    `stopAndRemove(reth.id).catch(() => {})`が後始末失敗をログ無しで握りつぶす
    (孤立コンテナが残っても気づけない。ただし元のbeaconエラーは再throwされok:false)。
    (3) websocket-server.tsのonMessageが不正JSON・非commandメッセージを
    ログ無しで黙って破棄する(仕様どおりだがフロント側のバグが不可視)。
    いずれも明確なバグとは言えず設計判断の範疇のため、本Issueでは修正せず記録に留めた。

### 2026-07-04 Issue #58 E2E異常系シナリオの実機検証(qa)

- 担当: qa
- ブランチ: issue-58-e2e-error-paths
- 内容:
  - 実 Docker(profiles/ethereum の稼働中スタック)+ ビルド済み collector を
    子プロセスとして起動し、異常系 E2E シナリオを実際に動かして検証した。
    実行前に他 worktree で vitest/test:e2e が動いていないことを ps で確認
    (#64 のポート奪い合い回避)。
  - 静的確認: `pnpm lint`(クリーン)/ `pnpm build`(全4パッケージ成功)/
    `pnpm test`(collector 330・frontend 301 すべて通過。E2E本体は混入せず)。
  - E2E: `pnpm test:e2e` 全15テスト成功(所要 約393秒)。内訳は既存9件
    (a-b-layer 3 + commands 6)+ 新規 error-paths.test.ts 6件。error-paths は
    addNode不正chainProfile拒否(コンテナ数不変)・存在しないnodeId/workbenchId
    のremove拒否・ラベル重複の一意化(-2付与)と両方の削除・不正フレーム
    (不正JSON/type欠落/未知type/空command)送信後も接続維持と後続コマンド
    処理・collector子プロセス非クラッシュ、を実プロセス境界越しに確認。
  - CONTRIBUTING.md の E2E テスト本体一覧(a-b-layer / commands /
    error-paths の3ファイル)と同時実行禁止の注意書きが実装と一致することを
    確認。
  - 後片付け: テスト作成の一時ノード/ワークベンチはテスト内で全削除済み。
    検証後に残存 vitest/collector プロセスなし、余分なコンテナなし、ポート
    4123 解放を確認。既存スタック7コンテナは検証前から稼働中のもので変更なし。
- 判定: 合格。ステップ6拡張分(異常系)の完了条件を満たす。
- 注意点: docs/PLAN.md 内で Issue #58 のチェックボックスが2箇所ある。
  ステップ6の当初リスト(既に [x])とその下の「上記の完了後...追加する」
  バックログ項目(現状 [ ] 未チェック)が同一 #58 を指しており重複している。
  実装は完了しているため、後者の未チェック項目の扱い(チェック付与か重複
  解消か)は統括の判断が必要。

