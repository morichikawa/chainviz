# Issue #187 作業記録

### 2026-07-08 Issue #187 ノードカードの同期状態・ブロック高の更新(collector)

- 担当: collector
- ブランチ: issue-187-sync-status-update

#### 設計メモ(実装前)

`docs/ARCHITECTURE.md` §7.3、Issue #185/#186 の申し送り
(`docs/worklog/issue-185.md`・`docs/worklog/issue-186.md`)に従う。本Issueの
スコープは「`NodeEntity.syncStatus`/`blockHeight`(現状 pollInfra が常に
`"syncing"`/`0` を書くだけの既知のギャップ)を、D層観測(rethのPrometheus
メトリクス)から更新すること」。

##### 実測(実装前に確認。独立環境ではなく既存の稼働中スタックを読み取り専用
+ addNode/removeNode で検証)

`profiles/ethereum` の compose 定義はプロジェクト名・サブネットが固定
(`chainviz-ethereum`、`172.28.0.0/16`)で、既に稼働中のスタックと同じ設定で
並行して別プロジェクトを起動するとネットワークが衝突する(Issue #186 QA の
既知の制約)。今回も稼働中の `chainviz-ethereum` スタックを対象に、
別ポート(`CHAINVIZ_COLLECTOR_PORT=4322`/`CHAINVIZ_PROXY_PORT=4323`)で
collector を新規プロセスとして起動し、e2e ハーネスと同じ流儀
(`packages/e2e/src/commands.test.ts` が同じスタックへ `addNode`/`removeNode`
する運用)で検証した。検証用に追加した reth3/beacon3 は検証後に `removeNode`
で削除し、稼働中スタックの構成を元に戻した。

1. **`reth_sync_checkpoint{stage="Finish"}` と実際のチェーン先端の一致**:
   稼働中の reth1/reth2(いずれも十分追従済み)で `/metrics` の
   `reth_sync_checkpoint{stage="Finish"}` と直接 `eth_blockNumber` を 3 秒
   間隔で 5 回突き合わせたところ、常に一致するか 1 ブロックの差(スクレイプと
   RPC 呼び出しのタイミングのずれによるもの)で、値が実際のチェーン高と
   一致することを確認した。また稼働中(バックフィルではない)reth でも
   `Finish` が経過時間とともに単調に進むことを再確認した(Issue #185 の実測
   結果の再確認)。
2. **addNode 後のバックフィル進捗の見え方**: `addNode` で reth3(既存チェーン
   高 約3300 のところに genesis から参加)を追加し、追いつくまで約 5 分間
   `Finish` checkpoint を 3〜5 秒間隔で観測した。
   - `Finish` は追加直後は 0 に近い値から始まり、その後 3 秒間隔のスクレイプ
     ごとに一貫して約 32 ブロックずつ進んだ(バックフィル速度 約 10〜11
     ブロック/秒。`packages/e2e/src/helpers/catch-up.ts` が既知の実測値として
     コメントに残している「9〜10 ブロック/秒」と整合)。これは
     `docs/ARCHITECTURE.md` §7.6.5 が前提とする「ミニプログレスバーの
     checkpoint が観測ごとに滑らかに増える」という表示を裏付ける実測結果。
   - 同時に `Headers`/`Execution` など他ステージの checkpoint も毎回 `Finish`
     と同一値で進んでおり(小さいバッチサイズでパイプライン全段が同一
     スクレイプ間隔内に完了している)、今回の環境ではステージ間の遅れが
     観測されなかった(将来バッチサイズが大きくなれば `Headers` が
     `Finish` より先行する場面もありうるが、これは §7.6.5 のポップオーバー
     表示側の話であり、本Issueの `blockHeight`(= `Finish`)の判断には影響
     しない)。
   - 参考として `eth_subscribe("newHeads")` も同時に購読して比較した。
     結果、newHeads も**バックフィル中に 1 ブロックずつ通知が飛んでおり**、
     `docs/ARCHITECTURE.md` §7.2 の申し送り(「バックフィル中は newHeads が
     更新されない可能性がある」という懸念)は今回の実測では観測されな
     かった(reth はバックフィル中の各ブロックの正規化canon確定ごとに
     newHeads を発火するとみられる)。したがって両情報源とも「進捗を表現
     できるか」という観点だけでは甲乙つけがたい。
