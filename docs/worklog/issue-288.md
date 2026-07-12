### 2026-07-11 Issue #288 P2P接続エッジが1回のタイムアウトで即座に消え表示がちらつく

#### 設計（chainviz-designer）

- 担当: designer
- ブランチ: issue-288-p2p-edge-hysteresis

**問題の機構（コードを読んで確認した因果関係）**

1. `packages/collector/src/adapters/ethereum/index.ts` の
   `fetchConsensusPeerNodes` は、Beacon API への 1 回の問い合わせ失敗で
   そのノードの `NodePeers` を丸ごと落とす（#287 でログは付いたが、
   結果を落とす挙動自体は変わっていない）。
2. `peers.ts` の `toPeerEdges` は「観測できたノードの peerId → stableId
   対応表」を毎 tick 作り直す。ノード A の観測が 1 tick 欠けると、
   A 発のエッジが消えるだけでなく、他ノード B が A との接続を報告して
   いても A の peerId が解決できないため B—A エッジも消える。つまり
   1 回のタイムアウトで A が関わる**全エッジ**が消える。
3. `world-state/diff.ts` の `computeEdgeDiff` が `edgeRemoved` を配信し、
   フロントの `entities/connectingEdge.ts` は「実 PeerEdge を 1 本も
   持たないノード」に接続確立中エッジを出すため、
   「P2P接続確立中… ⇔ 確立した」のフラッピングとして見える。

**設計判断 1: collector 側で吸収する（frontend 側の表示安定化ではなく）**

- `PeerEdge` はスキーマ上「永続的なピア接続の状態」（`DiffEvent` の
  コメント・ARCHITECTURE.md）。1 回の観測失敗は「切断の証拠」ではなく
  「観測の欠測」であり、接続状態の最良推定を保つのはワールドステートを
  組み立てる collector の責務。
- frontend 側で消滅を遅延させると、スナップショット（後から接続した
  クライアントが受け取る全量）と表示が乖離する。また PeerEdge を消費する
  全箇所（peerEdge・connectingEdge・凡例・ブロック伝播パルス）に
  安定化ロジックが分散する。
- #287 で連続失敗回数の追跡が既に collector にあり、自然に統合できる。

**設計判断 2: エッジ単位ではなくノード単位の観測結果（NodePeers）を
キャッシュする**

エッジ単位のキャッシュは端点 2 ノードの観測状態が混ざり管理が複雑になる。
ノード（stableId）単位で「最後に成功した NodePeers」を保持し、失敗時に
猶予内ならそれを代用すれば、peerId 対応表も connectedPeerIds も一貫して
復元され、`toPeerEdges` 以降（diff 計算・配信・フロント）は一切
変更不要になる。

**設計判断 3: 猶予は「連続失敗回数」ベースの定数
`CONSENSUS_PEER_OBSERVATION_GRACE_TICKS = 3`**

- 時間ベース（○○秒）だと `peerPollIntervalMs`（コンストラクタ引数で
  変更可能、既定 3000ms）を変えた瞬間に成立しなくなる。回数ベースなら
  相対頻度が保たれる（#287 のログ間引きと同じ理由。CLAUDE.md「今この
  瞬間に観測できる状態に依存した固定値をロジックに埋め込まない」）。
- 固定値 3 の前提条件（実装時にコードコメントへも明記すること）:
  既定 `peerPollIntervalMs` 3000ms + HTTP タイムアウト
  （`createFetchHttpClient` 既定 3000ms）のもとで、猶予は実時間で
  約 10〜20 秒。報告された症状（単発のタイムアウト）は 1 tick、短い
  遅延のバーストでも数 tick で回復する想定なので 3 で吸収できる。一方、
  Issue #286 のような beacon の恒久ハングは failure が無限に続くため
  4 tick 目以降は従来どおりエッジが消え、「恒久的に不調なノードを
  いつまでも健全と表示し続ける」ことにはならない。前提（間隔・
  タイムアウトの既定値）を大きく変える場合はこの値も見直すこと。

