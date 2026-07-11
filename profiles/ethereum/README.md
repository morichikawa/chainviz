# Ethereum チェーンプロファイル — ノード環境テンプレート

`docs/CONCEPT.md`「技術候補 > ノード環境」で決定した構成に沿った、
genesis 共有の PoS プライベートネット。実行層(reth)+ 合意層(lighthouse)を
2 ノード立て、Foundry ワークベンチを同じ Docker ネットワークに接続する。

これはチェーンプロファイル 3 点セット(`docs/ARCHITECTURE.md` §4)のうち
「ノード環境テンプレート」にあたる。ChainAdapter・フロント表現セットは
別パッケージで担当する。

## 構成

| サービス     | 役割                                        | イメージ |
| ------------ | ------------------------------------------- | -------- |
| `genesis`    | genesis 一式を生成して終了(初回のみ。以降は再利用) | ethpandaops/ethereum-genesis-generator |
| `reth1/2`    | 実行クライアント(EL)                       | ghcr.io/paradigmxyz/reth |
| `beacon1/2`  | 合意クライアント(CL, beacon node)         | sigp/lighthouse |
| `validator1/2` | バリデーター(ブロック提案・投票)         | sigp/lighthouse |
| `workbench`  | ユーザー操作マシン(cast / forge)          | ghcr.io/foundry-rs/foundry |

- `reth1 + beacon1 + validator1` で 1 ノード、`reth2 + beacon2 + validator2` で
  もう 1 ノード。各ノードは自分の EL を Engine API 経由で駆動する。
- バリデーター 64 個を 2 ノードに 32 個ずつ分割。両ノードがブロックを提案する。
- slot time は 2 秒(`values.env` で設定)。ブロックは約 2 秒ごとに進む。
- genesis 時点で Electra(Prague)まで有効。Fulu(PeerDAS)以降は無効。

## 使い方

```sh
cd profiles/ethereum
docker compose up          # 起動(全サービスをまとめて上げること)
docker compose logs -f     # ログ追尾
docker compose down -v     # 停止 + genesis / chain データ破棄
```

起動後 `GENESIS_DELAY`(既定 20 秒)+ 数スロットでブロックが進み始める。

- ホストからの JSON-RPC: `http://localhost:8545`(reth1)
- ホストからの Beacon API: `http://localhost:5052`(beacon1)

### 一部のサービスだけを再起動するとき(Issue #43)

`reth-node.sh` / `lighthouse-bn.sh` は起動のたびにデータディレクトリを
初期化して genesis からやり直す設計になっている(後述「genesis の扱い」)。
このため **`docker compose restart beacon1 beacon2` のように beacon(CL)だけを
再起動してはいけない**。CL は genesis からやり直す一方、再起動していない
reth(EL)は既存のブロックデータを保持したまま先行してしまい、EL/CL の
ヘッドが乖離して `Exec engine unable to produce payload: engine is likely
syncing` が継続し、チェーンが完全に停止する(自己回復しない)。

ボリュームを維持したまま一部のサービスを再起動したい場合は、必ず
`reth<N> beacon<N> validator<N>`(ノード単位)をセットで再起動すること。
`scripts/restart-node.sh` はこれを楽に行うためのヘルパー(ホスト側で使う
運用スクリプトで、コンテナにはマウントしない):

```sh
./scripts/restart-node.sh 1        # reth1 beacon1 validator1 をまとめて再起動
./scripts/restart-node.sh 1 2      # 両ノードをまとめて再起動(既に停止済みの
                                    # 場合の復旧にはこちらが必要)
```

ノード単位でまとめて再起動すれば、EL/CL 双方が同じ genesis からやり直した
状態になり、後述の EL/CL 間 P2P 再同期によって自動的に追従を再開する
(片方のノードだけ再起動しても、もう片方が稼働中であれば P2P 経由で
バックフィルされて復旧する。実機で確認済み)。

最も確実なのは `docker compose down`(-v なし)→ `up` で全サービスを
再作成することで、`scripts/restart-node.sh` は「ノード群の一部だけを
手早く再起動したい」場合の補助という位置づけ。

### ワークベンチから RPC を叩く

