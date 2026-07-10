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
