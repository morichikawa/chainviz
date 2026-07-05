# Issue #44 作業記録

### 2026-07-04 Issue #44 レビュー（reth(EL)同士の P2P 同期）

- 担当: reviewer
- ブランチ: issue-44-el-p2p-sync
- 内容: node-env による EL 間 P2P 有効化（下記エントリ）の静的レビュー。
  - 固定 p2p 秘密鍵（`0x2222...22`）から導出された公開鍵定数
    `466d7f...278a` を secp256k1 演算で独立に検算し、一致を確認した。
    enode の形式（`enode://<非圧縮公開鍵64バイト>@IP:30303`）は devp2p の
    標準仕様であり、reth の内部実装に依存した推測ではない。
  - シェル構文（`sh -n`）、`pnpm lint` / `pnpm build` / `pnpm test` の全通過を
    確認した（TypeScript への影響なし）。
  - WORKLOG 追記時に既存エントリ（Issue #1・#2・#3）の見出しが誤って
    削除されていたため復元した。
- 決定事項・注意点:
  - **collector（#34 addNode）側の追随が必要**: 新しい `reth-node.sh` は
    `RETH_ROLE` 未設定（= peer）のとき `/elpeer/boot.enode` の出現を無限に
    待つ。`issue-34-add-remove-node` ブランチの `EthereumNodeLifecycle.rethSpec`
    は現状 `elpeer` をマウントしておらず、#44 マージ後そのままだと addNode で
    起動した reth は永久に待機して起動しない。#34 側で `elpeer:ro` マウントと
    `RETH_P2P_IP` の付与を追加すること（本エントリの連携事項どおり）。
  - `docs/CONCEPT.md` の決定事項（新規ノードの bootnode 情報を
    `admin_nodeInfo` のポーリング結果から取り出して起動コマンドに渡す方式）と
    実装（共有ボリューム経由の決定的 enode ファイル方式）がズレている。
    B層の実装が Beacon API ベースになった経緯もあわせて、CONCEPT.md の
    該当 2 箇所（アーキテクチャ案・検討事項）の更新が必要。
  - `docs/PLAN.md` ステップ 4 冒頭の「reth(EL)同士のP2Pは…まだ繋いでいない
    （Phase 3で追加予定）」も現在形の記述として実態とズレるため、#44 で
    追加済みである旨に更新するのが望ましい。
  - boot（reth1）停止時の耐障害性（peer 同士の相互接続など）は入れていないが、
    reth1 は compose 管理のバリデーター付きノードで removeNode の対象外
    （ステップ 5 完了条件）であり、先回り実装をしない方針に照らして妥当と
    判断した。enode が決定的なため、ボリュームに残る `boot.enode` は reth1
    再起動後も常に有効という利点もある。

### 2026-07-04 Issue #44 reth(EL)同士の P2P 同期を有効化
- 担当: node-env
- ブランチ: issue-44-el-p2p-sync
- 内容: `reth-node.sh` が `--disable-discovery` で EL 間 P2P を完全に無効化して
  いたため、チェーン進行後に参加した新規 reth が履歴ブロックを取得できず
  ブロック高 0 のまま追従できない問題を修正した。EL 間で devp2p(RLPx)接続を
  張り、新規ノードが既存ノードから履歴をバックフィルできるようにした。
  - `reth-node.sh` を CL(`lighthouse-bn.sh`)と同じファイル共有方式に書き換えた。
    `RETH_ROLE=boot` のノードが自分の enode を共有ボリューム(`elpeer`)の
    `/elpeer/boot.enode` へ書き出し、`RETH_ROLE=peer`(未設定含む)のノードが
    それを読んで `--trusted-peers` / `--bootnodes` で接続する。
  - `docker-compose.yml`: 共有ボリューム `elpeer` を追加。`reth1` を
    `RETH_ROLE=boot`(`elpeer` を rw マウント)、`reth2` を `RETH_ROLE=peer`
    (`elpeer:ro`)にし、双方に `RETH_P2P_IP`(広告 IP)を設定した。
  - `README.md` の P2P 節を実態に合わせて更新。
- 決定事項・注意点:
  - **boot ノードの enode を決定的にした**。ノードイメージに HTTP クライアントが
    無く `admin_nodeInfo` を RPC で取得できない。かつ peer が `exec` を保ったまま
    enode を待ち受けられるようにするため、boot ノードは固定の p2p 秘密鍵を使い、
    そこから決定的に導出される公開鍵(enode の pubkey 部)を `reth-node.sh` に
    定数として持たせている。boot はこの公開鍵と自分の IP から enode 文字列を
    自前で構築して共有ファイルへ書く(ログのパース不要、`exec` を維持できる)。
    使い捨て devnet 用の値であり、`values.env` の mnemonic 同様に固定でよい。
    秘密鍵を変えた場合はコメントの手順で公開鍵を再導出すること。
  - `--nat extip:<IP>` を指定して reth が正しい IP を広告するようにした
    (未指定だと enode が 127.0.0.1 になる)。boot は必須、peer は任意。
  - 副作用として EL 間の tx gossip(本来 Phase 3 想定)も同時に有効になる。
    reth ではブロック同期だけを分離して ON/OFF できないため、今回のユーザー
    指示により許容している。
  - 実機確認: `docker compose down -v && up -d` で reth1/reth2 が `peers=1` で
    接続しチェーンが進行(workbench から `cast chain-id`=1337、`block-number`
    正常)。チェーンが 41 まで進んだ後に新規 `reth3`+`beacon3` を `docker run`
    で追加したところ、reth3 は即座に履歴をバックフィルしてヘッドに追従した
    (block 5・30 のハッシュが reth1 と完全一致、以降ヘッドと同期して進行)。
  - **collector(addNode)側への連携事項**: addNode で reth を追加する際は、
    その reth コンテナに次を与えれば boot(reth1)から自動でバックフィル・追従
    できる。
    - 環境変数 `RETH_ROLE=peer`(省略時も peer 扱い)。
    - 環境変数 `RETH_P2P_IP=<割り当てた固定 IP>`(省略可。省略時は外向き接続
      のみで動く。他ノードからも dial 可能にしたいなら指定する)。
    - 共有ボリューム `<compose プロジェクト名>_elpeer` を `/elpeer` に **ro**
      マウント(compose 既定のプロジェクト名は `chainviz-ethereum` なので
      `chainviz-ethereum_elpeer`)。
    - 既存どおり `<プロジェクト名>_genesis` を `/genesis:ro`、`reth-node.sh` を
      `/scripts/reth-node.sh:ro` にマウントし、同じネットワークに接続する。
    - 対になる beacon も同様に `BEACON_ROLE=peer` + `clpeer` の ro マウントで
      追加する(reth が Engine API で FCU を受け取ってバックフィルを開始する
      ために CL も必要)。