**設計判断 4: 「真の不調」と「一時的な揺らぎ」の見た目の区別は
ヒステリシスの帰結として実現する（PeerEdge への stale フラグは追加しない）**

- 一時的な揺らぎ（猶予内）: 表示は一切変化しない。実際の P2P 接続は
  維持されている（Issue 本文の実測どおり `/eth/v1/node/peer_count` は
  安定）のだから、「変化しない」が正しい表示。
- 真の不調（猶予超過）: エッジが消えたまま戻らず、接続確立中エッジが
  持続的に表示され、#287 の連続失敗ログが出続ける。
- `PeerEdge` に `stale?: boolean` を足して猶予中を薄く描く案は不採用。
  理由: (1) `DiffEvent` にエッジの「更新」概念が無く（同一性キーは
  from/to/networkId の 3 つ組、内容更新は remove+add）、fresh→stale の
  遷移を配信するには shared スキーマと frontend 双方への大きな追加が
  要る。(2) 猶予は約 10〜20 秒と短く、その間だけ見た目を変えると、
  除去したいちらつきを別の形（点滅する半透明表示）で再導入してしまう。
  (3) 今の Phase で必要な範囲（フラッピングの解消）を超える先回り実装に
  なる。
- **よって `packages/shared` の型変更は不要**（DiffEvent・PeerEdge・
  スナップショットいずれも現状のまま）。

**設計判断 5: #287 の失敗カウント（`consensusPeerFailureCounts`）とは
併存させず、統合する（置き換え）**

「連続失敗回数」という同一情報を 2 つの Map で二重管理すると乖離リスクが
ある。新クラス（下記）に「連続失敗回数 + 最後に成功した NodePeers」を
一元化し、既存の `consensusPeerFailureCounts` フィールドと
`pruneConsensusPeerFailureCounts` メソッドはそこへ吸収する。
**ログの外形的な挙動（1 回目は必ずログ・以降
`CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL`（20）回に 1 回・成功で
リセット・ログ文言）は一切変更しない**。既存テスト
`consensus-peer-poll-failure-log.test.ts` は `pollPeersOnce` +
`console.error` モック経由の黒箱検証なので、挙動不変ならそのまま
通り続けるはず（通らなくなったら挙動を変えてしまっている兆候）。

**設計判断 6: EL 側（`fetchExecutionPeerNodes`）は今回のスコープ外**

#287 と同じスコープ管理。実測された問題は CL（Beacon API、#286 の
ハング）のみで、reth の admin API 側で同様のフラッピングは観測されて
いない。ただしクラス自体は `NodePeers` を扱う CL/EL 非依存の形で作り、
EL 側で同じ症状が実測されたら別 Issue で配線だけ足せるようにする
（配線の先回りはしない）。

**新クラスのインターフェース案（実装ロジックは実装担当に委ねる）**

新ファイル `packages/collector/src/adapters/ethereum/peer-observation-cache.ts`
（1 ファイル 1 責務）:

```ts
/** ノード単位のピア観測キャッシュ。連続失敗回数と最後に成功した観測を持つ。 */
export class PeerObservationCache {
  constructor(private readonly graceTicks: number) {}

  /** 観測成功。連続失敗回数をリセットし、lastGood を更新する。 */
  recordSuccess(stableId: string, observed: NodePeers): void;

  /**
   * 観測失敗。連続失敗回数をインクリメントして返す。
   * fallback は「連続失敗回数 <= graceTicks かつ lastGood が存在する」
   * 場合のみ返す（それ以外は undefined = 従来どおり観測を落とす）。
   */
  recordFailure(stableId: string): {
    consecutiveFailures: number;
    fallback: NodePeers | undefined;
  };

  /** 現在の観測対象に含まれない stableId のエントリを破棄する。 */
  prune(currentIds: ReadonlySet<string>): void;
}
```

- 定数 `CONSENSUS_PEER_OBSERVATION_GRACE_TICKS = 3` は `index.ts` の
  `CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL` の隣に置き、テストから
  参照できるよう export する（前提条件のコメント必須。上記設計判断 3）。