```sh
docker compose exec workbench sh
# 以下はコンテナ内。ETH_RPC_URL は compose、mnemonic(EL_AND_CL_MNEMONIC)は
# values.env を env_file で読み込み済み
cast chain-id
cast block-number
cast balance $(cast wallet address --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index 0) --ether
# 送金(プリマイン済みアカウントから)
cast send --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index 0 \
  --value 1ether 0x8943545177806ED17B9F23F0a21ee5948eCaa776
```

`workbench` はチェーンと同じ mnemonic を持ち、そこから導出した 8 アカウントが
genesis でプリマインされている(導出パスは Foundry 既定と同じ
`m/44'/60'/0'/0/N`)。

`ETH_RPC_URL` は reth1 直接ではなく **ロギングプロキシ経由**(`http://host.docker.internal:4001`)
を指す(後述「ワークベンチの RPC 観測(ロギングプロキシ)」)。**プロキシは
collector プロセスがホスト上のポート 4001 で提供する**ため、上記の `cast`
コマンドを成功させるには collector(のプロキシ)がホスト側で起動している
必要がある。起動していない場合、ワークベンチからの RPC は
`Connection refused`(host:4001)で失敗する。

## genesis の扱い

genesis.json(EL)と genesis.ssz / config.yaml(CL)は **生成時刻を埋め込む**
ため、静的ファイルとしてコミットせず、`genesis` サービスが起動時に現在時刻で
生成する。生成の入力(= 実質的な「genesis 設定ファイル」)は次の 2 つ:

- `values.env` — バリデーター数・slot time・フォークスケジュール等の設定
- `scripts/generate-genesis.sh` — 生成手順(EL/CL genesis + バリデーター鍵)

生成物は `genesis` という共有ボリュームに置かれ、全ノードがマウントして
共有する。これは `docs/CONCEPT.md`「新規ノード追加時の P2P 参加方法」で
言う「genesis はノード環境テンプレートの静的ファイルをマウントして共有」に
対応する(共有ボリュームの中身がその静的ファイルの実体)。

### 冪等性(Issue #56)と、稼働中かどうかの判定(Issue #148 / #286)

genesis の生成は **共有ボリュームに対して初回だけ** 行う。`generate-genesis.sh`
は生成完了時に共有ボリュームへマーカー(`/data/.genesis-complete`)を残し、
次回以降はそれを検出して原則再生成をスキップする。これにより、既にスタックが
稼働中の状態で `docker compose up -d` を再実行しても genesis が新しい
タイムスタンプで上書きされず、既存ノードと genesis ハッシュが食い違う事故
(EL 間 P2P ハンドシェイク失敗)を防ぐ。あとから追加したノードも既存ノードと
同一の genesis で init される。

ただし、マーカーがあっても「次回起動時にノードが genesis まで遡って
再構築しなければならない量(genesis 生成時刻からの経過時間 = genesis 年齢)」
が大きく、かつ全ノード停止が確定・実測された場合は、例外的に genesis を
自動的に作り直す。詳細は次節「長時間停止後の再起動と自動リセット」を参照。
稼働中か停止していたかはハートビートの新しさに加え、必要な場合はその
前進のサンプリング観測で実測して判定するため、稼働中スタックへの `up -d`
再実行が誤って再生成扱いされることはない。

まっさらな chain で始めたいときは `docker compose down -v` で共有ボリュームを
破棄する。マーカーごと消えるため、次回起動時に genesis が再生成される
(こちらは常に有効な手動リセット)。

生成が途中で失敗した場合はマーカーが書かれないため、次回起動時にやり直しに
なる(半端な生成物のまま起動することはない)。

冪等になったのは共有ボリューム上の genesis ファイル自体であり、**各ノードの
データディレクトリは従来どおり起動のたびに初期化される**(`reth-node.sh`等の
`rm -rf /data/*`相当の処理は変わらない)。また`docker compose down`(`-v`を
付けない場合)は共有ボリュームを残すため、`up`し直しても(長時間停止していな
ければ)同じタイムスタンプの genesis がそのまま使われる。

### 長時間停止後の再起動と自動リセット(Issue #139 / #148 / #286)

