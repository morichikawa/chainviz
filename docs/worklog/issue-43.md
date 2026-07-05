# Issue #43 作業記録

### 2026-07-04 Issue #43 QA検証(qa)

- 担当: qa
- ブランチ: issue-43-beacon-restart-divergence
- 内容: `restart-node.sh`追加とREADME追記(node-env、reviewer合格済み)を
  実機で検証した。結果は合格。バックログ項目でありPLANの専用チェックボックスは
  無い(node-envが該当行を[x]済み)。
- 検証手順と結果:
  1. `docker compose down -v && up -d`でクリーン起動。7サービスすべてrunning、
     ブロックが約2秒に1つ進行、`cast chain-id`=1337・`cast client`(reth
     v2.3.0)でRPC疎通を確認。
  2. 問題再現: `docker compose restart beacon1 beacon2`(beacon単独再起動)で
     block=24のまま60秒以上完全停止。beacon1ログに`Exec engine unable to
     produce payload`/`PayloadIdUnavailable`(the engine is likely syncing)が
     継続することを確認。想定どおりの再現。
  3. 停止状態からの復旧: `./scripts/restart-node.sh 1 2`でノード単位再起動を
     実行し、チェーンがgenesisから進行を再開(block=24超え)することを確認。
  4. 軽量な自己回復の実効性(レビュー指摘): healthy状態(block=36)から
     `./scripts/restart-node.sh 1`でノード1のみ再起動しノード2は稼働継続。
     reth2は一度も停止せず進行継続(37→100超)、reth1はgenesisから再同期して
     着実にブロックを取り込み追従再開。項目2の完全停止とは明確に異なり、
     もう片方を止めずに自己回復することを確認。
     - 補足(非ブロッキング): 再起動したreth1はP2P再同期のラグで先行ノードに
       約32ブロック遅れで安定追従する(reth本来のステージド同期の挙動)。
       停止ではなく着実に取り込み続けており不具合ではない。
  5. エラーハンドリング: 引数なし・`abc`・混在`1 x`・空文字`''`・小数`1.5`の
     いずれも、stderrへ明確なエラーメッセージを出しexit=1で終了。サイレントに
     無反応になることはない。混在ケースは検証段階で全引数を弾くため、
     正しい引数側(node1)を部分的に再起動しない安全な設計であることも確認。
  6. `pnpm lint` / `pnpm build` / `pnpm test`(collector 330・frontend 301、
     すべて成功)。
- 検証後、`profiles/ethereum`をクリーンな`docker compose down -v && up -d`済みの
  状態に戻した(ブロック進行を再確認済み)。

### 2026-07-04 Issue #43 レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-43-beacon-restart-divergence
- 内容: node-env の対応(restart-node.sh 追加 + README 追記)を静的レビュー
  した。結果は合格。
  - 方針判断: reth 側の自動回復ロジックを見送り、誤操作を構造的に防ぐ
    運用スクリプト + ドキュメント整備に留めた判断は、「先回り実装をしない」
    方針・過剰な作り込みを避ける方針に照らして妥当。ノード番号のみを
    受け付けて reth/beacon/validator の3点セットに機械的に展開する設計は、
    beacon 単独再起動という誤操作自体を不可能にしており適切。
  - スクリプト実装: `set -e`・引数の数字検証(空文字/非数字は stderr へ
    エラーを出して exit 1)・`exec docker compose restart` による終了コードの
    素通し、いずれもエラーの握りつぶしなし。展開する `$services` は数字
    検証済みの値のみで構成されるため、意図的な単語分割も安全。
  - README 追記: reth-node.sh(`rm -rf /data/*`)・lighthouse-bn.sh
    (`find /data -mindepth 1 -delete`)の実際の初期化処理と記述が一致。
    参照している「genesis の扱い」「P2P 接続について」の各節も実在する。
  - `pnpm lint` / `pnpm build` / `pnpm test`(301 tests)すべて成功。
    TypeScript パッケージへの変更はなくテスト追加義務の対象外。
    docs/ARCHITECTURE.md はプロファイル内スクリプトを列挙していないため
    齟齬なし。
