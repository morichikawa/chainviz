### 2026-07-11 Issue #238 長時間のUI層E2Eフルスイート実行中にcollectorがuncaughtExceptionでexitし、以降の全テストがカスケード失敗する

#### 設計メモ（着手前）

- 担当: collector
- ブランチ: issue-238-collector-crash-cascade

**原因の特定**

`packages/collector/src/adapters/ethereum/eth-ws-client.ts` の `subscribe()`
（`subscribeNewHeads`/`subscribePendingTransactions` の共通実装）にある
`current.on("message", ...)` ハンドラが原因箇所だと特定した。

```ts
current.on("message", (data) => {
  ...
  const result = parseSubscriptionResult(raw);
  if (result !== undefined) onResult(result as T);
});
```

`onResult` はここでは EthereumAdapter が渡す `onHeader`/`onTxHash` そのもので
あり、その先で `blockTracker.record()` → `onBlock()`（index.ts の
`store.applyBlock()` + `server.broadcastDiff()`）まで同期的に実行される。
このコールバック呼び出しが `try/catch` で囲われていない。

一方で、兄弟にあたる他の購読・ポーリングループは例外を必ず捕捉している:
- `subscribePeers`（同ファイル、setTimeoutループの `tick()`）: try/catch あり
- `WalletTracker.subscribe`（wallet-tracker.ts の `tick()`）: try/catch あり
- `subscribeNodeInternals`（同ファイル、`nodeInternalsTick()`）: try/catch あり
- `subscribeTransactions` の各コールバック
  （`handlePendingTx`/`handleBlockInclusion`）: 呼び出し先の async 関数
  本体全体が try/catch で囲われている

`subscribeBlocks` のコールバックだけがこの型から外れており、ここで
- `header` が `null`（`eth_subscription` の `result` が `null` のような
  想定外だが JSON として妥当な応答。パース自体は成功するため
  `parseSubscriptionResult` は `null` をそのまま通す）
- あるいは `store.applyBlock`/`server.broadcastDiff` 内部の想定外の例外

のいずれかが起きると、`ws` ライブラリの `message` イベント発火の同期
呼び出しスタックの中で例外が投げられ、どこにも catch されないまま
`process.on("uncaughtException")`（`index.ts` の `installProcessSafetyNet`）
まで届く。`installProcessSafetyNet` はこの安全網としての設計どおり
（Issue #63/#65 の経緯でフェイルファスト方針を確定済み）ログを残して
`process.exit(1)` するため、collector プロセスそのものが落ちる。

Issue #238 の再現条件（`commands-node`/`multi-client`/`contract-lifecycle`
等、addNode/removeNode を行う spec が多数を占めるフルスイート実行でのみ
高頻度に再現し、個別実行では再現しない）とも整合する。addNode/removeNode
は execution ノードコンテナの生成・削除（reth プロセスの起動・SIGTERM）を
伴い、コンテナのライフサイクル境界では eth_subscribe の通知として通常
想定しない形のフレームが飛んでくる余地がある。ただし今回は「どの具体的な
データが引き金になったか」の完全な再現までは追えていない（E2Eフルスイート
再実行によるログ採取は本Issueの範囲では現実的でないため）。重要なのは
「`onResult` 呼び出しがどんな理由であれ例外を投げると、この購読ループ
1本の異常では済まずプロセス全体を巻き込む」という設計上の欠落そのもので
あり、これは兄弟ループとの非対称性から静的に指摘できる。

**修正方針**

`subscribe()` 内で `onResult(result as T)` の呼び出しを try/catch で囲み、
例外を握りつぶさず `onError`（既存の呼び出し側ログ経路。
`[ethereum] newHeads subscription failed for ${stableId}` 等、発生源が
わかる形で呼び出し側がログ済み）へ転送する。これにより:

- 他の購読ループと同じ「この購読1本の異常としてログして継続する」流儀に
  揃う
- `header`/`onBlock`/`onTx` 側の実装に例外があっても、collector プロセス
  全体を落とさなくなる