`beacon1/2`は起動のたびにデータディレクトリを初期化して genesis からやり直す
(前述のとおり)。このチェーンは genesis 生成時刻(壁時計)を基準に実時間で
slot が進み続けるため、全ノードが同時に長時間停止する(PC のシャットダウン・
スリープ等)と、再開時に停止期間ぶんの空き slot を短時間で再構築しなければ
ならない。この再構築が実時間の slot 進行に追いつけないと、beacon が起動は
するものの head が genesis から一切進まず、`Producing block at incorrect
slot` / `Timed out waiting for fork choice before proposal` を繰り返しながら
高 CPU 負荷でハングし続ける(実機検証は `docs/worklog/issue-139.md` を参照。
検証環境では 1.5〜2 時間程度の停止から再現した。この閾値は実行マシンの CPU
性能に依存し固定値ではない)。genesis 生成時刻から weak subjectivity
period(このプロファイルの設定では概算 4.6 時間)を超えて再起動すると、
lighthouse がそもそも `CRIT ... outside the weak subjectivity period` で
起動を拒否する場合もある。`lighthouse-bn.sh` は `--ignore-ws-check` でこの
安全チェックを意図的に無効化している(chainviz は外部非公開の使い捨て
ローカル学習用環境であり long range attack のリスクは実質的に無関係と判断。
外部公開する運用に変える場合は再検討が必要)。

**この問題への対応として、chainviz は「次回起動時にノードが再構築しなければ
ならない量(genesis 年齢)が大きく、かつ全ノードが停止している」ことを自動
検知し、genesis を現在時刻で自動的に作り直す**(Issue #148 / #286。詳細な
設計・しきい値の根拠は `docs/worklog/issue-148.md`・`docs/worklog/issue-286.md`
を参照)。この環境は再起動のたびにチェーンの中身(ブロック履歴・デプロイ済み
コントラクト等)を失う前提であり、プリマイン残高・アドレス・バリデーター鍵は
mnemonic から決定的に再導出され genesis を作り直しても変わらないため、この
自動リセットでユーザーが失うものは実質的に無い。

