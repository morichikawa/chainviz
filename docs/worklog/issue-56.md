# Issue #56 作業記録

### 2026-07-04 Issue #56 genesis 冪等化のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-56-genesis-idempotent
- 内容: 構築初による genesis サービスの冪等化(完了マーカー方式)を静的に
  レビューした。結果は合格。
  - 完了マーカーの設計を確認。`set -e` の下で全生成処理が成功した最後にのみ
    `touch` するため、途中失敗した実行はマーカーを残さず次回やり直しになる。
    マーカー検出は破壊的な `rm -rf` より前に行われるため、稼働中スタックへの
    `up -d` 再実行で共有ボリューム上の genesis が消される瞬間が無いことも確認。
  - マーカー検出時の `exit 0` はエラーの握りつぶしではなく意図した冪等動作で
    あり、スキップした旨と作り直し手順(`down -v`)をログに明示している。
  - マーカーは名前付きボリューム内(`/data/.genesis-complete`)にあるため、
    `docker compose down -v` でボリュームごと消え、クリーン起動時の再生成
    挙動は保たれている。
  - `docker-compose.yml` / `values.env` / `README.md` の記述が新挙動と一致
    することを確認。E2E ハーネス(`packages/e2e/src/helpers/docker.ts`)の
    変更はコメントのみでロジック変更なし(ユニットテスト追加は不要)。
  - `pnpm lint` / `pnpm build` / `pnpm test`(24ファイル301テスト他)全通過。
    `sh -n` によるスクリプトの構文確認も通過。
- 決定事項・注意点:
  - 軽微な指摘(非ブロッキング): 旧 README の「ノードのデータディレクトリも
    起動時に毎回初期化する」の一文が削除されたが、この挙動自体は
    reth-node.sh / lighthouse-bn.sh / lighthouse-vc.sh で変わらず残っている
    (WORKLOG には記録済み)。README の「冪等性」節に、ノードの datadir は
    従来どおり起動のたびに初期化されること、`down`(-v なし)+`up` では旧
    タイムスタンプの genesis が再利用されることを一言補足するとよい。
  - まだ未コミットのため、コミット時は「1つの変更内容 = 1コミット」に従い、
    少なくとも修正本体(profiles/ 一式 + e2e コメント)と docs
    (PLAN/WORKLOG)を分けること。

### 2026-07-04 Issue #56 genesis サービスの冪等化

- 担当: node-env
- ブランチ: issue-56-genesis-idempotent
- 内容: 稼働中スタックに `docker compose up -d` を再実行すると genesis
  サービスが再走し、`GENESIS_TIMESTAMP` を現在時刻で振り直して共有ボリューム
  上の genesis を上書きしてしまう問題を修正した。上書き後に addNode で新規
  ノードを追加すると、そのノードだけ新しい genesis で init され、既存ノードと
  genesis ハッシュが食い違って EL 間 P2P ハンドシェイクに失敗しブロックへ
  追従できなくなっていた(ステップ6のE2E実装中に発見)。
  - `profiles/ethereum/scripts/generate-genesis.sh` を冪等化した。生成完了時に
    共有ボリュームへ完了マーカー `/data/.genesis-complete` を `touch` し、
    スクリプト冒頭でこのマーカーの存在を確認して、あれば再生成せず `exit 0`
    する。`docker compose down -v` でボリュームを破棄すればマーカーごと消えて
    次回起動時に再生成されるため、クリーン起動の挙動は保たれる。
  - マーカーは生成処理がすべて成功した最後にだけ書く。途中失敗した実行は
    マーカーを残さないため、次回起動時に半端な生成物のままではなくやり直しに
    なる。
  - 挙動変更に合わせて `docker-compose.yml` / `values.env` / `README.md` の
    「起動のたびに再生成する」旨の記述を「初回のみ生成し以降は再利用(冪等)」に
    更新した。README には「冪等性(Issue #56)」節を追加。
  - E2E ハーネス(`packages/e2e/src/helpers/docker.ts`)の「稼働中は up -d を
    呼ばない」回避策のコメントが、根本原因が未修正である前提の記述だったため、
    冪等化済みである旨に更新した。再利用ロジック自体は再生成+同期コストの
    回避として有用なので変更していない。
- 確認結果:
  - `docker compose down -v && up -d` でクリーン起動し、genesis が生成され
    完了マーカーが付き、チェーンが進行(cast で chain-id=1337、ブロックが
    4→7 と増加、reth2 も追従)することを確認。
  - 稼働中に `up -d` を再実行し、genesis サービスがマーカーを検出して
    「再生成せず終了する」ログを出し、genesis.json / genesis.ssz の
    タイムスタンプ・sha256 が変化しないこと(冪等)を確認。
  - 上記の再実行後に reth+beacon の peer ペアを手動追加し、同一 genesis で
    init されて P2P 接続し(peers=1)、既存チェーンにバックフィル追従して
    reth1 と同一の head 高・同一のブロックハッシュに揃うことを確認(修正前は
    ここで失敗していた)。
  - `pnpm test:e2e` を実行し全9件成功(addNode を含む)。
- 決定事項・注意点:
  - genesis の冪等化により、共有ボリュームが存在する限り genesis は初回作成の
    ものが使い続けられる。設定(`values.env`)やフォークスケジュールを変えて
    作り直したいときは `docker compose down -v` が必須になる(README に明記)。
  - reth-node.sh / lighthouse-bn.sh はこれまで通り起動のたびにデータ
    ディレクトリを初期化する。今回は genesis 生成のみを冪等化した。共有
    genesis が固定されたことで、コンテナ再起動時の再 init も常に同一 genesis に
    対して行われるようになった。