- `logConsensusPeerPollFailure` は自前の Map を持つ代わりに
  `recordFailure` が返す `consecutiveFailures` を受け取る形に変える
  （ログの判定条件・文言は不変）。

**変更後のデータフロー（`fetchConsensusPeerNodes` 内）**

1. `cache.prune(targets の stableId 集合)` — removeNode 等で観測対象から
   消えたノードのキャッシュを即破棄（猶予によるゾンビエッジを作らない。
   既存の prune と同じ「毎 tick 現在の対象集合と突き合わせる」方式）。
2. 各 target について:
   - 成功 → `cache.recordSuccess(stableId, nodePeers)`、fresh な
     NodePeers を返す。
   - 失敗 → `cache.recordFailure(stableId)`。返り値の
     `consecutiveFailures` で従来どおりログ間引き判定。`fallback` が
     あればそれを返し（= エッジ維持）、無ければ null（= 従来挙動）。
3. 以降（`toPeerEdges` → `store.applyPeers` → DiffEvent 配信 →
   フロント描画）は**一切変更なし**。

**明示するトレードオフ**

猶予期間中はノード A の古い観測が peerId 対応表・connectedPeerIds に
残るため、実際に切断が起きた場合でもエッジ消滅が最大 graceTicks 分
（既定で実時間 約 10〜20 秒）遅れる。`toPeerEdges` は「どちらかの端点が
報告していればエッジ有り」の和集合意味論なので、相手側 B が切断を即
報告しても A のキャッシュが生きている間はエッジが残る。学習用途の
可視化として、フラッピング除去の利益がこの短い遅延の不利益を上回ると
判断した。

**作業分担**

- collector（収集悟）: 上記すべて。新ファイル
  `peer-observation-cache.ts` + `index.ts` の
  `fetchConsensusPeerNodes` / `logConsensusPeerPollFailure` 周りの
  置き換え + テスト。
- shared / frontend / node-env: **変更なし**。

**テスト観点（実装担当・tester への引き継ぎ）**

- 1 回の失敗ではエッジ集合が変化しない（前回観測が代用される）ことを
  `pollPeersOnce` 経由で確認する。
- graceTicks 回連続失敗までは維持、graceTicks+1 回目で該当ノードの
  エッジが消える（境界値）。
- 失敗 → 成功 → 失敗で猶予が再び効く（カウントリセット）。
- 一度も成功していないノードの失敗は従来どおり即座に観測から落ちる
  （lastGood が無い場合に fallback を返さない）。
- targets から外れたノードのキャッシュが破棄される（猶予でエッジが
  残留しない）。
- #287 のログ挙動に回帰が無い（既存
  `consensus-peer-poll-failure-log.test.ts` が無変更で通る）。
- 修正前の再現確認: 修正前のコードで「1 回のモック失敗でエッジが
  消える」ことを実際に確認してから修正する（CLAUDE.md「直したはずで
  済ませない」）。
- テストファイルは関心事で分ける: `PeerObservationCache` 単体
  （新ファイル `peer-observation-cache.test.ts`）と、
  `pollPeersOnce` 経由のヒステリシス結合挙動（既存
  `peer-block-adapter.test.ts` は約 3000 行と大きいため、新ファイル
  例 `consensus-peer-hysteresis.test.ts` を推奨）。

**完了条件の言語化（docs/PLAN.md に対応項目が無いため）**

- Beacon API への 1 回の問い合わせ失敗では P2P エッジ表示が変化しない
  （フラッピングが起きない）。
- 連続失敗が猶予（3 tick）を超えた場合は従来どおりエッジが消え、
  接続確立中表示に切り替わる（恒久不調が隠蔽されない）。
- #287 のログ挙動（初回必ず・20 回に 1 回・成功でリセット）が維持される。

**実装時に判断してよいこと（未決定として残す点）**

- 猶予超過後に lastGood を保持し続けるか破棄するか（fallback の判定を
  回数で門番する限りどちらでも外形挙動は同じ。メモリは prune で
  有界なので実装の単純な方でよい）。
- `PeerObservationCache` のジェネリクス化（`NodePeers` 固定で十分。
  EL 配線が実際に必要になった時に検討すればよい）。
