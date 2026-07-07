# Issue #148 作業記録

### 2026-07-07 Issue #148 長時間停止後の再起動ハングへの対応設計(designer)

- 担当: designer
- ブランチ: issue-148-genesis-rebuild-hang
- 内容: 長時間停止後の再起動で beacon が genesis からの再構築に追いつけず
  無言でハングする問題(Issue #139 の実機検証で発見)への対応方針を設計した。
  結論は「**スタック全体が一定時間(既定 10 分)以上止まっていたことを
  ハートビートファイルで検知したら、genesis を現在時刻で自動再生成する**」
  (以下、案G)。checkpoint sync・`/data` 永続化は後述の理由で不採用。
  実装は node-env のみで完結し、shared / collector / frontend への変更は無い。

## 1. 根本原因の整理(設計の前提)

- このプロファイルの PoS チェーンは genesis 生成時刻(壁時計)を slot 0 の
  基準とし、以後 2 秒 = 1 slot で「現在あるべき slot(current_slot)」が
  実時間とともに進み続ける。
- 全ノードが同時に停止する(PC シャットダウン・スリープ等)と、停止中も
  current_slot だけが進む。再開したノードは「停止していた期間ぶんの空き
  slot」を 1 slot ずつ状態遷移処理して現在まで追いつく必要がある。
- この追いつき処理の速度が実時間の slot 進行(0.5 slot/秒)を下回ると、
  head が永遠に current_slot に追いつけない状態にロックインする。これが
  ハングの正体(Issue #139 の検証では 20 vCPU 環境で約 3200 slot ≒ 1.8 時間
  ぶんの空きから発生。閾値は CPU 性能依存)。
- **重要な帰結**: ハングの原因は「/data を毎回初期化するから」ではなく
  「チェーン時刻が壁時計に固定されているのに、全ノードが一斉に止まるから」。
  停止期間ぶんのギャップは、どの時点の状態から再開しようと(genesis からでも
  停止直前の状態からでも)必ず処理しなければならない。
- もう一つの前提: **チェーンの中身(ブロック履歴・tx・デプロイ済み
  コントラクト)は現状でもあらゆる再起動で失われている**。`reth-node.sh` /
  `lighthouse-bn.sh` は起動のたびに /data を初期化するため、再起動後の
  チェーンは同じ genesis から空の slot を再構築したもの。永続しているのは
  genesis(共有ボリューム)だけで、ウォレット残高は genesis プリマイン
  (mnemonic から決定的に導出)由来なので genesis を作り直しても変わらない。

## 2. 選択肢の比較

### 案1: checkpoint sync 導入 — 不採用

checkpoint sync は「現在時刻に近い状態を持つ信頼できる供給元」から同期を
始める仕組み。実ネットワークでは他の稼働し続けたノードがその供給元になるが、
この環境では全バリデーターが一斉に停止するため、停止後に「現在に近い状態」を
持つ供給元がそもそも存在しない。停止前に保存したチェックポイントは、停止
期間ぶんだけ現在から遅れており、そこから現在 slot までの空き slot 処理は
genesis からの再構築と同じだけ必要になる。つまり**この問題を原理的に
解決できない**うえ、状態の保存・配信の仕組みという大きな複雑さを学習用の
シンプルな環境に持ち込むことになる。

### 案2: /data を再起動のたびに初期化しない — 不採用

保存されるのは「停止直前までに構築済みの部分」だけで、停止期間ぶんの
ギャップ処理は消えない(Issue #139 の検証はブロックが 1 つも無い状態でも
ハングしており、ボトルネックは構築済み部分の再生ではなく空き slot の状態
遷移処理)。ハング閾値は改善しないのに、Issue #41/#43/#56 で確立した
「毎回まっさらに init するから、どのノードもいつ再起動しても現在の genesis と
必ず整合する」という性質(addNode の動的ノードもこの前提)を失い、
「古い /data × 再生成された genesis」の不整合という新しい故障モードを
持ち込む。得るものが無い。

### 案3: 検知して知らせるだけ(fail-fast またはcollector側ハング検知) — 不採用

- `lighthouse-bn.sh` 起動時に「genesis からの経過時間 > 閾値」なら明確な
  エラーで起動を拒否する案: ハング閾値が CPU 性能依存のため固定閾値が
  決められず(CLAUDE.md の「観測時点の環境に依存した固定値」の禁止に抵触
  しやすい)、結局ユーザーの手動 `down -v` が必要なまま。
- collector 側でハング検知して GUI に通知する案: collector が起動している
  とは限らない(`docker compose up -d` 直後の問題)うえ、Issue の完了条件
  「復旧するか、少なくとも伝わる」の下位側しか満たせないのに、collector /
  frontend / shared への変更が必要でコストが案Gより大きい。

### 案G(採用): スタック停止を検知したら genesis を現在時刻で自動再生成

- ギャップは「genesis 時刻(= slot 0)を今に引き直す」ことでしか消せない。
  これは `docker compose down -v && up -d`(README 記載の最終手段)と同じ
  効果を自動化するもの。
- 上記 1. のとおりチェーンの中身はどんな再起動でも既に失われているので、
  genesis を作り直しても**ユーザーが失うものは実質的に無い**(プリマイン
  残高・アドレス・バリデーター鍵は mnemonic から決定的に再導出され同一。
  変わるのは genesis タイムスタンプ/ハッシュのみ。chainId は 1337 のまま)。
- 停止時間の長さに関係なく機能する(完了条件の「復旧する」側を満たす)。
- 変更は profiles/ethereum のシェルスクリプトと compose のみ。

唯一の設計上の難所は「**稼働中のスタックへの `up -d` 再実行では再生成しては
ならない**」(Issue #56 で防いだ事故: 稼働中に genesis が新タイムスタンプで
上書きされると既存ノードとハッシュが食い違い壊れる)こと。genesis 時刻からの
経過時間だけでは「3 時間健全に稼働していた」と「3 時間止まっていた」を
区別できないため、**ノードの生存ハートビート**で区別する。

## 3. 採用案の設計

### 3-1. ハートビート(スタック生存の検知)

- 新しい名前付きボリューム `heartbeat` を追加し、`/heartbeat` として
  reth1/2・beacon1/2 に rw でマウントする(genesis サービスにも rw で
  マウント。既存の genesis ボリュームはノード側 `:ro` のままで変更しない)。
- `reth-node.sh` / `lighthouse-bn.sh` は `exec` の前にバックグラウンドの
  ループを起動し、`/heartbeat/<自分の識別名>` を **10 秒間隔**で `touch`
  し続ける(既存の「boot ENR を書き出す背景ループ」と同じパターン。exec 後も
  子プロセスとして生き続け、コンテナ停止とともに死ぬ = 触られなくなる)。
- `/heartbeat` がマウントされていない・書けない場合(collector の addNode で
  動的追加されたコンテナは elpeer/clpeer を :ro でマウントしており、
  heartbeat ボリュームを持たない)は、ループ自体をスキップするか
  `|| true` で握りつぶさず**スキップした旨を 1 行ログに出して**続行する
  (`set -e` でコンテナが死なないよう必ずガードする)。

### 3-2. generate-genesis.sh の再生成判断

現在の「完了マーカーがあれば無条件でスキップ」を次のロジックに置き換える:

```
マーカー無し            → 生成(従来どおり、初回)
マーカー有り:
  age = now - (/heartbeat/* の最新 mtime。ファイルが1つも無ければ ∞)
  age <= LIVE_THRESHOLD(60秒)      → 生存ノードあり: スキップ(Issue #56 の保護)
  age >  RESET_GRACE(600秒)        → 全ノードが10分以上停止していた: 再生成
  (suspend マーカー有りの特例は 3-3 参照)
  それ以外(60秒 < age <= 600秒)  → 短時間の停止: スキップ(小さなギャップは
                                       従来どおりノードが再構築する。#139 で検証済みの領域)
```

- 再生成時は `down -v` 相当のクリーンさにするため、genesis ボリュームの
  中身(metadata/jwt/keys/parsed/マーカー)に加えて、genesis サービスに
  rw でマウントを追加する `clpeer`/`elpeer` の boot ファイルと
  `/heartbeat` 配下(suspend マーカー含む)も消してから生成する。
- 再生成した/しなかった理由(最新ハートビートの経過秒数)を必ずログに出す
  (無言で分岐しない)。
- しきい値は環境変数(例: `GENESIS_DOWNTIME_RESET_SEC`)で上書き可能に
  しておく(実機検証・QA で待ち時間を短縮するため。既定値はスクリプト内)。
- generator イメージ内で使えるコマンド(`stat -c %Y` / `find -newermt` 等、
  GNU か busybox か)は実装時に実機確認すること。

### 3-3. サスペンド(稼働したまま PC がスリープ)への対応 — watchdog

「スタックを起動したままホストがスリープした」場合、レジューム後もコンテナは
稼働し続けるため、(a) ハートビートは新鮮なまま再生成が働かず、(b) チェーン
時刻のギャップだけが生まれて稼働中のままハングする。これは Issue #148 の
「PC停止等」の中でおそらく最も起きやすいケース(ノート PC の蓋を閉じる)なので、
次の watchdog で「停止していた場合」と同じ状態に変換する:

- ハートビートループを流用し、各イテレーションで前回からの経過秒数
  (delta)を測る。10 秒間隔のループで delta が **600 秒**を超えるのは
  サスペンド/`docker pause` 以外に実質あり得ない(通常はスケジューラの
  ジッタ程度)。
- delta > 600 秒を検知したら: ハートビートを**触らずに**、
  `/heartbeat/suspend-detected`(poison マーカー)を作成し、理由をログに
  出してから `kill -TERM 1` で自ノードのプロセス(exec 済みの reth /
  lighthouse。docker stop が効いていることから SIGTERM ハンドラを持つ)を
  止める。コンテナは exited になる(restart ポリシー無しなので再起動しない)。
- `lighthouse-vc.sh` にも同じ watchdog(kill のみ。ハートビート書き出しと
  poison 書き出しは不要なのでマウント追加も不要)を入れる。これが無いと、
  レジューム後に beacon だけが self-stop → 次の `up -d` で genesis が
  再生成されたとき、**止まらず生き残った validator が古い
  genesis_validators_root の設定で署名し続けて**チェーンが不健全になる。
- generate-genesis.sh 側の特例: poison マーカーが存在する場合、
  RESET_GRACE(600秒)を待たず **age > LIVE_THRESHOLD(60秒)で再生成**する
  (self-stop 済みなので、ユーザーがレジューム直後に `up -d` しても確実に
  再生成される)。poison があるのに age <= 60 秒(まだ生きているノードが
  いる)場合は再生成せず、警告ログを出してスキップする。
- 動的追加ノード(addNode)も同じスクリプトなので watchdog は動く
  (poison の書き出しだけガードされて何も書かない)。サスペンド後に
  self-stop し、そのまま停止したままになるのは許容(使い捨て・ユーザーが
  再追加すればよい。ログに理由は残る)。

### 3-4. しきい値と、その前提(CLAUDE.md「固定値の前提を明記する」への対応)

| 定数 | 値 | 前提・導出 |
| --- | --- | --- |
| ハートビート間隔 | 10 秒 | LIVE_THRESHOLD の 1/6。ファイル touch のみでコスト無視できる |
| LIVE_THRESHOLD | 60 秒 | 「直近 1 分以内に生存報告があるか」。間隔の 6 倍でジッタ耐性を持つ。誤判定(生きているのに stale 扱い)しても、失われるものが無い再生成が走るだけ |
| RESET_GRACE | 600 秒 | 温存する最大ギャップ = 300 slot(slot 2 秒)。#139 の QA 実測では 20 vCPU で 1350 slot を約 90 秒で追いつき(≒15 slot/秒 ≫ 必要な 0.5 slot/秒)、ハングは 3200 slot 以上でのみ観測。300 slot は観測ハング点の 1/10 以下で、数倍遅いマシンでも安全側。**特定環境の実測値ぎりぎりに合わせた値ではない** |
| watchdog delta | 600 秒 | 10 秒間隔のループが 10 分止まるのはサスペンド/pause のみ。誤発火の条件(スケジューラが 10 分凍結)が成立する環境ではチェーンも維持できていない。発火の結果も「self-stop → 次回 up で再生成」で破壊的でない |

これらの前提は実装時にスクリプト内コメントにも明記すること。

### 3-5. `--ignore-ws-check` は維持する

案Gにより通常の停止→再起動では genesis が新しくなる(または ≤300 slot の
ギャップ)ため weak subjectivity CRIT は起きなくなるが、**長時間稼働中の
スタックに対する `restart-node.sh`**(genesis サービスは走らないので
再生成されない)では、genesis が 4.6 時間より古い状態で beacon が slot 0 から
起動するため、フラグが無いと従来どおり CRIT で落ちる。このパスの保険として
フラグは維持する(スクリプトのコメントは案Gを踏まえて更新すること)。

## 4. 変更ファイルと担当分担

すべて **node-env** の担当。shared / collector / frontend への変更は無い
(型・スキーマ・プロトコルに影響しない。よって docs/ARCHITECTURE.md も
変更不要 — 同ドキュメントはプロファイル内スクリプトの挙動を扱っていない。
Issue #43/#139 と同じ整理)。

1. `profiles/ethereum/docker-compose.yml` — `heartbeat` ボリューム追加。
   reth1/2・beacon1/2 に `/heartbeat` rw マウント。genesis サービスに
   `heartbeat`/`clpeer`/`elpeer` の rw マウント追加
2. `profiles/ethereum/scripts/reth-node.sh` /
   `lighthouse-bn.sh` — ハートビートループ + watchdog(3-1, 3-3)
3. `profiles/ethereum/scripts/lighthouse-vc.sh` — watchdog のみ(3-3)
4. `profiles/ethereum/scripts/generate-genesis.sh` — 再生成判断(3-2, 3-3)
5. `profiles/ethereum/README.md` — 「長時間停止後の再起動と weak
   subjectivity(Issue #139)」節を改訂し、自動リセットの挙動(10 分以上の
   全停止・サスペンドでチェーンが自動的に作り直されること、残高等は
   変わらないこと、`down -v` は引き続き有効な手動リセットであること)を記載

実装順序の依存: 1 → 2/3 → 4 の順が自然(4 の判断はハートビートが書かれて
いる前提)。ただし単一担当なので分割の必要は無い。コミットは関心事ごと
(compose/スクリプト/README)に分けること。

## 5. 検証計画(実装担当・QA 向け)

#139 と同様、scratchpad へのコピー + 別プロジェクト名・別サブネットの独立
compose で行い、本物のスタックに触れないこと。genesis 時刻オフセット
(`TEST_GENESIS_TIMESTAMP_OFFSET_SEC` 方式)とハートビート mtime の偽装
(`touch -d '2 hours ago'`)を組み合わせる。

- R1(本命・修正前後の再現): 古い genesis(オフセット 6 時間)+ stale な
  ハートビートで `up -d` → 再生成が走り、CRIT もハングも無くブロック生成が
  始まること。修正前(現行スクリプト)では同条件でハングすることを先に再現する
- R2(Issue #56 の回帰): 稼働中スタックへの `up -d` 再実行 → 再生成されず
  (ログで確認)、genesis ハッシュ不変・チェーン進行が途切れないこと
- R3(短時間停止): 2〜3 分停止して `up` → 再生成されず、従来どおり
  ギャップ再構築で追いつくこと
- R4(サスペンド): 全ノードコンテナを `docker pause` で 600 秒超凍結 →
  unpause → 各ノードが poison マーカーを書いて self-stop すること →
  `up -d` で再生成され、正常にブロック生成が始まること
- R5(restart-node.sh の回帰): 稼働中スタックでのノード単位再起動が
  従来どおり自己回復すること(genesis 再生成が走らないこと)
- R6(addNode の回帰): 動的追加ノードが /heartbeat 無しでも起動し
  (`set -e` で死なない)、既存チェーンに追従すること
- 仕上げに `pnpm lint && pnpm build && pnpm test`(TS 変更は無いが恒例の
  確認)と、必要に応じて packages/e2e

## 6. 決定済み事項(実装担当が前提にしてよいこと)

- 方式は案G(ハートビート + 条件付き genesis 自動再生成 + サスペンド
  watchdog)。checkpoint sync / /data 永続化は採らない(理由は 2. )
- しきい値と前提は 3-4 の表のとおり(環境変数での上書き口を設ける)
- `--ignore-ws-check` は維持(3-5)
- genesis ボリュームのノード側 `:ro` は変えない。生存報告は専用の
  `heartbeat` ボリュームで行う
- addNode の動的ノードにはハートビートを持たせない(collector 変更なし)。
  「compose ノード全停止中に動的ノードだけ稼働 → `up -d` で再生成 →
  動的ノードだけ古い genesis のまま」という組み合わせは実運用上起こり
  にくく、起きても使い捨てノードの再追加で済むため許容する

## 7. 実装時に判断してよいこと(設計では固定しない)

- ハートビートファイルの命名(hostname かサービス名を env で渡すか。
  判断に使うのは「最新の mtime」だけなので命名は自由)
- mtime 取得の実装(`stat` / `find -newermt` 等。generator イメージ内の
  ツール実機確認とセットで)
- 再生成時のログ文言・ハートビートスキップ時のログ文言
- 環境変数名(例: `GENESIS_DOWNTIME_RESET_SEC`)

## 8. スコープ外・残る既知の限界(README か worklog に明記すること)

- **長時間(ハング閾値超)稼働中のスタックへの `restart-node.sh`**: 再起動
  したノードは古い genesis から起動するが、生きている相手ノードから P2P で
  同期する経路(#43/#44)があるため単独再構築とは条件が異なる。#139 の
  検証はこのケースを未確認のまま(両ノード同時停止のみ検証)。本 Issue の
  対象(全体停止からの復旧)外とし、問題が実際に観測されたら別 Issue とする
- collector / GUI 上での「チェーンが再生成された」ことの明示的な通知は
  行わない(ノードカードの blockHeight が 0 から再スタートすることで
  間接的には見える)。必要になったら UX 課題として別途起票する
- 本変更を稼働中の旧スタックへ適用(`up -d`)すると、マウント構成の変更で
  全コンテナが再作成され、ハートビートが無いため genesis も再生成される
  (= 一度チェーンがリセットされる)。再起動でチェーンが残らないのは従来
  どおりなので実害は無いが、挙動として知っておくこと

## 9. 統括への確認事項(推奨案つき)

いずれも設計としては上記の推奨で決め打ちしてよいと考えるが、仕様上の
判断なので明示しておく:

1. **サスペンド watchdog(3-3)を初回実装に含めるか**: 含めることを推奨
   (ノート PC の蓋閉じが #148 の最も現実的な発生経路であり、これを外すと
   「復旧する」の完了条件をスリープ経路で満たせない)。リスクを分けたい
   場合は「停止検知 + 再生成(3-1/3-2)を先に実装・検証 → watchdog を
   後続コミット」と段階を分けられる
2. **停止 10 分でチェーンが自動リセットされる挙動の許容**: 現状でも再起動で
   チェーンの中身は必ず失われるため、実質的な差は「genesis タイムスタンプ/
   ハッシュが変わる」ことだけ。許容できると判断するが、ユーザー視点の
   確認を推奨(README に明記する前提)

### 2026-07-07 Issue #148 実装(node-env)

- 担当: node-env
- ブランチ: issue-148-genesis-rebuild-hang
- 内容: 上記設計(案G。ハートビート + 条件付き genesis 自動再生成 +
  サスペンド watchdog)をユーザー承認済みの内容(watchdog を初回実装に
  含める)で実装した。

- 変更ファイル:
  - `profiles/ethereum/docker-compose.yml`: 名前付きボリューム `heartbeat`
    を追加。`reth1/2`・`beacon1/2` に `/heartbeat` を rw マウントし、各
    サービスに `HEARTBEAT_NODE_NAME`(reth1/reth2/beacon1/beacon2)を渡す。
    `genesis` サービスに `heartbeat`/`clpeer`/`elpeer` の rw マウントを
    追加(再生成時に down -v 相当のクリーンさにするため)。
  - `profiles/ethereum/scripts/reth-node.sh` /
    `profiles/ethereum/scripts/lighthouse-bn.sh`: ハートビートループ
    (10 秒間隔で `/heartbeat/<自分の識別名>` を touch)+ watchdog
    (前回ループからの経過秒数が 600 秒を超えたらサスペンドと判断し、
    poison マーカー `/heartbeat/suspend-detected` を書いてから
    `kill -TERM 1` で自ノードを止める)を追加。`/heartbeat` が
    マウントされていない場合(addNode の動的追加ノード)はループを
    スキップし、1 行ログを出して続行する(`set -e` でコンテナが
    死なないようガード済み)。
  - `profiles/ethereum/scripts/lighthouse-vc.sh`: watchdog のみ追加
    (ハートビートの書き出し・poison マーカーの書き出しは行わない。
    validator はサスペンド後に自己停止するだけでよい)。
  - `profiles/ethereum/scripts/generate-genesis.sh`: 再生成判断ロジックを
    実装。マーカー無し→生成(初回)。マーカー有りの場合は
    `/heartbeat`(poison マーカーを除く)の最新更新時刻からの経過秒数で
    判断: poison マーカーがあれば経過 > 60 秒(LIVE_THRESHOLD)で再生成、
    poison が無ければ経過 <= 60 秒でスキップ・経過 > 600 秒
    (RESET_GRACE)で再生成・その中間はスキップ。ハートビートファイルが
    1 つも無い場合も安全側として再生成する。再生成時は genesis
    ボリューム本体に加え、`clpeer`/`elpeer` の boot ファイルと
    `/heartbeat` 配下(poison マーカー含む)も削除してから生成する。
    判断理由は必ずログに出す。
  - `profiles/ethereum/README.md`: 「長時間停止後の再起動と自動リセット
    (Issue #139 / #148)」に節を改訂し、自動リセットの挙動・しきい値・
    既知の限界(長時間稼働中スタックへの `restart-node.sh`、addNode の
    動的ノードにはハートビートが無いこと)を記載。「冪等性」節・
    「ノードを増やすには」節も本 Issue の変更を反映して更新した。

- しきい値(環境変数で上書き可能。既定値は設計どおり):
  - `GENESIS_LIVE_THRESHOLD_SEC`(既定 60 秒)
  - `GENESIS_DOWNTIME_RESET_SEC`(既定 600 秒。RESET_GRACE)
  - `GENESIS_SUSPEND_DETECT_SEC`(既定 600 秒。watchdog delta)
  - `HEARTBEAT_INTERVAL_SEC`(既定 10 秒)
  - 前提・導出根拠は本ファイル「3-4」の表のとおりで、各しきい値の定義
    箇所(`generate-genesis.sh`・`reth-node.sh`・`lighthouse-bn.sh`・
    `lighthouse-vc.sh`)のコメントにも明記した。

- 実装時に気づいた設計からの差分(要申し送り):
  - **ハートビートファイル名に compose の暗黙のコンテナホスト名は使えない
    ことが実機確認で判明した**。当初は `hostname` コマンド(compose が
    サービス名をホスト名にすると想定)でファイル名を作る予定だったが、
    実機で確認したところ `hostname` はコンテナ再作成のたびに変わる短い
    コンテナ ID を返した(判定ロジック自体は「最新 mtime」だけを見るため
    実害は無いが、コンテナが再作成されるたびに古いコンテナ ID 名のファイル
    が残り続け、`/heartbeat` の中身が読みづらくなる)。対応として
    `HEARTBEAT_NODE_NAME` 環境変数(docker-compose.yml で reth1 等の
    サービス名を渡す)を追加し、未設定時は従来どおり `hostname` に
    フォールバックする方式にした(設計の「7. 実装時に判断してよいこと」
    の裁量範囲内)。

- 実機検証(scratchpad 上の独立 compose プロジェクトで実施。メイン
  worktree で稼働中の本物の `chainviz-ethereum` には一切触れていない。
  検証前後で `docker compose ls` の UPTIME・コンテナ数に変化が無いことを
  確認済み):
  - 検証環境: `/home/zoe/workspace/chainviz-wt-148/profiles/ethereum` を
    scratchpad にコピーし、プロジェクト名(`chainviz-eth148before` /
    `chainviz-eth148test` / `chainviz-eth148after`)・サブネット
    (`172.96.0.0/16` 等)・公開ポートを本物と衝突しないよう変更した
    独立 docker compose プロジェクトで行った。検証後はすべて
    `docker compose down -v` で破棄済み。
  - **R1(本命。修正前後の再現)**:
    - 修正前: 本 Issue 着手前の `generate-genesis.sh`(この worktree の
      当時の HEAD からコピー)に検証専用の
      `TEST_GENESIS_TIMESTAMP_OFFSET_SEC` 環境変数分岐を一時的に追加し
      (Issue #139 と同じ手法。本番コードには入れていない)、genesis 時刻を
      3 時間前に固定して起動した。結果、beacon が `Producing block at
      incorrect slot` / `Timed out waiting for fork choice before
      proposal` を繰り返し、`head_slot` が進まないまま CPU 使用率
      600〜700% でハングし、`eth_blockNumber` が `0x0` のまま停止する
      ことを確認した(Issue #139 で確認した現象の再現)。
    - 修正後: 同じくオフセットありで genesis を生成した状態(3 時間前の
      genesis)に加え、`/heartbeat` 配下に `reth1`/`reth2`/`beacon1`/
      `beacon2` の各ファイルを作り `touch -d` で 667 秒前に更新時刻を
      偽装(全ノードが停止していた状態を模擬)した上で、修正後の
      `generate-genesis.sh`(オフセット指定なし = 実時間)で
      `docker compose up -d` した。ログに
      `[generate] 最新ハートビートの経過 667秒 > RESET_GRACE(600秒)。
      全ノードが長時間停止していたとみなし再生成する。` が出力され、
      genesis が現在時刻で再生成された。CRIT・ハングは発生せず、
      `head_slot` が `current_slot` に一致して進行し、
      `eth_blockNumber` が継続的に増加すること(45 秒待って `0x1a` まで
      進行)を確認した。
  - **R2(Issue #56 の回帰確認)**: 修正後のスタックを起動し、ブロックが
    進行中の状態で `docker compose up -d` を再実行した。ログに
    `[generate] 最新ハートビートの経過 5秒 <= LIVE_THRESHOLD(60秒)。
    生存ノードありとみなし再生成をスキップする(Issue #56 の保護)。` が
    出力され、`genesis.json` の sha256 ハッシュが再実行前後で不変、
    全コンテナが再作成されず稼働継続(Up 秒数が連続)、ブロック高が
    `0x6` → `0xd` へ途切れず進行することを確認した。
  - **R3(短時間停止)**: `docker compose stop` で全コンテナを停止し、
    `/heartbeat` 配下のファイルを `touch -d "2 minutes ago"` で 126 秒前に
    偽装した状態で `up -d` した。ログに `[generate] 最新ハートビートの
    経過 126秒 は LIVE_THRESHOLD(60秒)超・RESET_GRACE(600秒)以下。
    短時間の停止とみなし再生成をスキップする` が出力され、genesis は
    再利用されたまま、ブロック高が途切れず進行(`0xd` → `0x14` →
    `0x20`)することを確認した。
  - **R4(サスペンド)**: 待ち時間短縮のため
    `HEARTBEAT_INTERVAL_SEC=3` / `GENESIS_SUSPEND_DETECT_SEC=15`
    (env 上書きの実効性そのものの確認も兼ねる)でスタックを起動し、
    `docker compose pause` で全ノードコンテナを 30 秒間凍結後 unpause
    した。ログに `[reth-heartbeat] 40秒の空白を検知(閾値 15秒)。
    サスペンドと判断し自ノードを停止する` 等が出力され、
    `/heartbeat/suspend-detected` が作成され、`reth1/2`・`beacon1/2`・
    `validator1/2` の全 6 コンテナが `Received SIGTERM` を経て正常終了
    (exit code 0)することを確認した。この状態で `up -d` すると、
    ログに `[generate] サスペンド検知マーカー
    (/heartbeat/suspend-detected)を検出。最新ハートビートの経過 80秒 >
    LIVE_THRESHOLD(60秒)。全ノード停止とみなし再生成する。` が出力され、
    genesis が再生成されて `/heartbeat` の poison マーカーも一掃され、
    ブロック生成が正常に再開する(`0x3` まで進行)ことを確認した。
  - **R5(restart-node.sh の回帰確認)**: R4 後の稼働中スタックに対して
    `./scripts/restart-node.sh 1` を実行し、`reth1`/`beacon1`/`validator1`
    のみが再起動されること、genesis サービスは走らず(ログに新規
    `[generate]` 出力が無いこと)、beacon1 が一時的に `peer_count: 0` に
    なった後 P2P 再接続して `head_slot`/`current_slot` が一致し、ブロック
    高が途切れず進行することを確認した(Issue #43 で確立した挙動に回帰が
    無いことを確認)。
  - **R6(addNode の回帰確認)**: `docker run` で `/heartbeat` を
    マウントしない `reth-node.sh` / `lighthouse-bn.sh` を単体起動し(collector
    の `addNode` が動的に作るコンテナの構成を模擬)、ログに
    `[reth-heartbeat] /heartbeat が無い/書き込めない(動的追加ノード等)
    ためハートビート/watchdogをスキップする` /
    `[beacon-heartbeat] ...` が出力され、`set -e` でコンテナが落ちることなく
    既存チェーンに正常参加(bootnode の enode/ENR を取得し peer として
    起動、`connected_peers=1`)することを確認した。
  - 仕上げに `pnpm lint && pnpm build && pnpm test` を実行し、全て成功
    することを確認した(本 Issue に TypeScript の変更は無い)。

- 決定事項・注意点(次の担当が知っておくべきこと):
  - ハートビートファイル名は `HEARTBEAT_NODE_NAME` 環境変数で明示するのが
    このプロファイルの標準(`docker-compose.yml` 参照)。ノードを増やす際
    (README「ノードを増やすには」参照)は忘れずに設定すること(無くても
    動作はするが `/heartbeat` の中身が読みづらくなるだけ)。
  - `docs/worklog/issue-148.md` 冒頭の設計セクション(1〜9)は変更して
    いない。本セクションが実装内容・実機検証記録の追記。
  - 本 Issue で `packages/shared` を含む TypeScript パッケージへの変更は
    無い(設計時点の判断どおり)。