- `parseSubscribeError`/`parseSubscriptionResult` のような純粋関数側の
  防御（Issue #143 で対応済み）とは別に、コールバック境界（ws ライブラリの
  イベントループ同期呼び出しスタックと、上位のアダプタ/ストア/配信ロジック
  との境界）を eth-ws-client.ts 側で閉じる。これは「chainWs への依存を
  このファイルに閉じ込める」という既存のファイル冒頭コメントの責務とも
  整合する（ws 由来の同期例外伝播という chain 非依存の問題を、chain
  アダプタ側の個々の呼び出し元ではなくこの境界で1箇所解消する）

`EthereumAdapter.subscribeBlocks` 側の呼び出しコード自体は変更しない
（`eth-ws-client.ts` 側で塞げば、将来 `onResult` を使う購読が増えても
同じ保護が及ぶため、個々の呼び出し元に try/catch を重複して書く必要が
ない）。

**影響範囲**

- `packages/collector/src/adapters/ethereum/eth-ws-client.ts` のみ
  （`subscribe()` 内部の防御追加）。呼び出し側のシグネチャ・挙動
  （正常系）は変更しない
- `packages/shared` の型変更は不要

**テスト方針**

`eth-ws-client.test.ts` に、`onResult`（`subscribeNewHeads` の
`onHeader`）が例外を投げるケースのテストを追加する。実際に
`FakeNodeServer` から通知を送り、`onHeader` 内で例外を投げさせ、
(1) `onError` に例外が転送されること、(2) プロセスが落ちない
（`uncaughtException` が発火しない）ことを確認する。後者は
`process.listenerCount("uncaughtException")` の変化がないこと、または
テスト実行自体が完走することで代替確認する（vitest のテストプロセス内で
実際に uncaughtException を起こすとテストランナー自体が巻き込まれるため、
「例外が起きても onError 経由で捕捉され、外へ伝播しない」ことを直接
アサートする形にする）。

修正前の状態で先に失敗するテストを書き、実際に再現することを確認して
から修正する。

#### 実施内容（実装後）

- `packages/collector/src/adapters/ethereum/eth-ws-client.ts` の
  `subscribe()` 内 `current.on("message", ...)` ハンドラで、
  `onResult(result as T)` の呼び出しを try/catch で囲み、例外が起きた場合は
  `onError` へ転送するように変更した。他の周期購読ループ
  （`subscribePeers`/`WalletTracker.subscribe`/`subscribeNodeInternals`）と
  同じ「この購読1本の異常としてログして継続する」流儀に揃えた。
- 新規テストファイル
  `packages/collector/src/adapters/ethereum/eth-ws-client-callback-safety.test.ts`
  を追加し、以下を確認した:
  - `onHeader`（newHeads 購読）が例外を投げても `onError` に転送され、
    `process.listenerCount("uncaughtException")` に変化がない
    （= プロセス全体の安全網まで例外が届いていない）こと
  - 1回目の通知処理で例外が起きても、購読自体は継続し次の通知を
    正しく処理できること
  - `onTxHash`（newPendingTransactions 購読）でも同様に例外が
    `onError` に転送されること
  - 既存の `eth-ws-client.test.ts`（JSON-RPC レベルのパース・エラー応答・
    再接続の既存テスト群）とは関心事が異なるため、CLAUDE.md の
    「テストファイルも1ファイル1責務」の方針に従い別ファイルに分離した
- 修正前の実装（try/catch を外した状態）に一時的に戻して同じテストを
  実行し、実際に `Uncaught Exception` としてテストプロセスへ伝播する
  （= Issue #238 の症状を再現する）ことを確認済み。その後修正を戻して
  全テストが green になることを確認した
- `pnpm build`・`pnpm lint`・`pnpm test`（collector パッケージ含む全体）が
  通ることを確認した（1140テスト、43ファイル、全件 green）

#### 決定事項・注意点

- 具体的に「どのデータが `onResult` に渡って例外を誘発したか」までは
  再現できていない（E2Eフルスイートの長時間再実行によるログ採取は本Issue
  の範囲では現実的でないため）。今回の修正は「`onResult` 呼び出しが
  どんな理由であれ例外を投げると、この購読ループ1本の異常では済まず
  プロセス全体を巻き込む」という設計上の非対称性（他の購読・ポーリング
  ループは全て例外を捕捉しているのに対し、この境界だけ捕捉していなかった）
  を静的に指摘して閉じたものである。原因データそのものの特定が必要な
  場合は `chainviz-detective` による実測調査を別途検討すること
