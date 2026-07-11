# Issue #286 作業記録

### 2026-07-11 Issue #286 長時間稼働スタックの短時間再起動で genesis が古いまま再利用される問題への対応設計(designer)

- 担当: designer
- ブランチ: issue-286-genesis-reuse-guard
- 内容: 長時間(ハング閾値超)稼働したスタックを `docker compose down` →
  `up` で短時間に再起動すると、genesis が古いまま再利用され、全ノードが
  datadir を失った状態で genesis(slot 0)から膨大な空き slot を再構築
  しようとして恒久ハングする問題(chainviz-detective の実機調査で確認済み)
  への対応方針を設計した。結論は「**再生成判定の入力を『停止時間』から
  『genesis 年齢(= 再構築が必要な量)』に置き換え、稼働中かどうかは
  ハートビート mtime の前進をサンプリング観測して実測で判別する**」。
  実装は node-env のみで完結し、shared / collector / frontend への変更は
  無い(#148 と同じ整理。docs/ARCHITECTURE.md はプロファイル内スクリプトの
  挙動を扱わないため変更不要)。

## 1. 問題の構造(なぜ #148 の保護をすり抜けるのか)

- ノードスクリプト(`reth-node.sh` / `lighthouse-bn.sh`)は起動のたびに
  datadir を全消去する(Issue #41/#43/#56 で確立した「毎回まっさらに init
  するから、どのノードもいつ再起動しても現在の genesis と必ず整合する」
  という前提)。したがって**スタックが一度でも全停止すると、次の起動で
  再構築しなければならない slot 数は「停止していた時間」ではなく
  「genesis 生成時刻からの総経過時間(genesis 年齢)」で決まる**。
- 一方、#148 で入れた `generate-genesis.sh` の `should_regenerate()` は
  「最新ハートビートの経過秒(= 停止時間)」だけをしきい値と比べている。
  このため次の 2 つの窓で「genesis は古い(再構築不能)のに再生成しない」
  という判定になる:
  1. 停止時間 <= LIVE_THRESHOLD(60 秒): 「生存ノードあり」とみなして
     スキップ(Issue #56 の保護のつもりだが、`down` 直後の `up` も同じ
     見え方になる)
  2. 60 秒 < 停止時間 <= RESET_GRACE(600 秒): 「短時間の停止」として
     スキップ(#139 で検証したのは genesis が若いスタックであり、
     genesis が古いスタックではこの領域でも再構築量は genesis 年齢分ある)