- 結合テストのファイル名・分割粒度。

**docs 反映**

- `docs/ARCHITECTURE.md` の `subscribePeers` の節に「CL 側の観測
  ヒステリシス（Issue #288）」の段落を追加済み（本設計と同内容）。
- `docs/CONCEPT.md` は変更不要（PeerEdge を「永続的な接続状態」とする
  既存の決定と本設計は整合する。矛盾する記述なし）。

#### 実装方針メモ（collector・着手前）

- 担当: collector
- 設計メモどおりに進める。未決定事項の判断:
  - **lastGood の保持/破棄**: 猶予超過後も `lastGood` は破棄せず保持する
    実装にする（`recordFailure` は `consecutiveFailures` を増やすだけで
    `lastGood` フィールドには触れない）。理由: 破棄する分岐を追加しても
    外形挙動は変わらず、むしろ「その後また 1〜graceTicks 回だけ成功する」
    ような揺らぎが起きた場合に無駄に fallback を失う経路が増えるだけ。
    実装がシンプルな「保持し続ける」を採用する（prune で有界性は担保）。
  - **ジェネリクス化**: しない。設計メモどおり `NodePeers` 固定。
  - **結合テストのファイル名**: `consensus-peer-hysteresis.test.ts`
    （設計メモの推奨どおり）。単体テストは
    `peer-observation-cache.test.ts`。
- 実装手順:
  1. 新規 `packages/collector/src/adapters/ethereum/peer-observation-cache.ts`
     に `PeerObservationCache` を実装（`recordSuccess` /
     `recordFailure` / `prune`、状態は `Map<string, { consecutiveFailures:
     number; lastGood?: NodePeers }>`）。
  2. `index.ts`:
     - 定数 `CONSENSUS_PEER_OBSERVATION_GRACE_TICKS = 3` を
       `CONSENSUS_PEER_POLL_FAILURE_LOG_INTERVAL` の隣に export で追加
       （前提条件のコメント必須）。
     - フィールド `consensusPeerFailureCounts`（`Map<string, number>`）を
       `consensusPeerObservations: PeerObservationCache` に置き換える。
     - `fetchConsensusPeerNodes`: 冒頭の prune 呼び出しを
       `this.consensusPeerObservations.prune(...)` に、成功時は
       `recordSuccess`、失敗時は `recordFailure` の戻り値
       （`consecutiveFailures`・`fallback`）を使い、ログ判定は
       `logConsensusPeerPollFailure` に `consecutiveFailures` を渡す形へ
       変更、返り値は `fallback ?? null`。
     - `pruneConsensusPeerFailureCounts` は削除（cache.prune に統合）。
     - `logConsensusPeerPollFailure` は count を自前計算せず引数で受け取る
       形に変更（ログ判定・文言は不変）。
  3. テスト:
     - `peer-observation-cache.test.ts`: 新クラス単体（成功時のリセット・
       猶予内外の fallback 有無・lastGood 無し時は fallback しない・
       prune）。
     - `consensus-peer-hysteresis.test.ts`: `pollPeersOnce` 経由の結合
       挙動（1 回の失敗でエッジ不変・graceTicks 回まで維持・
       graceTicks+1 回目で消える・失敗→成功→失敗でカウントリセット・
       未成功ノードは即座に落ちる・targets から外れたら即破棄）。
     - 既存 `consensus-peer-poll-failure-log.test.ts` は無変更のまま実行し、
       回帰が無いことを確認する（このテストは常に失敗し続ける
       `alwaysFailingBeaconHttp` を使うため lastGood が一度も作られず、
       fallback は常に undefined になるはずで、ログ回数・文言は今回の
       変更の影響を受けない設計）。
  4. 修正前後の比較: 修正前のコード（このコミット前の HEAD）で
     `pollPeersOnce` を 1 回失敗させて即座にエッジが消えることを一時的に
     確認してから、修正後に 1〜graceTicks 回の失敗ではエッジが維持され、
     超過後に消えることを確認する。

#### 実装結果