- 決定事項・注意点(いずれも非ブロッキングの申し送り):
  - スクリプトは compose 定義済みサービス(reth1/2 等、または README の
    手順で compose に追記した reth3 以降)専用。collector の addNode で
    動的に追加したフォロワーノード(compose サービスではなく validator も
    持たない)には使えないが、その場合 `docker compose restart` が
    "no such service" で明示的に失敗するため事故にはならない。
  - スクリプトは profiles/ethereum をカレントディレクトリとして実行する
    前提(ヘッダコメント・README に明記済み)。別ディレクトリから実行した
    場合も compose が設定ファイル未発見のエラーで明示的に失敗する。
  - コミット時は「feat: スクリプト追加 + README 追記」と「docs: PLAN/
    WORKLOG 更新」を分ける想定でよい。

### 2026-07-04 Issue #43 beacon単独再起動によるEL/CL乖離への対応(node-env)

- 担当: node-env
- ブランチ: issue-43-beacon-restart-divergence
- 内容: `profiles/ethereum`で実機再現・検証した結果、以下の対応を行った。
  - `profiles/ethereum/scripts/restart-node.sh`を追加した。ノード番号を
    引数に取り、対応する`reth<N> beacon<N> validator<N>`をまとめて
    `docker compose restart`するホスト側の運用スクリプト(コンテナには
    マウントしない)。beaconだけを再起動する誤操作を防ぐため、素の
    サービス名ではなくノード番号を受け取り、reth/beacon/validatorの
    3点セットへ機械的に展開する設計にした。
  - `profiles/ethereum/README.md`に「一部のサービスだけを再起動するとき」
    節を追加し、beacon単独再起動が禁止である理由・上記スクリプトの
    使い方・最終手段としての`down`→`up`を明記した。
- 検討過程: `reth-node.sh`/`lighthouse-bn.sh`のいずれも起動のたびに
  データディレクトリを初期化してgenesisからやり直す設計になっており、
  これは新規ノード追加(addNode)を含む本プロファイル全体の前提になっている。
  そのため「reth側でsyncing検知時に自動回復動作を行う」という案(選択肢1)は、
  正常系(単に同期に時間がかかっている状態)との区別が難しく、下手に自動で
  データ初期化等を行うと別の事故を誘発しかねないため見送った。「対応しない」
  という判断(選択肢3)も検討したが、実機確認で新たに次の点が判明したため、
  軽量な運用スクリプトを追加する方が実利があると判断した:
  - reth+beaconを**ノード単位でセットにして**再起動すれば、既存の
    EL/CL間P2P(Issue #44)による自動バックフィルで自己回復する
    (もう片方のノードを止めずに済む)。これは`down`→`up`より遥かに
    軽量な復旧手段であり、既存ドキュメント(WORKLOG Issue #41)には
    このノード単位再起動が有効という情報が無かった。
  - README.mdにはこの問題・回避策が一切記載されておらず(WORKLOGにのみ
    記録されていた)、運用者向けドキュメントとして不十分だった。
- 実機確認:
  - クリーンな`docker compose up -d`後、`docker compose restart
    beacon1 beacon2`で問題を再現した(`cast block-number`が60秒以上
    停止し続け、beaconログに`Exec engine unable to produce payload:
    the engine is likely syncing`相当のエラー`PayloadIdUnavailable`が
    継続することを確認)。
  - ノード群6サービスをまとめて再起動(`reth1 reth2 beacon1 beacon2
    validator1 validator2`)すると復旧することを確認(既存ドキュメント
    どおり)。
  - 片方のノード(`reth1 beacon1 validator1`、または`reth2 beacon2`のみ)
    だけを再起動し、もう片方は動かしたままにした場合も、EL/CL間P2Pに
    よるバックフィルで数十秒以内に自己回復することを確認(beacon2の
    ログで`finalized_epoch`が進み`exec_hash`が`verified`になることで
    追従再開を確認)。
  - `restart-node.sh`を実際に使い、`beacon1 beacon2`単独再起動で停止させた
    状態から`./scripts/restart-node.sh 1 2`で復旧することを確認した。
    引数なし・数字以外を渡した場合にエラーメッセージを出して終了する
    ことも確認した。
  - 最後にクリーンな`docker compose down -v && up -d`でも従来どおり
    起動・進行・`cast`疎通することを確認した。
- 決定事項・注意点: `reth-node.sh`/`lighthouse-bn.sh`自体には手を入れて
  いない(コンテナ起動時の初期化ロジックは変更なし)。`restart-node.sh`は
  host側のみで完結する追加ファイルであり、既存の compose 構成・
  ノード追加(addNode)フローには影響しない。
