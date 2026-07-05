# Issue #41 作業記録

### 2026-07-04 Issue #41 lighthouse-bn.sh の set -f が /data 初期化の glob 展開を無効化する不具合
- 担当: node-env
- ブランチ: issue-41-lighthouse-bn-glob-init
- 内容: `profiles/ethereum/scripts/lighthouse-bn.sh` で `set -f`(glob 無効化)が
  `rm -rf /data/*` より前に実行されており、`/data/*` が glob 展開されず
  リテラルの `*` を消そうとしていた(実データが残る)。`set -f` は後段の
  `$COMMON` 単語分割時に `--http-allow-origin *` の `*` が glob 展開されるのを
  防ぐために必要で単純に外せないため、初期化を glob 非依存の
  `find /data -mindepth 1 -delete` に置き換えた(隠しファイルも含めて確実に消える)。
- 確認範囲: 他スクリプト(`reth-node.sh` / `lighthouse-vc.sh` /
  `generate-genesis.sh`)は `set -f` を使っておらず同種の不具合なし。修正対象は
  `lighthouse-bn.sh` のみ。
- 動作確認:
  - `docker compose down -v && up -d` のクリーン起動でブロックが進行
    (chain-id 1337 / reth v2.3.0、workbench から `cast` で RPC 疎通確認)。
  - ボリュームを維持したまま beacon を再起動すると、修正前は初期化が空振りして
    weak-subjectivity で起動失敗していたが、修正後は `[beacon] データディレクトリ
    を初期化` が有効に働き、beacon はクラッシュせず再起動する(新しい ENR を
    再発行=データが実際に消えていることを確認)。
- 注意点(#41 とは別の既知の癖。今回の修正対象外):
  - beacon だけを再起動すると CL は genesis からやり直す一方、reth は
    データを保持したまま先行するため EL/CL が乖離し、beacon 自体は正常でも
    ブロック生成が止まる。ボリューム維持のまま再開したい場合は
    ノード群(reth1/reth2/beacon1/beacon2/validator1/validator2)をまとめて
    再起動すると、各 datadir が既存 genesis から作り直されて進行を再開する
    (実機で確認済み)。
  - `docker compose restart`(全体)や停止中でない reth を伴わない再起動では、
    genesis サービスが再実行されて jwtsecret が再生成されるため、reth が
    古い jwtsecret のままだと Engine API が 401 になりチェーンが停止する。
    この構成は genesis を毎回作り直す前提のため、確実な再起動は
    `down`→`up`(フル recreate)で行う。