3. **それでも `Finish` checkpoint を採用する理由**(newHeads ではなく):
   - `Finish` は Issue #185/#186 で既に `NodeInternals.syncStages` として
     パース・world-state 反映の配線が完了しており、追加の RPC 呼び出し・
     購読を増やさずに使える。
   - 一方 newHeads 由来にする場合、現状の `BlockPropagationTracker`
     (`blocks.ts`)はブロックハッシュ単位で「どのノードがいつ受信したか」の
     時刻マップを持つのみで、「このノードが受信した最大ブロック高」という
     ノード単位の問い合わせ機能を持たない。新たに状態を追加する必要があり、
     得られる結果が `Finish` と実質同じであることを踏まえると、既存の
     D層観測を再利用するほうが実装・保守コストで優位。
   - CL(beacon)ノードは D層メトリクス(`internals`)を持たない
     (`docs/ARCHITECTURE.md` の既定どおり EL のみ)。newHeads 経路を採用
     しても CL 側の syncStatus/blockHeight は別途 Beacon API 等の追加の
     情報源が要る点は変わらないため、情報源の選択が CL 側のカバレッジに
     影響しない。
   - 結論: `NodeEntity.blockHeight` は EL(reth)ノードについて
     `reth_sync_checkpoint{stage="Finish"}` の最新観測値を情報源とする。
     CL(beacon)ノードの syncStatus/blockHeight は本Issueのスコープ外とし、
     既存のプレースホルダ(`"syncing"`/`0`)のまま残す(D層メトリクスを
     持たないため。既知のギャップとして残存させる。将来 Beacon API の
     `/eth/v1/node/syncing` 等を使う拡張の余地は残るが、今回は
     「D層観測(rethメトリクス)から」という本Issueの指示範囲を超えるため
     行わない)。

##### `syncStatus` の判定方法

`Finish` は稼働中も単調に増え続けるため、「増えているかどうか」だけでは
「まだ追いついていない(バックフィル中)」と「追いついた上で通常運転して
いる」を区別できない。そこで、**同一ポーリング周期内に観測できた全 EL
ノードの `Finish` checkpoint のうち最大値との差**を使う:

- 差が `SYNCED_TOLERANCE_BLOCKS`(5 ブロック)以内なら `"synced"`、それを
  超えていれば `"syncing"`。
- **前提条件**(CLAUDE.md「今この瞬間に観測できる状態に依存した固定値を
  ロジックに埋め込まない」への対応): この 5 ブロックという値はチェーンの
  絶対的な進行状態(稼働時間・ブロック高そのもの)に依存しない「ノード間の
  相対的な遅れの許容量」であり、チェーンがどれだけ長時間稼働してブロック高が
  伸びても意味が変わらない。根拠は上記の実測: 十分に追従済みの reth1/reth2
  同士でも、並行スクレイプのタイミングのずれにより一時的に最大 3 ブロックの
  差が生じる場面を実測した(`t=1783506411` 時点で reth1=3501, reth2=3504)。
  一方バックフィル中のノードとの差は実測で数百〜数千ブロック
  (追加直後は 3000 超)であり、5 ブロックという閾値とは桁が大きく異なるため
  誤判定の余地がない。3 秒のスクレイプ間隔・devnet 既定の 2 秒 slot time
  という前提の下でのジッター吸収分であり、slot time を大きく変える場合は
  見直しが必要(既存の `NODE_INTERNALS_POLL_INTERVAL_MS` 等と同じ前提)。
  なお reth3 が実際に追いつききった後の定常状態を追加で 60 秒以上観測した
  ところ、reth1/reth2/reth3 間の `Finish` の差は終始 `-2`〜`1` ブロックの
  範囲に収まり続けた(`docs/worklog/issue-187.md` 作成時点のログ参照)。
  5 ブロックという閾値はこの実測レンジに対して十分な余裕を持つ。
- 比較対象の EL ノードが自分しか観測できていない場合(単一ノード構成、
  または他ノードがまだ D層観測を経ていない)は、基準ノードが無いため常に
  `"synced"` とする(基準が無い状況で恒久的に "syncing" 表示になるのを
  避ける)。

##### 実装方針

- 新規ファイル `packages/collector/src/adapters/ethereum/sync-status.ts` を
  追加する(1ファイルが大きくなりすぎないよう、既存の
  `reth-metrics-tracker.ts` と同じ「状態を持つキャッシュ」を独立ファイルに
  切り出す)。
  - `extractFinishCheckpoint(internals: NodeInternals): number | undefined`
    (純粋関数。`syncStages` から `stage === "Finish"` のエントリを探す)。
  - `SYNCED_TOLERANCE_BLOCKS = 5`(前提条件をコメントで明記)。
  - `NodeSyncStatusCache`(状態を持つキャッシュ): `update(stableId,
    internals)` / `forgetNode(stableId)` / `resolve(stableId): {
    syncStatus, blockHeight } | undefined`。
