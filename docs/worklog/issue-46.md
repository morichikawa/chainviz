# Issue #46 作業記録

### 2026-07-04 Issue #46 lighthouse-bn.shの/data初期化順序を修正

- 担当: node-env
- ブランチ: issue-46-lighthouse-mkdir-order
- 内容: ステップ5(#34: addNode実装)のcollector担当が、addNodeで動的に
  追加するbeaconコンテナ(/dataボリュームをマウントしない)で
  `find: '/data': No such file or directory`によるクラッシュを発見した。
  Issue #41の修正で`find /data -mindepth 1 -delete`の後に
  `mkdir -p /data`を置いていたため、ボリューム未マウント時に`find`が
  `/data`不在で即座に失敗していた。`mkdir -p /data`を`find`より前に
  実行するよう順序を入れ替えた(mkdir -pは既存でも無害)。
- 決定事項・注意点: 実機で確認済み。`/data`ボリュームを一切マウントせず
  `docker run`でbeaconコンテナ(BEACON_ROLE=peer)を起動したところ、
  修正前はクラッシュしていたが修正後は正常に進行した。既存の
  compose起動beacon1/2(ボリュームマウントあり)の挙動には影響しない。

### 2026-07-04 Issue #46 レビュー（lighthouse-bn.sh の /data 初期化順序）

- 担当: reviewer
- ブランチ: issue-46-lighthouse-mkdir-order
- 内容: `mkdir -p /data` を `find /data -mindepth 1 -delete` より前に
  移動する修正（1行の並べ替え）の静的レビュー。
  - 順序の妥当性: `mkdir -p` は冪等（既存ディレクトリでも成功する）ため、
    ボリュームをマウントする compose 起動の beacon1/2 には無影響。
    ボリューム無しの動的コンテナでは find 実行前に /data が確実に存在
    するようになり、Issue #46 の原因（find が /data 不在で即失敗）を
    解消する。ロジックとして問題なし
  - 周辺スクリプトの同種問題: reth-node.sh / lighthouse-vc.sh の
    `rm -rf /data/*` は glob 有効な位置で実行され、/data 不在でも
    `rm -f` 相当で失敗しないため、同じクラッシュは起きない（対応不要）
  - `sh -n` で profiles/ethereum/scripts/ の全スクリプトの構文を確認、
    docs/ARCHITECTURE.md との齟齬なし、コミットは1変更1コミットで
    Conventional Commits 準拠、`Closes #46` あり
- 決定事項・注意点: **条件付き差し戻し**。lighthouse-bn.sh に追記された
  コメントの「ボリュームmarshalなし」は「ボリュームマウントなし」の誤記。
  意味が通らないため修正が必要（修正はコメント1語のみで、既存コミットへの
  amend で足りる粒度）。修正後、このブランチの実装側 WORKLOG エントリの
  追記も必要。