判定の入力は「停止していた時間」ではなく「**genesis 年齢**(genesis 生成
時刻からの経過時間。次回起動時にノードが slot 0 から再構築しなければ
ならない量そのもの)」であることに注意。停止時間だけを見ると、
「スタックは長時間稼働していたが、停止・再起動そのものは短時間だった」
ケースを見逃し、再構築不能な古い genesis のまま再利用してハングする
(Issue #286)。

- 各ノード(`reth1/2`・`beacon1/2`)は 10 秒間隔で自分の生存を共有ボリューム
  `heartbeat` に書き出し続ける。`genesis` サービスは `docker compose up -d`
  のたびに genesis 年齢とこのハートビートを見て、次のように振る舞う。
  - genesis 年齢が **600 秒(10 分)以内**なら、稼働中・全停止後いずれの
    場合でも再構築量が安全な範囲(#139 で検証済み)なので、常に genesis を
    再生成せずそのまま使う。
  - genesis 年齢が 600 秒を超える場合のみ、全ノードが本当に停止している
    かを判定する。
    - 最新のハートビートが **60 秒より古い**、またはハートビートが1つも
      無いなら「全ノード停止が確定」とみなし、genesis を現在時刻で
      自動再生成する。
    - 最新のハートビートが 60 秒以内(= 「稼働中」と「停止直後の再起動」の
      両方であり得て見分けが付かない)の場合は、ハートビート間隔の 2 周期
      分(既定 20 秒)だけ様子を見て、ハートビートの更新時刻が実際に
      前進するかをサンプリング観測する。前進すれば「稼働中」とみなし
      genesis を再生成せずスキップする(Issue #56 の保護)。前進しなければ
      「停止直後の再起動」とみなし genesis を現在時刻で自動再生成する
      (Issue #286 の本命ケース)。
- **稼働したまま PC がスリープした場合(ノート PC の蓋を閉じる等)**も、
  レジューム時に各ノードの watchdog がハートビート間隔の異常な空白(10 分
  超)を検知し、自ノードを自己停止させる(そのままにすると genesis が
  再生成されないままチェーン時刻のギャップだけが残りハングする、または
  古い設定のまま署名を続けるバリデーターが混在してチェーンが不健全に
  なるため)。次に `docker compose up -d` した際、上記の判定で genesis が
  再生成される。
- しきい値は環境変数(`GENESIS_LIVE_THRESHOLD_SEC` /
  `GENESIS_MAX_REBUILD_GAP_SEC` / `GENESIS_SUSPEND_DETECT_SEC`)で上書き
  できる(既定値のままで通常利用には十分)。`GENESIS_MAX_REBUILD_GAP_SEC`
  は旧 `GENESIS_DOWNTIME_RESET_SEC` から改名したもので、互換エイリアスは
  無い(Issue #286)。
- `docker compose logs genesis` に、再生成した/しなかった理由(genesis
  年齢・最新ハートビートの経過秒数・サンプリング結果)が必ず出力される。

**意図的な挙動変更(Issue #286)**: 長時間(genesis 年齢が
`GENESIS_MAX_REBUILD_GAP_SEC` を超えて)稼働し続けているスタックを
`docker compose down` した後 `up` し直すと、停止時間が短くても(#148 まで
は再利用していたケースでも)genesis が自動的に再生成されるようになった。
これは「稼働し続けている動的ノード(collector の `addNode` で追加した
ノード)」が古い genesis のまま取り残される頻度が上がることを意味する
(下記「残る既知の限界」参照)。使い捨て・再追加で対応する想定であり、
本プロファイルの他の挙動には影響しない。

**残る既知の限界**:

- 長時間(ハング閾値超)稼働し続けているスタックに対して `restart-node.sh`
  でノード単位の再起動をする場合は対象外(`genesis` サービスが走らないため
  自動再生成されない)。この場合は従来どおり `--ignore-ws-check` のみが
  効いており、経過時間によっては起動時 CRIT やハングが起こり得る。
  `docker compose down -v` で genesis を作り直すのが最終手段。
- `docker compose restart` は `depends_on` の完了待ち順序が保証されない
  ため、上記の自動リセットの対象外(推奨操作は `down` → `up`)。
- collector の `addNode` で動的に追加したノードは `heartbeat` ボリュームを
  持たないため、生存報告やサスペンド watchdog は働かない(ログにスキップ
  した旨が出るのみで、起動自体は妨げない)。Issue #286 により compose 側
  ノードの genesis 再生成頻度が上がったため、動的ノードが古い genesis の
  まま取り残される頻度も上がる(使い捨て・再追加で対応する想定)。

genesis からの経過時間が長く、`docker compose up -d` 後もブロック番号が
進まない(`docker compose logs beacon1 beacon2` で `head_slot` が 0 のまま
`current_slot` だけ増え続ける)場合は、`docker compose down -v` で
共有ボリュームを破棄し、genesis を作り直すこと(チェーンの進行状態は失われる)。

## P2P 接続について

- **CL(合意層)の P2P は接続済み**。`beacon1` が bootnode として自分の ENR を
  共有ボリューム(`clpeer`)へ書き出し、`beacon2` がそれを読んで接続する。
  これにより 2 ノードが単一の chain として合意する(片方だけだと fork する)。
- **EL(reth)同士の P2P も接続済み**。CL と同じファイル共有方式で、`reth1` が
  bootnode として自分の enode を共有ボリューム(`elpeer`)へ書き出し、`reth2`
  以降がそれを読んで `--trusted-peers` / `--bootnodes` で接続する。これにより
  チェーン進行後に参加した新規 reth が、既存ノードから欠けている履歴ブロックを
  devp2p でバックフィルできる(CL の Engine API は最新ヘッドしか渡さないため、
  祖先ブロックを持たない新規ノードは EL 間 P2P が無いと追従できない)。
  - `reth1` の enode は決定的にするため、`reth-node.sh` に固定の p2p 秘密鍵と
    そこから導出した公開鍵を定数として持たせている(使い捨て devnet 用の値。
    `RETH_ROLE=boot` のノードだけがこの鍵を使う)。
  - 副作用として EL 間の tx gossip(pending tx の相互伝播)も同時に有効になる。
    reth ではブロック同期だけを分離して有効化できないため許容している。

## ワークベンチの RPC 観測(ロギングプロキシ)

ワークベンチの RPC 呼び出しを可視化するため、ワークベンチは reth1 を直接
叩かず **ロギングプロキシ経由** で接続する(`docs/CONCEPT.md`「ユーザー操作
マシン(ワークベンチ)の投影」の決定)。プロキシは受け取った RPC 呼び出しを
ログに残しつつ、そのまま reth1 へ転送する。

- **プロキシの実体は collector プロセス**。collector がホスト上のポート 4001 で
  待ち受ける(collector 本体の WebSocket サーバーは 4000 番、プロキシは
  4001 番)。プロキシ自体の実装は collector 側の担当
  ([#79](https://github.com/morichikawa/chainviz/issues/79))であり、この
  プロファイルは接続先を向けるだけ。
- **コンテナからホストへの到達経路**: プロキシはコンテナではなくホスト上の
  プロセスなので、ワークベンチコンテナからは Docker ネットワーク内の名前解決
  では届かない。`docker-compose.yml` の workbench に
  `extra_hosts: ["host.docker.internal:host-gateway"]` を付け、
  `ETH_RPC_URL=http://host.docker.internal:4001` を指す。`host-gateway` は
  Docker 20.10+ の機能で、`host.docker.internal` をホスト IP(Docker Engine の
  デフォルトブリッジのゲートウェイ、通常 `172.17.0.1`)へ解決する。Linux の
  Docker Engine でも機能することをこの環境で `cast chain-id` の疎通により
  実測確認済み。
  - 代替として `chain` ネットワーク(`172.28.0.0/16`)のゲートウェイ IP
    `172.28.0.1` を直接指す方法もあるが、サブネット定義に依存して壊れやすい
    ため、サブネットに依存しない `host.docker.internal` を採用している。
- **前提**: プロキシは collector が提供するため、ワークベンチからの RPC を
  成功させるには collector(のプロキシ)がホスト側で起動している必要がある。
  起動していない場合は `Connection refused`(host:4001)になる。`profiles`
  単体で `docker compose up` してもワークベンチの `cast` は collector
  なしでは通らない点に注意(チェーン自体は起動・進行する)。

## サンプルコントラクト

`contracts/` にチェーンプロファイル同梱のサンプルコントラクト(最小の
ERC20 トークンとカウンタ)を Foundry プロジェクトとして置いている
(`docs/ARCHITECTURE.md` §4「コントラクトカタログ」)。Phase 4(C層拡張)の
コントラクト呼び出し・イベントログ可視化のデモに使う。

```
contracts/
  foundry.toml
  src/
    ChainvizToken.sol   # 最小の ERC20(外部ライブラリ非依存の自己完結実装)
    Counter.sol          # 最小のカウンタ(状態変更 + イベント発行のみ)
  catalog.json          # 表示名・ABI・トークンメタ情報のカタログ(下記参照)
  build-catalog.sh       # catalog.json の再生成スクリプト
```

- **ChainvizToken**: `name`(Chainviz Token)/ `symbol`(CVZ)/ `decimals`(18)
  を持つ最小 ERC20。`transfer` / `approve` / `transferFrom` と
  `Transfer` / `Approval` イベントを実装する。デプロイ時のコンストラクタ
  引数(`initialSupply`)でデプロイヤーへ初期供給できるほか、デプロイヤー
  限定の `mint(address, uint256)` で任意のアカウントへ追加供給できる
  (genesis でプリマインされたアカウント、すなわち `values.env` の
  `EL_AND_CL_MNEMONIC` から導出したアカウントへの供給にも使える)。
- **Counter**: `increment()` / `incrementBy(uint256)` で状態(`count`)を
  変更し `Incremented` イベントを、`reset()` で `Reset` イベントを出す、
  もっとも単純な学習用コントラクト。
- コントラクトカタログ(`catalog.json`)は、この 2 つのコントラクトの
  表示名・ABI(forge のビルド成果物から抽出した標準の ABI JSON 配列)・
  トークンメタ情報(ChainvizToken の symbol/decimals)を、コントラクト名を
  キーにして持つデータファイル。collector がデプロイ検知・呼び出し/イベント
  復号に使う(`docs/ARCHITECTURE.md` §4)。

### コントラクトカタログの再生成

`src/` 配下のコントラクトを追加・変更したときは、`build-catalog.sh` で
`catalog.json` を作り直してコミットする(`out/` はビルドのたびに生成される
成果物であり `catalog.json` はそこから抽出した安定版データファイルという
位置づけ。`.gitignore` で除外している `out/` 自体はコミットしない)。

```sh
cd profiles/ethereum/contracts
./build-catalog.sh
```

`forge` がローカルに無ければ `workbench` と同じ `ghcr.io/foundry-rs/foundry`
イメージを docker 経由で使ってビルドする(`jq` は別途必要)。

### ワークベンチ内でのビルド・デプロイ

`docker-compose.yml` の `workbench` サービスは `contracts/` を
`/contracts` に bind mount しており(`working_dir` も `/contracts`)、
`docker compose exec workbench sh` で入るとそのまま `forge` コマンドを
打てる。

```sh
docker compose exec workbench sh
# 以下はコンテナ内
forge build

# プリマイン済みアカウント(index 0)からデプロイ。constructor-args は
# initialSupply(wei 単位、decimals=18)。ここでは 100万 CVZ を初期供給する例
forge create src/ChainvizToken.sol:ChainvizToken \
  --rpc-url "$ETH_RPC_URL" \
  --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index 0 \
  --broadcast \
  --constructor-args 1000000000000000000000000

forge create src/Counter.sol:Counter \
  --rpc-url "$ETH_RPC_URL" \
  --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index 0 \
  --broadcast

# デプロイ後の呼び出し例(<TOKEN>/<COUNTER> は forge create の出力の
# "Deployed to" アドレスに置き換える)
cast send <TOKEN> "transfer(address,uint256)(bool)" \
  $(cast wallet address --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index 1) \
  500000000000000000000 \
  --rpc-url "$ETH_RPC_URL" --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index 0
cast send <COUNTER> "increment()" \
  --rpc-url "$ETH_RPC_URL" --mnemonic "$EL_AND_CL_MNEMONIC" --mnemonic-index 0
```

`forge build` は初回実行時に `foundry.toml` で指定した solc バージョンを
自動ダウンロードする(ワークベンチイメージに solc は同梱されていない。
`ghcr.io/foundry-rs/foundry:latest` で実機確認済み)。`out/` / `cache/` は
ビルドのたびに生成される成果物なので `.gitignore` で除外している
(コミットするのは `src/` と(将来追加する)`catalog.json` のみ)。

`$ETH_RPC_URL` はロギングプロキシ経由(前節)なので、これらのコマンドの
RPC 呼び出しは collector が起動していれば observability の対象になる
(未起動でも `docker compose exec` 内で reth1 に直接向けて
`--rpc-url http://reth1:8545` を指定すればデプロイ自体は行える)。

環境起動時にサンプルコントラクトが自動デプロイされることはない
(`docs/ARCHITECTURE.md` §4 の決定。デプロイという行為そのものを可視化の
対象にするため)。

## ノードを増やすには(2 → 3)

1. `values.env` の `NODE_COUNT` を 3 にする(バリデーター鍵が 3 分割される)。
2. `docker-compose.yml` に `reth3 / beacon3 / validator3` を追加する。
   - `reth3` は `reth2` と同じく `RETH_ROLE: peer` で enode を共有ボリューム
     (`elpeer`)から読む。`elpeer:/elpeer:ro` をマウントし、`RETH_P2P_IP` に
     自分の固定 IP を渡す。`heartbeat:/heartbeat` もマウントし、
     `HEARTBEAT_NODE_NAME: reth3` を渡す(Issue #148。生存報告のファイル名。
     省略するとコンテナホスト名になり読みづらいだけで動作はする)。
   - `beacon3` は `beacon2` と同じく `BEACON_ROLE: peer` で ENR を共有ボリューム
     から読む。同様に `heartbeat:/heartbeat` と
     `HEARTBEAT_NODE_NAME: beacon3` を渡す。`validator3` は
     `KEYS_DIR: /genesis/keys/node2` を指す(`heartbeat` は不要。前述のとおり
     validator は生存報告を行わない)。
3. 固定 IP(`ENR_ADDRESS` / `RETH_P2P_IP`)が既存ノードと重複しないよう割り当てる。