- `EthereumAdapter`(index.ts):
  - `syncStatusCache` フィールドを追加。`pollOneNodeInternals`(D層の周期
    ポーリング。Issue #186 で実装済み)が `result.internals` を得た際、
    `handlers.onInternals` を呼ぶのと同じ箇所で `syncStatusCache.update()`
    も呼ぶ(既存の D層ループにフックするだけで、新たな購読・ポーリングは
    増やさない)。
  - `pollNodeInternalsOnce` の「観測から消えたノードを `forgetNode` する」
    既存ループ(Issue #185 の申し送り)に `syncStatusCache.forgetNode()` も
    追加する。
  - `toEntity()`(A層。pollInfra)で `syncStatusCache.resolve(obs.stableId)`
    を呼び、値が取れれば `syncStatus`/`blockHeight` をそれで上書き、
    取れなければ既存のプレースホルダ(`"syncing"`/`0`)のままにする。
    `docs/ARCHITECTURE.md` §7.3 が指示する「情報源はアダプタ内のキャッシュ
    とし、pollInfra がキャッシュから値を埋める(書き手を applyInfra の
    1本に保つ)」にそのまま合致する(store への書き込みは既存の
    `applyInfra` 経路 1 本のまま変わらない)。
  - `headBlockHash` は本Issueのスコープ外(ARCHITECTURE §7.3 も
    `syncStatus`/`blockHeight` のみを対象としており、reth のメトリクスに
    ブロックハッシュに相当するものは無い)。既存のプレースホルダ(空文字列)
    のまま変更しない。

##### 縮退動作

- D層メトリクスが一度も観測できていないノード(CL ノード・observedからの
  経過が浅いノード・reth のバージョン差で `Finish` メトリクス自体が無い
  場合)は、既存のプレースホルダ(`"syncing"`/`0`)のまま(恒久的にではなく、
  D層観測が追いつけば次周期で埋まる一時的な状態。Issue #186 の
  `drivesNodeId` と同じ「両ループが独立に進む」性質による)。
- ノードが削除された(removeNode)場合は `forgetNode` でキャッシュからも
  消し、他ノードの `syncStatus` 判定(最大値の計算)に亡霊のように残らない
  ようにする。

#### 実装

設計メモどおりに実装した。

- `packages/collector/src/adapters/ethereum/sync-status.ts`(新規):
  `extractFinishCheckpoint` / `SYNCED_TOLERANCE_BLOCKS` /
  `NodeSyncStatusCache` を実装。
- `packages/collector/src/adapters/ethereum/index.ts`:
  - `syncStatusCache: NodeSyncStatusCache` フィールドを追加。
  - `pollOneNodeInternals` で `result.internals` が得られた際に
    `syncStatusCache.update(target.stableId, result.internals)` を呼ぶ。
  - `pollNodeInternalsOnce` の消えたノード検知ループで
    `syncStatusCache.forgetNode(id)` も呼ぶ。
  - `toEntity()` で `syncStatusCache.resolve(obs.stableId)` の結果を
    `syncStatus`/`blockHeight` に反映(取れなければ既存のプレースホルダ)。
    コメントを更新し、D層観測から埋まる旨を明記した。

追加したユニットテスト:

- `sync-status.test.ts`(新規): `extractFinishCheckpoint` の基本(Finish
  あり/なし/空配列/syncStages省略相当)、`NodeSyncStatusCache` の
  update→resolve の基本(単一ノードは常に synced、複数ノードで遅れている
  ノードが syncing、閾値ちょうど・閾値超えの境界、forgetNode 後に最大値
  計算から除外される、Finish の無い internals では既存値を保持)。
- `peer-block-adapter.test.ts`(新規 describe ブロック「EthereumAdapter
  syncStatus/blockHeight from D層 (Issue #187)」): `subscribeNodeInternals`
  で Finish checkpoint を含む観測をした後に `pollInfra()` を呼び、
  NodeEntity の `syncStatus`/`blockHeight` に反映されることを確認する
  統合的なテストを追加した。単一ノード(比較対象が無く常に synced)、
  複数ノードで遅れているノードが syncing・進んでいるノードが synced、
  Finish の無い応答では既存のプレースホルダ(syncing/0)のまま、ノードが
  観測から消えた後は残った唯一のノードが synced になる(forgetNode で
  最大値計算から除外される)、の4ケース。

`pnpm --filter @chainviz/collector build` / `pnpm --filter @chainviz/collector
test`(1073テスト全通過。既存 1058 + 新規 15)、`pnpm -r build` / `pnpm -r
test`(shared 58 / e2e-unit 34 / collector 1073 / frontend 1205)・
`pnpm lint` がいずれも成功することを確認した。

#### 次の担当への注意点

- CL(beacon)ノードの `syncStatus`/`blockHeight` は本Issueでは更新して
  いない(D層メトリクスを持たないため既存のプレースホルダのまま)。将来
  対応する場合は Beacon API の `/eth/v1/node/syncing` 等、別の情報源の追加を
  要する(本Issueのスコープ外として申し送る)。
- `SYNCED_TOLERANCE_BLOCKS`(5)は devnet 既定の slot time(2秒)・
  スクレイプ間隔(3秒)を前提にした値。slot time を大きく変える場合は
  見直しが必要(前提はコード内コメントにも明記)。
- フロント側(Issue #188 以降)は `docs/ARCHITECTURE.md` §7.6.5 の設計どおり
  `blockHeight` が実値になったことを前提にミニプログレスバーの分母
  (キャンバス上の全 EL ノードの `blockHeight` の最大値)を導出してよい。

#### テスト強化(tester)

実装担当のハッピーパス中心のテストに対し、異常系・境界値・特殊遷移の
観点でユニットテストを追加した。

- `sync-status.test.ts`(unit)に追加した観点:
  - `extractFinishCheckpoint`: checkpoint が 0(genesis 直後)の場合に
    undefined へ丸めず 0 を返すこと。型上ありうる複数 Finish エントリの
    場合に先頭を返すこと。
  - `NodeSyncStatusCache`: checkpoint 0 のノードを「未観測(undefined)」と
    区別して解決すること。0 のノードが先行ピアに対し syncing になること。
    同一高(0 ブロック差)の 2 ピアがともに synced。最先端ノード自身は
    behind=0 で synced。全ノードが同時更新されない状況(片方だけ進んだ
    後の古いキャッシュ値との比較)で遅れ側が syncing に転じること。
    高さの上書き更新。未知ノードへの `forgetNode` が no-op であること。
    未観測ノードは undefined を返しつつ既観測ピアは解決できること。
- `peer-block-adapter.test.ts`(統合)に追加した観点:
  - CL(beacon)ノードは D層メトリクスを持たないため、EL(reth)側が
    D層観測で埋まっても既存のプレースホルダ(syncing/0)のまま残る、という
    設計判断が実装に反映されていることの確認。

`pnpm --filter @chainviz/collector test`(1084 テスト全通過)、
`pnpm --filter @chainviz/collector build`、`pnpm -r build` がいずれも
成功することを確認した。既存テスト・他パッケージへの影響は無い。

#### レビュー(reviewer)

依頼された観点に沿って静的レビューとビルド・テストの確認を行った。

- **情報源の選択**: `reth_sync_checkpoint{stage="Finish"}` を newHeads より
  優先した判断は妥当。ARCHITECTURE §7.3 は「どちらが実態に即すかを 7.2 の
  実測結果で確定する」としており、設計メモの実測(Finish が eth_blockNumber
  と一致、newHeads 経路はノード単位の最大受信高さの問い合わせ機能が無く
  新規状態の追加が必要、CL 側のカバレッジはどちらでも変わらない)はこの
  指示どおりの確定手順を踏んでいる。
- **固定値ルール(SYNCED_TOLERANCE_BLOCKS=5)**: 前提条件が
  `sync-status.ts` のコメントと本 worklog の両方に明記されている
  (CLAUDE.md の要求どおり)。値は「ノード間の相対的な遅れの許容量」で
  あり、稼働時間・ブロック高の絶対値に依存しない。ノード数が増えても
  ジッターの上界(スクレイプ間隔 × ブロック生成速度)は変わらないため
  壊れない。slot time を大幅に短くした場合のみ見直しが要る点も
  コメントに明記済み。問題なし。
- **store 反映経路**: 書き込みは `pollOneNodeInternals`(D層)が
  `syncStatusCache.update()`、読み出しは `toEntity`(A層)が
  `resolve()`、store への書き手は既存の `applyInfra` 1 本のまま。
  ARCHITECTURE §7.3「情報源はアダプタ内のキャッシュとし、pollInfra が
  キャッシュから値を埋める」に正確に合致。`forgetNode` の後始末も
  `RethMetricsTracker` と同じ箇所で行われており漏れが無い。
- **CL(beacon)のスコープ外扱い**: `toEntity` のコメント・本 worklog の
  設計メモと申し送り・専用テスト(beacon がプレースホルダのまま残る
  ことの確認)の3箇所で明示されており妥当。
- **checkpoint=0 の扱い**: `extractFinishCheckpoint` は `?.checkpoint`、
  `update`/`resolve` は `=== undefined` の明示比較で、0 と undefined を
  正しく区別している。tester のテスト(0 を undefined に丸めない、
  0 のノードが先行ピアに対して syncing になる等)はこの区別が壊れた
  実装(falsy 判定)で実際に失敗する内容になっており、意味のある
  テストと判断した。
- **エラーの握りつぶし**: Finish 欠落時に無言で前回値を保持する縮退は、
  想定内である理由(reth-metrics.ts の既存方針と同じ)がコメントで
  説明されており問題なし。catch して何もしない箇所は追加されていない。
- **境界の遵守**: "Finish" というチェーン固有の語彙は
  `adapters/ethereum/` 内に閉じている。`packages/shared` の
  `syncStages` は汎用の `{stage, checkpoint}` のままで変更なし。
  frontend への漏れも無い。
- **ビルド・テスト**: `pnpm lint` / `pnpm build` / `pnpm test` すべて
  成功(shared 58 / e2e 34 / collector 1084 / frontend 1205)。

**指摘(要対応・docs のみ)**: `docs/ARCHITECTURE.md` §7.3 の末尾は
「値の導出元は…どちらが実態に即すかを 7.2 の実測結果で確定する」の
ままで、確定した結果が記録されていない。Issue #185 が §7.2.1
「実装時に確定したメトリクス名」を追記した前例に倣い、§7.3 にも
実装時の確定事項(情報源は Finish checkpoint、syncStatus は全 EL
ノードの最大 checkpoint との差が許容量以内かで判定、CL ノードは
D層メトリクスを持たないためプレースホルダのまま残る既知のギャップ)を
短く追記すること。現状の「既知のギャップがある…D層で埋める」という
記述だけでは、CL 側に残るギャップを読者が「解消済み」と誤読する。

**コミット粒度への注意(統括向け)**: 本ブランチは未コミットの状態で
レビューした。コミット時は最低限「collector 実装 + 実装担当のテスト」
「tester のテスト強化」「docs(PLAN/WORKLOG/worklog、上記 §7.3 追記
含む)」を関心事ごとに分けること。

判定: 上記 ARCHITECTURE §7.3 の追記を条件とした条件付き合格。
コード本体への修正指摘は無し。

#### 再レビュー(reviewer・§7.3追記の確認)

前回の条件付き合格の条件だった `docs/ARCHITECTURE.md` §7.3 への実装時
確定事項の追記を確認した。

- **追記内容の正確性**: 情報源(`reth_sync_checkpoint{stage="Finish"}`)、
  採用理由(実測で `eth_blockNumber` と一致・Issue #185 でパース済みで
  追加のRPC/購読が不要・newHeads 経路は `BlockPropagationTracker` に
  ノード単位の最大受信高さの問い合わせ機能が無く新規実装が必要)、
  syncStatus の判定基準(全 EL ノードの Finish checkpoint 最大値との差が
  `SYNCED_TOLERANCE_BLOCKS`(5 ブロック)以内なら synced)のいずれも、
  実装(`sync-status.ts`)および本 worklog の設計メモ・実測結果と一致
  している。判定式は単一ノード構成(最大値=自分自身、差 0 → synced)も
  実装どおりカバーしている。
- **前回指摘の解消**: CL ノード(beacon)が本更新の対象外で
  syncStatus/blockHeight が既存プレースホルダのままという既知のギャップが
  残ることが、太字で「EL側のギャップのみ解消」と明記された。「D層で
  埋める」という従来の記述だけでは CL 側も解消済みと誤読しうるという
  前回の指摘は解消された。
- **差分範囲**: 前回レビュー時からの差分は §7.3 への 11 行の追記のみで、
  実装コード・テストに変更は無い。
- **品質ゲート**: `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ
  全体で再実行し、すべて成功(collector 1084 / frontend 1205 を含む
  全パッケージ通過)。

判定: 合格。前回付した条件は満たされた。コミット時は前回の注意
(「collector 実装 + 実装担当のテスト」「tester のテスト強化」「docs」を
関心事ごとに分けてコミットする)を引き続き適用のこと。push・PR作成・
マージは統括の実行に委ねる。

#### QA検証(2026-07-08・実機動作確認)

独立した合成環境で実際に動かし、完了条件を検証した。結果はすべて満たしており合格。

##### 検証環境(本物の稼働中スタックと分離)

稼働中スタックと衝突しないよう、独立プロジェクト名 `chainviz-qa187` で
別サブネット(172.40.0.0/16)の合成環境を起動した。compose の固定サブネット・
静的IP・広告IP・ホスト公開ポートを override ファイルで 172.40 系へ振り替え、
既存の `chainviz-ethereum`(172.28.0.0/16)には一切触れていない(検証前後で
`chainviz-ethereum` の各コンテナは Exited のまま不変であることを確認)。
collector はビルド済み dist を別ポート(WS 4100 / proxy 4101)で新規プロセス
として起動した。検証後は `docker compose -p chainviz-qa187 ... down -v` と
手動追加コンテナの `docker rm -f` で合成環境を完全撤収し、コンテナ・
ボリューム・ネットワークが残っていないことを確認した。

##### 確認結果

1. **reth の syncStatus(条件1)**: reth1/reth2 はともに `synced`。バックフィル中
   のフォロワー reth3 は他ノードに遅れている間 `syncing` と表示され、
   追いつくと `synced` へ遷移した。常時 `syncing` 固定ではないことを確認。
2. **reth の blockHeight(条件2)**: reth1/reth2 の blockHeight は時間経過とともに
   増加(WS 差分で 72→75→78→…→303 と単調増加を観測)。0 固定ではない。
   `eth_blockNumber`(RPC 110)と `/metrics` の Finish checkpoint(108)、
   collector 配信値がいずれも実チェーン先端と一致(スクレイプと RPC の
   タイミング差による 1〜2 ブロックのずれの範囲内)することを突き合わせで確認。
3. **addNode フォロワーのバックフィル観測(条件3)**: チェーン高が約690まで
   進んだ状態でフォロワーノード(reth+beacon ペア)を追加したところ、collector
   経由で reth3 が `syncing` / blockHeight=0 → `syncing` / 607 → `syncing` / 671
   → `synced` / 710 と、**バックフィル中は syncing のまま blockHeight が漸増し、
   追いついた時点で synced へ遷移**する様子を WS スナップショット/差分で観測
   できた。追いついた後は他ノードと同様に先端を追従した。
   - 補足: 本Issueは「collector が同期状態を D層観測から反映する」範囲であり、
     addNode コマンドのライフサイクル自体(Issue #34/#44)は変更していない。
     collector の addNode コマンドは接続先ネットワーク/ボリュームが
     `chainviz-ethereum_*` 固定(PLAN.md バックログ最終項目の既知の制約)で
     独立プロジェクトを対象にできないため、検証では合成環境 `chainviz-qa187`
     内にフォロワーの reth+beacon ペアを手動で参加させ、同一の collector
     コードパス(Finish checkpoint → syncStatus/blockHeight の解決)を実際に
     通した。フォロワーの追加起点が addNode コマンドか手動かは collector の
     反映ロジックに影響しない。
   - フォロワーを削除すると collector のスナップショットから reth3/beacon3 が
     消え、残った reth1/reth2 は synced のままだった(削除ノードの古い
     checkpoint が他ノードの syncStatus 判定に亡霊として残らない = forgetNode
     の後始末が効いていることを確認)。
4. **beacon の据え置き(条件5/スコープ外)**: beacon1/beacon2 は終始
   syncStatus=`syncing` / blockHeight=0 のプレースホルダのまま。設計判断
   どおりで想定内。
5. **静的ゲート(条件6)**: `pnpm lint`(exit 0) / `pnpm build`(exit 0) /
   `pnpm test`(exit 0。shared 58 / e2e 34 / collector 1084 / frontend 1205、
   全テストファイル pass)を独立して実行し、いずれも成功。

判定: 完了条件をすべて満たしており合格。push・PR作成・マージ・Issueクローズは
統括の判断・実行に委ねる。