- Issue 本文で提案されていた「UI層E2Eのテストハーネス側で共通のcollector
  生死チェックを各specに入れる」「afterAllの後片付けをcollectorの生死と
  独立させる」という2つの対策は e2e パッケージ（`chainviz-frontend`/
  テストハーネス側）の担当範囲であり、本Issueでは collector 側の
  根本原因修正のみを対応した。必要であれば別途 Issue 化して e2e 担当に
  依頼することを推奨する
- Issue コメントで指摘されていた `commands-node.spec.ts`・
  `commands-workbench.spec.ts` の `afterAll` の即時 `count()` チェックに
  よる後片付け漏れも同様に e2e パッケージ側の課題であり、本Issueの
  スコープ外

#### テスト強化（テスト強化担当）

実装担当が追加した `eth-ws-client-callback-safety.test.ts` の基本テスト
（onHeader が例外を投げる／例外後も継続する／onTxHash が例外を投げる）を
土台に、異常系・境界値の観点で以下のケースを追加した（同ファイルは
「onResult 呼び出し境界の例外分離」という単一の関心事にまとまっているため、
分割せず同ファイルに describe を追加する形で拡充した）。

- **両コールバック境界の対称性**: `onTxHash`（newPendingTransactions）でも、
  1 回例外が起きた後に次の通知が正しく処理される（購読が壊れない）ことを
  追加。`onHeader` 側と同じ `subscribe()` の try/catch で対称に守られている
  ことを裏付ける。
- **連続例外での継続**: 3 連続で例外を起こしても、そのたびに onError へ
  転送され（途中で握りつぶさない）、その後の正常な通知も処理できることを
  確認。「1 回だけ耐えて 2 回目でクラッシュする」見落としが無いことの回帰。
- **投げられる値の種類**: Error インスタンス以外（文字列・null・undefined・
  数値・プレーンオブジェクト）を throw しても、その値がラップ・変換されず
  そのまま onError に転送され、プロセスも落ちないことをパラメタライズド
  テストで確認。
- **非同期に reject するコールバックの境界**: onHeader/onTxHash の型は
  同期 `(result) => void` であり、subscribe() の try/catch は同期的な throw
  のみを捕捉する。async コールバックが reject した場合はマイクロタスクで
  拒否されるため try/catch では捕まらず onError には転送されないが、
  collector の安全網（installProcessSafetyNet）では unhandledRejection は
  「ログして生かし続ける」扱いのため uncaughtException（process.exit する側）
  には至らない、という非同期境界の挙動を回帰として固定した（vitest 本体の
  unhandledRejection リスナーに拾われてテストが失敗しないよう、当該試験の
  間だけ自前リスナーへ差し替えて拒否理由を捕捉し、終了時に元へ復元する）。
- **onError 未指定時のフォールバック**: subscribe() は onError を省略可能に
  しているため、`onError?.(err)` は onError が undefined のとき何もしない
  （例外が握りつぶされる）。この場合でも uncaughtException でプロセスを
  巻き込まず、握りつぶし後も購読が継続することを確認した。

いずれも `pnpm --filter @chainviz/collector test`（1149 テスト、全件 green）・
`pnpm --filter @chainviz/collector build`・`pnpm lint` が通ることを確認済み。

**実装担当への申し送り（バグではないが検討候補）**

- `subscribe()` の onError 未指定時（`onError?.(err)`）は、例外がログにも
  残らず静かに消える。全ての実運用呼び出し元（`EthereumAdapter.subscribeBlocks`
  / `subscribeTransactions`）は onError（console.error へのログ）を必ず
  渡しているため実害は無いが、CLAUDE.md の「エラーを握りつぶさない」方針
  からは、onError 未指定時にフォールバックのログを出す（または onError を
  必須にする）改善の余地がある。今回はテスト強化のスコープを越えるため
  実装は変更せず、現状挙動の固定に留めた。