- 新規: `packages/collector/src/adapters/ethereum/peer-observation-cache.ts`
  （`PeerObservationCache`）、`peer-observation-cache.test.ts`（単体）、
  `consensus-peer-hysteresis.test.ts`（`pollPeersOnce` 経由の結合挙動）。
- 変更: `packages/collector/src/adapters/ethereum/index.ts`。
  `CONSENSUS_PEER_OBSERVATION_GRACE_TICKS = 3` を追加し、
  `consensusPeerFailureCounts`（`Map<string, number>`）を
  `PeerObservationCache` インスタンスへ置き換えた。
  `fetchConsensusPeerNodes` は成功時に `recordSuccess`、失敗時に
  `recordFailure` を呼び、`fallback` があればそれを返してエッジを
  維持する。`logConsensusPeerPollFailure` は連続失敗回数を
  `PeerObservationCache` から受け取る形に変え、ログの判定条件・文言は
  変更していない。
- 未決定事項の実装時判断（実装方針メモに記載済み）: lastGood は猶予
  超過後も破棄せず保持し続ける実装にした。ジェネリクス化はしていない。
  結合テストは `consensus-peer-hysteresis.test.ts` に分離した。
- `toPeerEdges`・`world-state`・frontend・`packages/shared` は無変更。

#### 修正前後の確認（バグ再現・回帰確認）

- 修正前（`PeerObservationCache` 配線前の `index.ts`）で、`pollPeersOnce`
  を beacon2 だけ失敗するモックで 2 回呼ぶ結合テストを一時的に書いて
  実行し、1 回目の失敗で即座にエッジが消えること（`second` が `[]` に
  なること）を確認した（このテストコード自体はコミットせず、確認後に
  削除した）。
- 修正後は同条件で `consensus-peer-hysteresis.test.ts` の各テスト
  （境界値含む）が通ることを確認済み。
- 既存 `consensus-peer-poll-failure-log.test.ts` は無変更のまま
  （`git diff --stat` で差分なしを確認）、全 9 ケースが通ることを確認
  （#287 のログ間引き挙動に回帰が無いことの裏付け）。

#### 実機検証（docker compose）

作業ディレクトリの `profiles/ethereum` には、別の worktree
（issue-285）が起動した稼働中の `chainviz-ethereum` スタック（かつホスト側
で稼働中の公式 collector/frontend が接続中）が既に存在していたため、
そちらには一切手を触れず、検証専用の隔離スタックを別途起動して確認した。

- 検証手順: `docker-compose.yml` を複製し、プロジェクト名
  （`chainviz-eth288`）・サブネット（`172.30.0.0/16`）・ホスト公開ポート
  （18545/15052）・関連する固定 IP（`RETH_P2P_IP`/`ENR_ADDRESS`/
  `ipv4_address`）だけを書き換えた一時的な compose ファイルで
  `docker compose -p chainviz-eth288 up -d` を実行（既存スタックとは
  完全に独立したネットワーク・ポート・ボリュームで並行稼働）。
- ビルド済みの本ブランチの collector を
  `CHAINVIZ_COLLECTOR_PORT=4100 CHAINVIZ_PROXY_PORT=4101` で起動し、
  この隔離スタックだけを観測する専用ポートで待受させた（公式インスタンス
  の 4000/4001 とは無衝突）。WebSocket に接続する簡易スクリプトで
  `edgeAdded`/`edgeRemoved` を実況ログした。
- **単発の一時的失敗（`docker pause`/`unpause` で約 5 秒間 beacon2 を
  無応答にする）**: collector ログに
  `[ethereum] consensus peer poll failed for chainviz-eth288/beacon2:
  ... AbortError` が実際に記録された（= 本物の観測失敗が発生した）ことを
  確認した上で、観測側のログには `edgeAdded`/`edgeRemoved` が一切
  発生しないこと（エッジが一切ちらつかないこと）を確認した。これが
  Issue #288 の再現条件そのものに対する解消確認である。