- 実測(detective 調査): 約 11 時間稼働(約 19,800 slot)のスタックを
  短時間で down→up すると、beacon が slot 0 から現在まで追いつけず
  CPU 約 900% の恒久スピンに陥る(ハング閾値は 20 vCPU 環境で約 3,200
  slot。docs/worklog/issue-139.md)。beacon API が不安定になり、P2P エッジ
  のフラッピング(#287/#288 の引き金)や mempool tx の永久未確定として
  利用者に見える。
- 同種の境界事例は docs/worklog/issue-211.md でも観測済み(compose 設定
  変更による全ノード一斉 Recreate で、旧コンテナ停止直前のハートビートが
  「新鮮」と判定され古い genesis が再利用された)。当時は
  `GENESIS_DOWNTIME_RESET_SEC=0` の手動回避で済ませ Issue 化を見送って
  いたが、本 Issue はその恒久対応にあたる。

## 2. 選択肢の比較

### 案(a): datadir を起動時に消さず保持する — 不採用

#148 設計(docs/worklog/issue-148.md「案2」)で不採用にした理由がそのまま
生きている:

- 「古い datadir × 再生成された genesis」という新しい不整合の故障モードを
  持ち込む。これを防ぐには全ノードスクリプトに「保存された datadir が
  現在の genesis と一致するか」の検証・無効化ロジックが必要になり、
  本 Issue の対処(判定ロジックの入力を正す)より大きく複雑な変更になる。
- Issue #41/#43/#56 で確立した「毎回まっさらに init する」前提
  (addNode の動的ノード・restart-node.sh もこの前提)を崩す。
- サスペンド経路(稼働したままのギャップ)には効かず、#148 の機構は
  どのみち必要。
- 本 Issue に限れば「down→up で停止時間分だけ追いつけばよくなる」利点は
  あるが、上記コストに見合わない。#148 の設計判断と整合させる。

### 案(b)の精密化(採用): 判定量を genesis 年齢に置き換え、生死は実測する

Issue 本文の案 (b)「経過スロット数がしきい値を超え、かつ全ノードの
datadir が空なら再生成」を、次の 2 点で精密化する:

- 「全ノードの datadir が空か」は genesis サービスからは観測できない
  (datadir は各ノード専用ボリュームで genesis コンテナにマウントされて
  いない)し、観測する必要も無い。**スタックが全停止していたなら、次の
  起動で全ノードが datadir を消して slot 0 から再構築する**ことが
  スクリプトの仕様として確定しているため、「全停止していたか」だけ
  分かればよい。
- 「全停止していたか」をハートビートの新鮮さ(mtime の古さ)で判定する
  のが #286 の穴なので、危険なケースに限り**ハートビート mtime が前進
  するかをサンプリング観測**して「実際に生きているノードがいるか」を
  実測する。`docker compose up` では全ノードが
  `depends_on: genesis: service_completed_successfully` を持つため、
  genesis サービスの判定中に compose 側のノードは起動できない。つまり
  サンプリング中に mtime を前進させられるのは「前回の up から生き続けて
  いるノード」だけであり、これが判別の正しさの根拠になる(実装時に
  スクリプトコメントへ明記すること)。addNode の動的ノードはハートビート
  を書かない(#148)ので判定を撹乱しない。

## 3. 採用案の設計

### 3-1. genesis 年齢の取得

- 生成時に `GENESIS_TIMESTAMP`(既に `export` している現在時刻 epoch 秒)
  を `/data/.genesis-timestamp` へ書き出す。完了マーカーと同様、生成が
  すべて成功したときだけ残るようにし(値は export 時点のものを使う)、
  「前回の生成物を破棄」の `rm` 対象にも加える。
- 判定時は `genesis_age = now - $(cat /data/.genesis-timestamp)`。
- **フォールバック**(本変更より前に生成された既存ボリューム対策):
  `.genesis-timestamp` が無ければ完了マーカー `/data/.genesis-complete` の
  mtime(`stat -c %Y`。generator イメージの GNU coreutils 前提 —
  `latest_heartbeat_epoch` の `find -printf` と同じ前提)を使い、
  フォールバックした旨をログに出す。マーカー mtime は生成完了時刻なので
  genesis 時刻よりバリデーター鍵導出の所要時間(高々 1 分程度)だけ遅く、
  genesis 年齢をやや過小評価するが、しきい値 600 秒に対して許容範囲。

### 3-2. `should_regenerate()` の新しい判定ロジック

```
1. 完了マーカー無し → 再生成(初回。従来どおり)
2. poison マーカー(suspend-detected)有り → 従来どおり変更なし
   (hb_age > LIVE_THRESHOLD で再生成、それ以外は警告してスキップ)
3. genesis_age <= MAX_REBUILD_GAP(600 秒) → スキップ
   (稼働中でも全停止後でも安全: 停止後だとしても再構築量が
    300 slot 以下で追いつける。#139 で検証済みの領域)
4. genesis_age > MAX_REBUILD_GAP(genesis が古く、全停止後の再構築は不能):
   4a. hb_age > LIVE_THRESHOLD(60 秒)、またはハートビートが 1 つも無い
       → 再生成(全ノード停止が確定している)
   4b. hb_age <= LIVE_THRESHOLD → サンプリング:
       2 × HEARTBEAT_INTERVAL_SEC 秒待って最新ハートビート mtime が
       前進したかを見る
       - 前進した → スキップ(実際に稼働中。Issue #56 の保護)
       - 前進しない → 再生成(down 直後の再起動、または全ノード一斉
         Recreate。ノードは次の起動で datadir を失う。#286 の本命)
```

- 従来どおり、どの分岐でも理由(genesis 年齢・ハートビート経過秒・
  サンプリング結果)を必ずログに出す(無言で分岐しない)。
- **従来の再生成ケースはすべて維持される**: ハートビートは再生成時に
  一掃され、その後にノードが書くため、常に genesis_age >= hb_age が
  成り立つ。よって旧ロジックの「hb_age > RESET_GRACE(600 秒)→ 再生成」
  に該当するケースは、新ロジックでも genesis_age > 600 秒 → 4a で必ず
  再生成になる(しきい値既定値が同じ場合)。
- **意図的な挙動変更が 2 つある**:
  1. 「genesis が古い × 停止時間が短い(0〜600 秒)」→ 旧: スキップ
     (#286 のバグ)、新: サンプリングまたは 4a を経て再生成。
  2. 「ハートビートが 1 つも無い × genesis が若い」→ 旧: 安全側で再生成、
     新: ステップ 3 でスキップ。これは #148 レビューで指摘された
     「再生成完了直後〜ノードの初回ハートビートまでの数秒間に `up -d` を
     重ねると再度の再生成になる」窓の解消でもある(genesis が若ければ
     再利用してよい)。genesis が古くてハートビートが無い場合は従来
     どおり 4a で再生成(安全側)になる。

### 3-3. しきい値と、その前提(CLAUDE.md「固定値の前提を明記する」への対応)

| 定数 | 値 | 前提・導出 |
| --- | --- | --- |
| `GENESIS_MAX_REBUILD_GAP_SEC` | 600 秒(= 300 slot) | 「スタック再起動時にノードが slot 0 から再構築してよい最大ギャップ」。#148 の RESET_GRACE と同じ導出(#139 実測: 20 vCPU で 1,350 slot を約 90 秒で追いつき、ハングは 3,200 slot 以上でのみ観測。300 slot は観測ハング点の 1/10 以下で数倍遅いマシンでも安全側。**特定環境の実測値ぎりぎりに合わせた値ではない**)。CPU 性能依存のため環境変数で上書き可能 |
| `GENESIS_LIVE_THRESHOLD_SEC` | 60 秒 | 変更なし(#148 のまま)。ただし役割が「生存の証明」から「**停止の証明**(これより古ければ確実に全停止)+ サンプリング要否の一次判定」に変わる。60 秒以内の新鮮さは生存を証明しない(down 直後も新鮮)ことが #286 の教訓であり、生存の証明はサンプリングが担う |
| サンプリング窓 | 2 × `HEARTBEAT_INTERVAL_SEC`(既定 20 秒) | 新規の独立定数を置かず既存のハートビート間隔から導出する。生存ノードは touch → sleep(間隔)のループで間隔ごとに必ず touch するため、2 周期観測すれば生存ノードがいる限り最新 mtime が必ず前進する。サンプリングが走るのは「genesis が古い × ハートビートが新鮮」の曖昧ケースのみで、通常の初回起動・若いスタックの再起動・全停止確定(4a)のパスでは待ち時間ゼロ |

- 環境変数名は `GENESIS_DOWNTIME_RESET_SEC` から
  `GENESIS_MAX_REBUILD_GAP_SEC` へ**改名する**。判定量が「停止時間」から
  「genesis 年齢(再構築ギャップ)」に変わるため、旧名のままだと意味を
  誤解させる。互換エイリアスは設けない(注入点は
  `profiles/ethereum/docker-compose.yml` の environment: のみで、同じ
  コミットで追従できる。ローカル開発環境であり外部利用者はいない)。
  なお docs/worklog/issue-211.md に記録されている回避策
  `GENESIS_DOWNTIME_RESET_SEC=0` は本変更後
  `GENESIS_MAX_REBUILD_GAP_SEC=0` に読み替えになる(過去の worklog は
  歴史記録なので書き換えず、README に現行の変数名で記載する)。

### 3-4. サスペンド watchdog(#148 3-3)は変更しない

poison マーカー経路は従来どおり(hb_age > LIVE_THRESHOLD で再生成)。
watchdog が発火する条件(600 秒超の空白)が成立した時点で genesis_age も
600 秒を超えているため、genesis 年齢判定に統合しても結果は変わらず、
変更しない方が差分が小さい。ノード側スクリプトのハートビート/watchdog
ループも変更不要。

## 4. 変更ファイルと担当分担

すべて **node-env** の担当。shared / collector / frontend への変更は無い。

1. `profiles/ethereum/scripts/generate-genesis.sh` —
   判定ロジックの置き換え(3-2)、`/data/.genesis-timestamp` の書き出し・
   破棄時の削除・フォールバック(3-1)、しきい値定義とコメント更新(3-3)
2. `profiles/ethereum/docker-compose.yml` — genesis サービスの
   environment: で `GENESIS_DOWNTIME_RESET_SEC` →
   `GENESIS_MAX_REBUILD_GAP_SEC` に改名し、サンプリング窓の導出用に
   `HEARTBEAT_INTERVAL_SEC: ${HEARTBEAT_INTERVAL_SEC:-10}` を追加
   (ノード側と同じ既定値。ノード側の間隔を上書きする場合は genesis 側も
   同じ値が渡る構造にする — シェル前置きなら同名変数なので自動で揃う)
3. `profiles/ethereum/README.md` — 「長時間停止後の再起動と自動リセット
   (Issue #139 / #148)」節を改訂: 判定基準が「停止時間」から
   「genesis 年齢 + 生存サンプリング」に変わったこと、長時間稼働スタック
   の down→up は(停止が短くても)チェーンが自動的に作り直されること、
   変数名の変更、動的ノード(addNode)が再生成で取り残される頻度が
   上がること(下記 7.)
4. `docs/PLAN.md` / `docs/WORKLOG.md` / 本ファイル — 記録

実装順序の依存は無し(単一担当)。コミットは関心事ごと(スクリプト+
compose の挙動変更 / README / docs)に分けること。

## 5. 検証計画(実装担当・QA 向け)

#139/#148 と同様、scratchpad へのコピー + 別プロジェクト名・別サブネットの
独立 compose で行い、本物のスタックに触れないこと。genesis を「古い」状態に
するには、実時間で待つ代わりに genesis 時刻オフセット
(`TEST_GENESIS_TIMESTAMP_OFFSET_SEC` 方式の検証用一時分岐。#139/#148 と
同じ手法で、本番スクリプトには入れない)か、`.genesis-timestamp` と
完了マーカーの値・mtime の偽装を使う。

- V1(#286 本命・修正前後の再現): genesis を古く(例: 3 時間前)した
  スタックを起動→稼働確認→ `docker compose down` → 60 秒以内に `up`。
  修正前: 「生存ノードあり」スキップ→ beacon が head_slot 0 のまま高 CPU
  でハング(再現)。修正後: サンプリングで前進なし→再生成→ハング無く
  ブロック進行
- V2(Issue #56 の回帰・最重要): 稼働中スタックへの `up -d` 再実行。
  (i) genesis が若い場合: 即スキップ(サンプリング無し)。
  (ii) genesis が古い場合(オフセット使用): サンプリングで前進検知→
  スキップ。いずれも genesis ハッシュ不変・コンテナ非再作成・ブロック高が
  途切れないこと
- V3(#148 R3 の回帰): genesis が若いスタックを 2〜3 分停止して `up` →
  スキップされ、ギャップ再構築で追いつくこと
- V4(#148 R4 の回帰): サスペンド(docker pause)→ poison 経路が
  従来どおり動くこと
- V5(#148 R5 の回帰): 稼働中スタックへの `restart-node.sh` で genesis
  サービスが走らないこと(変更なしの確認)
- V6(#148 R6 の回帰): /heartbeat 無しの動的ノードが起動でき、判定を
  撹乱しないこと
- V7(フォールバック): `.genesis-timestamp` を消した(= 本変更前の)
  ボリュームで、完了マーカー mtime へのフォールバックが機能しログが
  出ること。genesis が古ければ再生成、若ければ再利用になること
- V8(一斉 Recreate、issue-211 の境界事例): 稼働中の古い genesis の
  スタックに compose 設定変更(例: ラベル追加)で全ノード一斉 Recreate →
  再生成されて正常にブロック進行すること
- 仕上げに `pnpm lint && pnpm build && pnpm test`(TS 変更は無いが恒例の
  確認)

## 6. 決定済み事項(実装担当が前提にしてよいこと)

- 方式は 3. のとおり(genesis 年齢による判定 + 生存サンプリング)。
  datadir 永続化(案 a)は採らない(理由は 2.)
- ノードスクリプトの「起動のたびに datadir を全消去する」仕様は変更しない
  (#41/#43/#56 の前提を維持する)
- `GENESIS_DOWNTIME_RESET_SEC` は `GENESIS_MAX_REBUILD_GAP_SEC` に改名
  (互換エイリアス無し)。`GENESIS_LIVE_THRESHOLD_SEC` は名前・値とも維持
- サンプリング窓は 2 × `HEARTBEAT_INTERVAL_SEC` で導出(新規の独立定数を
  置かない)
- poison マーカー経路・ノード側ハートビート/watchdog は変更しない
- 3-2 の挙動変更 2 点(「古い genesis × 短時間停止で再生成」
  「ハートビート無し × 若い genesis でスキップ」)は意図的なもの

## 7. スコープ外・残る既知の限界(README か worklog に明記すること)

- **稼働し続けている動的ノード(addNode)の取り残され**: 本変更で
  「長時間稼働スタックの down→up」が再生成になるため、compose ノード停止中
  も生き続けた動的ノードが古い genesis のまま取り残される頻度は上がる。
  #148 §6 で許容済みの限界と同種(使い捨て・再追加で済む)であり許容する
- **`docker compose restart`**: depends_on の完了待ち順序が保証されない
  従来からの穴。README の推奨操作(down→up)の範囲外であり本 Issue の
  スコープ外
- **長時間稼働中スタックへの `restart-node.sh` 単体再起動**: #148 §8 の
  まま(genesis サービスが走らないので再生成されない。生きている相手
  ノードから P2P 同期する経路があるため全停止とは条件が異なる)。問題が
  実際に観測されたら別 Issue
- P2P エッジ表示のフラッピング(collector 側のタイムアウト・エラー
  ハンドリング)は副次症状として #287/#288 で別途対応

## 8. 実装時に判断してよいこと(設計では固定しない)

- `.genesis-timestamp` の書き出しタイミング(export 直後に書いて破棄
  対象にするか、完了マーカーと同時に書くか。ただし値は export 時点の
  `GENESIS_TIMESTAMP` を使うこと)
- サンプリングの実装詳細(before/after 比較の関数化、ログ文言)
- 判定関数の分割(`should_regenerate` が肥大化するなら genesis 年齢取得・
  サンプリングを関数に切り出す)

## 9. 実装方針の確認メモ(node-env)

設計メモ §6〜§8 を前提に、以下の方針で実装する(§8 の実装裁量に対する
自分の選択):

- `GENESIS_TIMESTAMP_FILE=/data/.genesis-timestamp` を `DONE_MARKER` と
  同じ場所(スクリプト冒頭の定数群)に追加する。
- 書き出しタイミングは `export GENESIS_TIMESTAMP=...` の直後
  (`/work/entrypoint.sh all` を呼ぶ前)。理由: 生成が途中で失敗しても
  `DONE_MARKER` が書かれないため、次回起動は「初回生成として扱う」分岐で
  必ず前回生成物(`.genesis-timestamp` 含む)を `rm -rf` してから作り直す。
  つまり書き出しタイミングを遅らせて完了マーカーと同時にする必要はない
  (半端な `.genesis-timestamp` が生き残ることはない)。
- genesis 年齢の取得はコマンド置換 `$(...)` を使う関数にしない。POSIX
  sh(dash)の `$(...)` はサブシェルで実行されるため、その中でログ用の
  `echo`(標準出力)を混ぜると呼び出し側が値としてキャプチャしてしまい
  壊れる。かわりに `compute_genesis_age()` を「戻り値ではなく副作用
  (グローバル変数 `GENESIS_AGE_SEC` への代入)で結果を渡す通常の関数
  呼び出し」として実装し、フォールバック時のログはその関数内で直接
  `echo`(標準出力)してよいようにする。
- `should_regenerate()` の分岐順序は設計メモ 3-2 の疑似コードのとおり
  (①マーカー無し→②poison→③genesis_age<=MAX_REBUILD_GAP→④ hb 判定/
  サンプリング)。既存の変数名 `age_sec`/`age_desc`(ハートビート経過)は
  `hb_age`/`hb_age_desc` に改名し、`genesis_age` と紛れないようにする。
- サンプリングの前後比較は「前(before)のタイムスタンプより後(after)が
  大きいか」で判定する(before が空 = ハートビート無しから始まって
  after が生じたケースも「前進」として扱う。理論上は poison
  マーカー・LIVE_THRESHOLD 判定を経ているのでこのケースはほぼ
  発生しないが、堅牢性のため考慮する)。
- 変更点は関心事ごとに分けてコミットする: (1)
  `generate-genesis.sh` のロジック本体、(2) `docker-compose.yml` の
  環境変数改名・追加、(3) `README.md` の記述更新、(4) `docs/PLAN.md` /
  `docs/WORKLOG.md` の記録。実装順序に依存は無いが、コミット順序は
  この並びにする(スクリプト→compose→README→docs)。

## 10. 実装記録(node-env)

- 担当: node-env
- ブランチ: issue-286-genesis-reuse-guard

### 実装内容

設計メモ §3 のとおり実装した。

- `profiles/ethereum/scripts/generate-genesis.sh`:
  - `GENESIS_TIMESTAMP_FILE=/data/.genesis-timestamp` を追加。生成時に
    `export GENESIS_TIMESTAMP=...` の直後で書き出し、次回生成物の
    `rm -rf` 対象にも含めた。
  - genesis 年齢の取得を `compute_genesis_age()` として切り出した。
    `$(...)` コマンド置換のサブシェル化を避けるため、戻り値ではなく
    グローバル変数 `GENESIS_AGE_SEC` への代入で結果を渡す通常の関数
    呼び出しにした(コマンド置換内で `echo` するとログ出力が値として
    キャプチャされて壊れるため)。フォールバック(`.genesis-timestamp`
    が無い場合に `DONE_MARKER` の mtime を使う)もここに実装した。
  - `should_regenerate()` を設計メモ 3-2 の判定順序どおりに書き換えた:
    ①マーカー無し→再生成、②poison マーカー(変更なし)、③genesis 年齢
    <= `MAX_REBUILD_GAP_SEC` なら常にスキップ、④それ以外は最新ハート
    ビートの経過で「全停止確定」または「サンプリング」に分岐する。
    サンプリングは `2 × HEARTBEAT_INTERVAL_SEC` 秒待ってハートビート
    mtime が前進したかを見る。
  - しきい値変数を `GENESIS_DOWNTIME_RESET_SEC` から
    `GENESIS_MAX_REBUILD_GAP_SEC` に改名(互換エイリアス無し)。
    `HEARTBEAT_INTERVAL_SEC` を新規に読むようにした(サンプリング窓の
    導出用)。
- `profiles/ethereum/docker-compose.yml`: genesis サービスの
  `environment:` を `GENESIS_DOWNTIME_RESET_SEC` →
  `GENESIS_MAX_REBUILD_GAP_SEC` に改名し、`HEARTBEAT_INTERVAL_SEC` を
  追加。冒頭のコメントも新しい判定基準に合わせて更新した。
- `profiles/ethereum/README.md`: 「冪等性と、稼働中かどうかの判定」
  「長時間停止後の再起動と自動リセット」の各節を新しい判定基準(genesis
  年齢 + 生存サンプリング)に合わせて書き換え、変数名の改名・意図的な
  挙動変更・動的ノードの取り残され頻度が上がる点を明記した。

### 実機検証

scratchpad 上の独立 compose プロジェクト(本物の `chainviz-ethereum`
スタックには一切触れていない。検証前後で `docker compose ls` に変化が
無いことを確認済み)で、設計メモの V1〜V8 をすべて実施した。genesis を
「古い」状態にする手段は、`TEST_GENESIS_TIMESTAMP_OFFSET_SEC` 環境変数
分岐(#139/#148 と同じ手法。本番コードには入れていない、検証用コピー
限定)と、`/data/.genesis-timestamp` を直接書き換える手段(稼働中の
ボリュームに対して genesis 年齢だけを偽装したいケース)を使い分けた。

- **V1(本命。修正前後の再現)**:
  - 修正前(この Issue 着手前の `generate-genesis.sh` を検証用に
    コピーし、`TEST_GENESIS_TIMESTAMP_OFFSET_SEC=14400` で genesis を
    4 時間前に固定して起動): 初回起動の時点で `head_slot` が 0 のまま
    `current_slot` だけ進み、beacon が `Producing block at incorrect
    slot` / `Timed out waiting for fork choice before proposal` を
    繰り返して CPU 653〜704% でハングし、`eth_blockNumber` が `0x0` の
    まま停止することを確認(#139 の現象の再現)。この状態で
    `docker compose down`(11 秒)→ 8 秒後に `up -d` すると、genesis
    ログに `最新ハートビートの経過14秒 <= LIVE_THRESHOLD(60秒)。生存
    ノードありとみなし再生成をスキップする` が出力され、古い genesis が
    再利用されたまま `eth_blockNumber` が `0x0`・CPU 650%超のハングが
    継続することを確認した(#286 のバグそのものを再現)。
  - 修正後(同じ手順): 初回起動時は同様にハングするが、`down`(11 秒)→
    `up -d`(23 秒。うち約 20 秒はサンプリング待ち)で、genesis ログに
    `genesis 年齢14449秒 > MAX_REBUILD_GAP(600秒)だが最新ハートビートの
    経過8秒 <= LIVE_THRESHOLD(60秒)。...20秒 サンプリングして...` →
    `サンプリング中にハートビート mtime が前進しなかった...再生成する`
    が出力され、genesis が現在時刻で再生成された。以降 15 秒で
    `eth_blockNumber` が `0x0` → `0x6` へ進行し、CPU が 650%超 → 32%に
    下がることを確認した。
- **V2(Issue #56 の回帰・最重要)**:
  - (i) genesis 若い状態で稼働中のスタックに `up -d` を再実行:
    サンプリングを経ずに `genesis 年齢43秒 <= MAX_REBUILD_GAP(600秒)。
    ...再生成せずスキップする` が即時出力され、コンテナの起動時刻
    (`State.StartedAt`)が不変、`eth_blockNumber` が `0x12` の
    ままブロックが途切れず進行することを確認。
  - (ii) 稼働中スタックの `.genesis-timestamp` だけを 1 時間前に偽装
    (実際には全ノードは生き続けている状態): `up -d` で `genesis 年齢
    3608秒 > MAX_REBUILD_GAP(600秒)だが...サンプリングして...` →
    `サンプリング中にハートビート mtime が前進した...稼働中とみなし
    再生成をスキップする` が出力され、コンテナが再作成されず
    (`State.StartedAt` 不変)、`eth_blockNumber` が `0x12` → `0x2b` へ
    途切れず進行することを確認した(genesis が古くても実際に生きて
    いれば #56 の保護が効くことの確認)。
- **V3(#148 R3 の回帰)**: genesis 若い状態(生成から 43 秒)で
  `docker compose stop`(全コンテナ停止)し 168 秒後に `up -d`。
  ログに `genesis 年齢192秒 <= MAX_REBUILD_GAP(600秒)。...再生成せず
  スキップする` が出力され(ハートビート経過秒を見ずに即時スキップ)、
  genesis は再利用されたまま `eth_blockNumber` が 15 秒で `0xa` まで
  進行(ギャップを再構築して追いつく)ことを確認した。
- **V4(#148 R4 の回帰)**: `HEARTBEAT_INTERVAL_SEC=3` /
  `GENESIS_SUSPEND_DETECT_SEC=15` でスタックを起動し、
  `docker compose pause` で全ノードを 40 秒間凍結後 unpause。ログに
  `[reth-heartbeat] 40秒の空白を検知(閾値15秒)。サスペンドと判断し
  自ノードを停止する` が出力され `suspend-detected` マーカーが作成
  →全 6 コンテナが exit code 0 で終了することを確認。この状態で
  `up -d` すると `サスペンド検知マーカー(...)を検出。最新ハートビート
  の経過73秒 > LIVE_THRESHOLD(60秒)。全ノード停止とみなし再生成する`
  が出力されて genesis が再生成され、poison マーカーも一掃され、
  15 秒で `eth_blockNumber` が `0xf` まで進行することを確認した
  (poison マーカー経路(3-4)は本 Issue で変更していないことの確認)。
- **V5(#148 R5 の回帰)**: V3 後の稼働中スタックに
  `./scripts/restart-node.sh 1` を実行。`reth1`/`beacon1`/`validator1`
  のみ再起動され、genesis コンテナの `State.StartedAt` が不変
  (=genesis サービスは走っていない)ことを確認。35 秒後
  `eth_blockNumber` が `0x9` → `0x10` へ進行することを確認した。
- **V6(#148 R6 の回帰)**: `/heartbeat` をマウントしない
  `reth-node.sh` を単体 `docker run` で起動(collector の `addNode` が
  作る動的ノードの構成を模擬)。ログに `[reth-heartbeat] /heartbeat が
  無い/書き込めない(動的追加ノード等)ためハートビート/watchdogを
  スキップする` が出力され、`set -e` で落ちずにコンテナが起動し続ける
  こと、`heartbeat` ボリュームにこのノード由来のファイルが作られず
  判定を撹乱しないことを確認した。
- **V7(フォールバック)**: `generate-genesis.sh` を単体
  `docker run`(compose を介さず)で、`.genesis-complete` のみ存在し
  `.genesis-timestamp` が無いボリュームに対して実行。マーカー mtime を
  700 秒前にした場合は `.../.genesis-timestamp が無い...完了マーカー
  の更新時刻...へフォールバックする` → `genesis 年齢718秒 >
  MAX_REBUILD_GAP(600秒)...再生成する`、30 秒前にした場合は
  `genesis 年齢31秒 <= MAX_REBUILD_GAP(600秒)...スキップする` と、
  フォールバックが両方向で正しく機能することを確認した。
- **V8(一斉 Recreate、issue-211 の境界事例)**: 稼働中スタックの
  `.genesis-timestamp` を 3000 秒前に偽装した状態で
  `docker compose up -d --force-recreate` を実行(全 6 ノードコンテナを
  同時に作り直す)。ログに `genesis 年齢3036秒 > MAX_REBUILD_GAP(600秒)
  だが最新ハートビートの経過13秒 <= LIVE_THRESHOLD(60秒)。...6秒
  サンプリングして...` → `サンプリング中にハートビート mtime が
  前進しなかった...再生成する` が出力され(新しいコンテナは
  `depends_on` で止められているため mtime が前進しなかった)、
  genesis が再生成されて 15 秒で `eth_blockNumber` が `0x5` まで正常に
  進行することを確認した(issue-211 の回避策
  `GENESIS_DOWNTIME_RESET_SEC=0` が不要になったことの確認)。
- 仕上げに `pnpm lint && pnpm build && pnpm test` を実行し、全て成功
  することを確認した(TypeScript の変更は無い)。

### 次の担当が知っておくべきこと

- しきい値・サンプリング窓の前提は `generate-genesis.sh` のコメント
  (定数定義部)と本ファイル §3-3 に明記済み。特に
  `GENESIS_MAX_REBUILD_GAP_SEC`(既定 600 秒)は「#139 の実測ハング点
  (3200 slot 以上)の 1/10 以下」という安全側の導出であり、特定環境の
  実測値ぎりぎりに合わせたものではない。CPU 性能が大きく異なる環境では
  環境変数で調整すること。
- `GENESIS_DOWNTIME_RESET_SEC` を使っていた過去の運用回避策(例:
  `docs/worklog/issue-211.md` の `GENESIS_DOWNTIME_RESET_SEC=0`)は、
  今後は `GENESIS_MAX_REBUILD_GAP_SEC=0` に読み替える必要がある(過去の
  worklog 自体は歴史記録として書き換えていない)。
- §7 に記載したとおり、稼働し続けている動的ノード(addNode)が古い
  genesis のまま取り残される頻度は本変更で上がる(compose ノードの
  down→up が再生成になるケースが増えるため)。README にも明記した。
- `docs/ARCHITECTURE.md` はプロファイル内スクリプトの挙動を扱わないため
  変更していない(#139/#148 と同じ整理)。shared/collector/frontend への
  変更も無い。

### 2026-07-11 Issue #286 静的レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-286-genesis-reuse-guard
- 判定: **合格**
- 確認内容:
  - `should_regenerate()` の判定順序(①マーカー無し→②poison→
    ③genesis年齢<=MAX_REBUILD_GAP→④停止確定/サンプリング)が設計メモ
    §3-2 の疑似コードと一致することを確認した。従来の再生成ケースが
    すべて維持される根拠(genesis_age >= hb_age)と、意図的な挙動変更
    2点(§3-2 末尾)が README にも明記されていることを確認した
  - Issue #56/#148 の既存保護との整合: 稼働中スタックへの `up -d` は
    「genesis 若い→即スキップ」「genesis 古い→サンプリングで前進検知→
    スキップ」の両経路で守られる。poison マーカー経路(#148 3-4)は
    無変更であることを diff で確認した
  - サンプリングの正しさの根拠(`depends_on:
    service_completed_successfully` により判定中は compose 側ノードが
    起動できない)がスクリプトコメントに明記されていることを確認した
    (設計メモの「実装時に明記すること」の指示どおり)。vc1/vc2 は
    beacon 経由の推移的依存で同様に起動が止まることを compose で確認した
  - 固定値の前提明記(CLAUDE.md): `GENESIS_MAX_REBUILD_GAP_SEC`(600秒)
    の導出(#139 実測ハング点の 1/10 以下、CPU 性能依存で上書き可能)が
    スクリプトの定数定義コメントと本ファイル §3-3 の両方にあることを
    確認した。`HEARTBEAT_INTERVAL_SEC` の既定値(10秒)はノード側
    スクリプト・compose 全サービスと一致
  - 環境変数改名の取り残し: `GENESIS_DOWNTIME_RESET_SEC` の残存箇所は
    歴史記録である過去の worklog(issue-148/211)と「旧名から改名した」
    という説明文のみで、動作に関わる参照は無いことを grep で確認した
  - エラー握りつぶし: 新規コードに catch して無視する箇所は無し。
    全分岐が理由をログに出す。フォールバック時もログを出す。
    `.genesis-timestamp` が空/壊れている場合は算術式が `set -e` で
    大きな音を立てて落ちる(静かに誤動作しない)
  - シェルスクリプトの安全性: `sh -n` で構文 OK。`hb_age` 空文字の
    ガード(`[ -z ]` 先行判定)、サンプリング before 空の堅牢性対応、
    生成途中失敗時の `.genesis-timestamp` 残骸が次回の初回生成分岐で
    必ず一掃される冪等性を確認した。`docker compose config -q` も通過
  - `pnpm lint && pnpm build && pnpm test` 全通過(TypeScript 変更なし、
    frontend 1884 テスト含む全パッケージ成功)
  - コミット粒度: 5 コミット(設計 docs / スクリプト / compose /
    README / 記録 docs)が関心事ごとに分かれており、Conventional
    Commits 準拠であることを確認した
- 軽微な指摘(差し戻し不要):
  - サンプリング窓の係数「2」の根拠(生存ノードは間隔ごとに必ず touch
    するため 2 周期観測すれば mtime が必ず前進する)は本ファイル §3-3 に
    あるが、スクリプト側の `sample_window_sec=$(( 2 * ... ))` 付近の
    コメントには「なぜ 1 周期ではなく 2 周期か」までは書かれていない。
    次にこの箇所を触る際にコメントを一言足すとよい(挙動には影響しない)