- 同期の try/catch は async コールバックの reject を捕捉しない点も同様に、
  現状は unhandledRejection の安全網でクラッシュは防げているものの、
  onError へ揃えたい場合は `Promise.resolve(onResult(...)).catch(onError)`
  のような対応が別途必要になる。現行の呼び出し元は同期処理（または内部で
  try/catch 済みの async を `void` で捨てる）ため今は不要と判断した。

#### レビュー（chainviz-reviewer）

判定: **合格**。

確認した内容:

- **根本原因への対処**: `subscribe()` の `"message"` ハンドラで
  `onResult` 呼び出しだけが try/catch されていなかった非対称性が修正の
  対象であり、修正はその境界を正しく閉じている。修正箇所は
  `eth-ws-client.ts` の1箇所のみで、正常系の挙動・シグネチャに変更はない
- **テストが実際に不具合を検出できること**: レビュー時に try/catch を
  一時的に外した状態で `eth-ws-client-callback-safety.test.ts` を実行し、
  12件中11件が失敗する（= 修正なしでは通らない）ことを確認した。
  通過する1件は「非同期 reject は同期 try/catch の対象外」という
  修正の有無に依存しない境界挙動の固定テストであり、通過は妥当。
  確認後にソースは `git checkout` で復元済み
- **他の購読ループとの対称性**: `subscribePeers`・`WalletTracker`・
  `subscribeNodeInternals`・`handlePendingTx`/`handleBlockInclusion` が
  いずれも「例外をログして購読継続」の形であることをコード上で確認し、
  今回の修正で `onResult` 境界も同じ流儀に揃ったことを確認した
- **ビルド・lint・テスト**: `pnpm build`・`pnpm lint`・`pnpm test`
  （collector 43ファイル/1149件、frontend 106ファイル/1623件）全件通過
- **コミット粒度**: fix+基本テスト / テスト強化 / docs×2 の4コミットに
  分かれており、Conventional Commits 準拠
- **docs**: PLAN.md のチェック+Issue リンク、WORKLOG.md 索引行、本ファイル
  の記録がいずれも実装と一致。`docs/ARCHITECTURE.md` には例外伝播の詳細に
  関する記述はなく、齟齬なし

テスト強化担当からの申し送り2点への判断:

1. **onError 未指定時に例外が静かに消える点**: 実運用の呼び出し元は
   `EthereumAdapter.subscribeBlocks`（index.ts:490）と
   `subscribeTransactions`（同 530・541）の3箇所のみで、全て
   `console.error` へログする onError を渡していることを確認した。
   よって現状の実害は無い。また `onError?.()` の optional パターンは
   今回の修正が導入したものではなく、同ファイルの `"error"` イベント
   ハンドラや Issue #143 の eth_subscribe 拒否検知でも既に使われている
   既存設計である。したがって本Issueの差し戻し理由とはしない。
   ただし CLAUDE.md の「エラーを握りつぶさない」方針との整合上、
   「onError 未指定時は console.error へフォールバックする（または
   モジュール内私有関数 subscribe() のレベルで onError を必須にする）」
   改善を別Issueとして起票することを推奨する（`"error"` イベント経路も
   同じ性質を持つため、まとめて扱うのが適切）。なお catch 内コメントの
   「ログして継続する」は onError が渡された場合にのみ成立する表現である
   点も、その改善の際に併せて解消されるのが望ましい
2. **同期 try/catch が async コールバックの reject を捕捉しない点**:
   現行の呼び出し元のうち subscribeBlocks の onHeader は完全に同期
   （blockTracker.record → store.applyBlock → broadcastDiff）、
   subscribeTransactions の2つは async だが関数本体全体が try/catch で
   囲われており reject が外へ漏れない構造であることを確認した。仮に
   漏れた場合も installProcessSafetyNet の unhandledRejection は
   「ログして継続」であり process.exit には至らない。テストがこの境界
   挙動を回帰として固定済みであるため、現時点で対応不要と判断する。
   将来 onResult に素の async コールバックを渡す購読を追加する際は
   この境界に注意すること（本ファイルのテストコメントに記載あり）

#### QA検証記録（chainviz-qa）

判定: **合格**（Issue #238 の完了条件「collector がクラッシュし以降の全テストが
カスケード失敗する」が実際に解消されていることを実機で確認した）。