- **恒久的な不調（`docker stop` で beacon2 を継続的に停止）**: 猶予
  （3 tick、実測で停止から約 10 秒程度）を超えたところで
  `edgeRemoved` が実際にログされ、エッジが消えることを確認した
  （恒久的な不調が隠蔽されないことの確認）。
- **回復**: `docker start` で beacon2 を再開すると、Beacon API の
  ピア再接続後に `edgeAdded` が再びログされ、エッジが復活することを
  確認した。
- 検証後は隔離スタックを `docker compose down -v` で完全に破棄し、
  検証用 collector プロセスも終了させた。既存の
  `chainviz-ethereum`（issue-285）スタックとホスト上の公式
  collector/frontend（ポート 4000/4001/5173）が検証前後で変化していない
  こと（コンテナ一覧・リスニングポートとも）を確認済み。

#### 最終確認

- `pnpm --filter @chainviz/collector build` / `pnpm --filter
  @chainviz/collector test` とも成功（49 テストファイル・1276 テスト
  すべて green）。
- `pnpm exec eslint`（変更ファイルのみ対象）でエラー無し。

#### テスト強化（chainviz-tester）

実装担当が書いた基本テストに対し、エッジケース・境界値・異常系・
2 つのカウンタの相互作用の観点でテストを追加した。実装コードは一切
変更していない（`peer-observation-cache.ts` / `index.ts` は無変更）。

- `peer-observation-cache.test.ts`（単体、+3 件）:
  - `graceTicks=0` で lastGood があっても最初の失敗で fallback を返さない
    （猶予境界の下側の off-by-one 検出）。
  - fallback が保存した観測の参照をそのまま返す（防御的コピーをしない）
    ことを参照同一性（`toBe`）で確認。
  - 両ノードが lastGood を持つ状況で片方を猶予超過まで失敗させても、
    もう片方の lastGood・カウントが汚染されない（エントリ取り違えの検出。
    既存の independence テストは片方が未成功のケースのみだった）。
- `consensus-peer-hysteresis.test.ts`（結合、+2 件）:
  - エッジが一度実際に消えたあと、成功で復活し、その直後の単発失敗を
    新しい猶予窓で再び吸収する（恒久不調→回復→一時揺らぎの全遷移）。
  - 3 ノード構成で、あるノードが先に猶予超過してエッジが消える一方、
    遅れて失敗し始めた別ノードのエッジはまだ猶予内で維持される
    （ノードごとの猶予窓が互いに独立していることの結合レベル確認）。
- `consensus-peer-counter-interaction.test.ts`（新規、2 件）:
  #287 のログ間引き（20 回に 1 回）と #288 の猶予（3 tick）が同じ
  「連続失敗回数」カウンタから別々の閾値で判定される点に着目し、両者が
  干渉しないことを、エッジ有無とログ発火を同時に観測して確認する。
  - 猶予超過でエッジが 4 回目に消えても、ログは 1 回目と 20 回目にだけ
    発火する（猶予超過がログ周期をリセット・停止させない）。テスト冒頭で
    `GRACE < LOG_INTERVAL` の前提を不変条件としてアサートする。
  - 成功で共有カウンタが 0 に戻ると、猶予窓とログ周期が同時に初期化される
    （片方だけ残る取り違えが無い）。
  - 関心事（2 つのカウンタの交差）が単体・結合いずれとも異なるため、
    1 ファイル 1 責務の原則に従って別ファイルに分離した。
- 回帰検出力の確認: 追加した各テストが実際にバグを検出できることを、
  実装を一時的に壊して確認した（確認後すべて元に戻し、実装は無変更）。
  - 猶予境界を緩める（`<= graceTicks` → `<= graceTicks + 1`）→
    `graceTicks=0` / 独立性 / counter-interaction の境界テストが落ちる。
  - fallback を防御的コピーにする（`{ ...lastGood }`）→ 参照同一性
    テストが落ちる。
  - 猶予超過時に共有カウンタを 0 にリセットする（2 カウンタを干渉させる）
    → counter-interaction の 2 件がともに落ちる。