検証環境: 既に稼働中の Ethereum スタック（`chainviz-ethereum`、reth1 =
172.28.1.1:8546、稼働 4〜5 時間・ブロック高さ 7700 前後で進行中）を利用。

1. **ユニットテスト**: `pnpm --filter @chainviz/collector test`（43 ファイル
   1149 件）が全件 green。うち `eth-ws-client-callback-safety.test.ts`（12 件）
   がコールバック例外分離を担保している。

2. **実ノードへの例外注入（本Issueの核心の検証）**: ビルド済みの
   `createWsEthClient` を稼働中 reth（`ws://172.28.1.1:8546`）へ実接続し、
   `subscribeNewHeads` の `onHeader` が受信ブロックごとに毎回例外を投げる
   スクリプトを実行した。テストのモックではなく実コード・実ノードでの確認。
   - **修正後（dist の現行コード）**: 実際に進行する 20 ブロック連続で
     onHeader が毎回例外を投げたが、20 件すべてが `onError` に転送され、
     購読は生き続け、`uncaughtException` は一度も発火せず、プロセスは
     落ちなかった。
   - **修正前の再現確認**: コンパイル済み JS の該当箇所から try/catch を
     外した版（`eth-ws-client-prefix.js`。ソースは変更せず dist のコピーを
     一時的にパッチして検証後に削除）で同じスクリプトを実行したところ、
     最初のブロックの onHeader が投げた時点で `uncaughtException` となり
     `process.exit(1)` した。これは Issue #238 の症状（collector プロセスが
     丸ごと落ちる）そのものであり、修正が実際にこの不具合を止めていること、
     およびテストが検出対象としている不具合が実在することを確認した。

3. **複数 E2E ファイルの連続実行**: 実 collector 子プロセスを立てて実スタックを
   相手にする vitest E2E のうち、addNode/removeNode 系（commands / error-paths /
   reconnect）とブロック・tx 伝播系（a-b-layer / d-layer）の代表 5 ファイルを
   連続実行した（実行時間 約 622 秒）。
   - 5 ファイル中 4 ファイル（error-paths 4 件・d-layer 3 件・a-b-layer 1 件・
     reconnect 2 件、計 11 件）が全て合格。
   - commands.test.ts の addNode 1 件のみ失敗したが、内容は「追加した reth が
     540 秒以内に既存チェーンの現在高さ（7873）へ追いつけなかった（到達
     5501）」という**新規ノードの同期タイムアウト**であり、collector の
     クラッシュではない。実際、同ファイル内の後続テスト（removeNode）も、
     後続の 4 ファイルも全て collector が生きたまま合格しており、Issue #238 の
     症状である「以降の全テストのカスケード失敗」は起きていない。collector の
     出力にも uncaughtException / fatal / ECONNREFUSED の痕跡は無かった。

**検証中に判明した環境上の注意点（Issue #238 とは無関係、申し送り）**

- E2E ハーネスが起動する collector は WS ポートを `CHAINVIZ_COLLECTOR_PORT`
  （既定 4123）で受け取るが、ロギングプロキシポート（既定 4001）は
  `CHAINVIZ_PROXY_PORT` を明示しない限り 4001 固定。ホスト上で dev collector が
  既に 4001 を占有していると、E2E collector が起動時に `EADDRINUSE` で fatal
  exit し、全 spec が ECONNREFUSED で落ちる。今回は `CHAINVIZ_PROXY_PORT` を
  空きポートに設定して回避した。E2E ハーネス側でプロキシポートも
  WS ポートと同様に自動割り当て/衝突回避する余地がある（別途 e2e 担当で
  検討推奨）。
- commands.test.ts の addNode 追従テストは、既存チェーンが長時間稼働で高く
  なるほど新規ノードの初期同期に時間がかかり、固定の全体タイムアウト
  （540 秒）を超えて失敗しやすくなる。今回の失敗はこの性質によるもので
  Issue #238 の回帰ではないが、CLAUDE.md の「今この瞬間に観測できる状態に
  依存した固定値」の観点から、E2E 担当側でタイムアウトを到達速度から動的に
  導出するか前提条件を明記する改善を別途検討する価値がある。