- `pnpm --filter @chainviz/collector build` / `test` とも成功（50 テスト
  ファイル・1283 テスト green）。`pnpm exec eslint`（追加ファイル対象）
  エラー無し。既存 `consensus-peer-poll-failure-log.test.ts`（#287 回帰）は
  無変更のまま通過。

#### レビュー（chainviz-reviewer）

判定: **合格**。差し戻し事項なし。

確認内容:

- **設計メモからの逸脱なし**: 4つの決定事項（collector側で吸収・
  ノード単位の観測キャッシュ方式・`packages/shared`の型変更なし・
  #287の`consensusPeerFailureCounts`をPeerObservationCacheへ置き換えて
  統合）すべて実装と一致。`git diff main...HEAD`でshared/frontend/
  profilesに差分が無いこと、旧シンボル（`consensusPeerFailureCounts`・
  `pruneConsensusPeerFailureCounts`）が完全に除去され併存していないことを
  grepで確認した。
- **#287ログ挙動の回帰なし**: `consensus-peer-poll-failure-log.test.ts`は
  無変更（mainとの差分ゼロ）のまま通過。ログ判定条件（初回必ず・20回に
  1回）・文言（`consecutive failures`サフィックス含む）はdiff上も同一。
  成功時のリセット意味論も等価（旧: Mapからdelete→次の失敗が1回目、
  新: recordSuccessでcount=0→次の失敗が1回目）。
- **固定値の前提条件の明記**: `CONSENSUS_PEER_OBSERVATION_GRACE_TICKS = 3`
  に、回数ベースを選んだ理由（間隔変更に対する相対頻度の維持）と実時間
  換算の前提（既定間隔3000ms + HTTPタイムアウト3000ms → 約10〜20秒）が
  コードコメント・本worklog（設計判断3）の両方に記載されている。
  CLAUDE.mdの運用ルールを満たす。
- **removeNode時のゾンビエッジ防止**: `fetchConsensusPeerNodes`冒頭で
  毎tick、`beaconTargets(observations)`（Dockerの現在観測から導出）由来の
  stableId集合で`prune`を呼ぶ構造を確認。観測対象から外れたノードの
  キャッシュは次tickで破棄される。結合テスト（re-add時にlastGoodが
  復活しないこと）も存在する。
- **恒久不調の隠蔽なし**: fallbackは`consecutiveFailures <= graceTicks`の
  場合のみ返るため、#286型の恒久ハングでは4tick目以降エッジが消え、
  接続確立中表示＋#287の連続失敗ログが持続する。境界値テスト
  （graceTicks回目まで維持・+1回目で消える）と実機検証記録の両方で
  裏付けられている。
- **エラー握りつぶしなし**: catch節は#287のログ間引き（設計済みの挙動）を
  経由して必ずconsole.errorに到達する経路を維持。fallback代用時も失敗
  自体はログされる。
- **テストの質**: 単体（境界値graceTicks=0/超過・参照同一性・ノード間
  独立性・prune）・結合（フラッピング解消・境界・再アーム・復活後の
  再吸収・ノード別猶予窓の独立・未成功ノードの即時脱落・ゾンビエッジ）・
  カウンタ交差（#287周期と#288猶予の非干渉・成功時の同時リセット）と
  関心事別に3ファイルへ分割されており、tester記録に「実装を意図的に
  壊して検出できることを確認した」旨がある。counter-interactionテストが
  `GRACE < LOG_INTERVAL`の前提を冒頭でアサートしている点も、定数変更時に
  テスト自体が無意味化するのを防いでおり適切。
- **ビルド・lint・テスト**: リポジトリ全体で`pnpm build`（全パッケージ
  成功）・`pnpm lint`（指摘なし）・`pnpm test`（shared 62 / collector
  1283 / e2e 158 / frontend 1884、すべてpass）を確認。
- **コミット粒度**: `git log main..HEAD`の8コミットはいずれも単一の
  関心事（設計docs / 実装方針メモ / クラス追加 / 配線fix / 実装記録docs /
  mainマージ / テスト強化 / テスト記録docs）でConventional Commits準拠。
- **docs整合**: `docs/ARCHITECTURE.md`のsubscribePeers節に追記された
  ヒステリシスの段落は実装（回数ベース猶予・恒久不調時の脱落・prune・
  EL側未配線）と一致。`docs/PLAN.md`のチェックボックス・Issueリンク、
  `docs/WORKLOG.md`索引の1行も確認した。

軽微な所見（差し戻し対象ではない）: `consensus-peer-hysteresis.test.ts`と
`consensus-peer-counter-interaction.test.ts`でモックヘルパー
（`beaconSummary`・`multiBeaconClient`・`beaconHttp`）が重複している。
1ファイル1責務の分割を優先した結果として妥当だが、同種のテストが今後
さらに増えるならヘルパーの共有化を検討してよい。

#### QA検証（chainviz-qa、実機・独立検証）

判定: **合格**。差し戻し事項なし。

statuscheck: マシン再起動により検証開始時点で全コンテナが Exited 状態
だったため（稼働中の公式スタックは存在しなかった）、profiles/ethereum
の基本スタックを `docker compose up -d` で起動して検証した。genesis は
停止後の経過時間により自動再生成され、新しいチェーンで開始した。本
ブランチでビルドした collector を隔離ポート（CHAINVIZ_COLLECTOR_PORT=4100
/ CHAINVIZ_PROXY_PORT=4101）で起動し、WebSocket クライアントで snapshot
と diff（edgeAdded/edgeRemoved）を実況記録した。

- **正常時のエッジ安定**: 起動後、beacon1 と beacon2 が P2P 接続を確立し
  （`/eth/v1/node/peer_count` の connected=1、head slot 進行を確認）、
  snapshot に `beacon1--beacon2`（CL P2P）と `reth1--reth2`（EL P2P）の
  2 本のピアエッジが現れた。約 22 秒間の観測で edgeAdded/edgeRemoved は
  一切発生せず、エッジは安定していた。
- **単発の一時失敗ではエッジが維持される（ちらつかない）**: beacon2 を
  `docker pause` で約 7 秒間（poll 間隔 3000ms + HTTP タイムアウト 3000ms
  の下で 1 tick 程度）無応答にし unpause した。collector ログに実際の
  観測失敗（`consensus peer poll failed for chainviz-ethereum/beacon2:
  AbortError`）が記録されたにもかかわらず、observe ログには edgeRemoved
  が一切現れず、`beacon1--beacon2` エッジは維持された。これは Issue #288
  の再現条件（1 回の観測失敗で全エッジが消える）が解消されていることの
  直接確認である。
- **猶予超過ではエッジが消える（恒久不調を隠蔽しない）**: beacon2 を
  `docker stop` で継続停止したところ、停止から約 13 秒後（猶予 3 tick、
  実時間で約 10〜20 秒という設計の想定内）に `beacon1--beacon2` の
  edgeRemoved が配信され、エッジが消えた。単発失敗（上記）では消えず、
  持続失敗でのみ約 13 秒後に消えた対比により、猶予ヒステリシスが即時
  消滅も恒久隠蔽もせず設計どおりに働いていることを確認した。
- **復旧後のエッジ再表示**: beacon2 を `docker start` で再開すると、
  約 13 秒後に `beacon1--beacon2` の edgeAdded が配信され、エッジが
  再表示された。beacon1 の peer_count も connected=1 に復帰した。
- **完了条件の照合（設計メモ「完了条件の言語化」）**: (1) 1 回の失敗で
  表示が変化しない、(2) 猶予超過でエッジが消える、(3) #287 のログ挙動
  維持（間引きにより stop 期間中の多数の失敗のうちログ出力は初回のみで
  あることを実測、挙動不変）——いずれも満たしている。docs/PLAN.md の
  該当項目（#288）の完了条件を満たすと判断する。

検証後、pause/stop した beacon2 は Test5 の `docker start` で復旧済み
（connected=1・head slot 進行を再確認）。破壊的な残留はない。検証用に
起動した collector プロセスは終了し、ポート 4100/4101 は解放済み。
スタック（chainviz-ethereum）は健全な稼働状態のまま残している。
