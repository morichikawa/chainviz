# Issue #77 作業記録

### 2026-07-05 Issue #77 mainマージ統合のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-77-wallet-tracking
- 内容: マージコミット 5fb84e2(Issue #76 の main 取り込みと
  eth-rpc-client.ts 統合)を静的レビューした。結果は合格。
- 確認したこと:
  - eth-rpc-client.ts: 統合方針(汎用 `call<T>` トランスポート + ドメイン固有
    ヘルパー関数)どおり。#76 由来の `RpcTransaction` / `RpcBlock` /
    `normalizeTransaction` / `getTransactionByHash` / `getBlockByHash` の
    ロジックは main 版と突き合わせて欠落なし。未知 tx / ブロックの null 返却も
    維持(JSON-RPC は `result: null` で返すため、`result === undefined` で
    例外を投げる #77 版 `call()` と両立する)。
  - 挙動差分は1点のみ: 旧 #76 版 `call()` は `result` フィールド欠落
    (仕様違反レスポンス)時に undefined を黙って返したが、統合版は例外を
    投げる。これは異常の握りつぶしをやめる方向の改善であり、呼び出し元
    (`handlePendingTx` / `handleBlockInclusion`)は例外をログして購読を
    継続する設計のため問題ない。
  - targets.ts: `EXECUTION_RPC_PORT` への一本化は、両用途(ウォレット残高・
    nonce 問い合わせ / tx 詳細・ブロック取得)がどちらも同じ reth の HTTP
    JSON-RPC(8545)である以上、意味的に正しい統合。コメントも両用途を
    反映済み。旧 `EXECUTION_HTTP_PORT` やメソッド形式の呼び出しの残骸は
    grep で皆無を確認。
  - peer-block-adapter.test.ts: モックが `call()` の method 名ディスパッチに
    なったことで、テストが実物の `getTransactionByHash` / `getBlockByHash`
    (正規化ロジック含む)を通るようになり、旧モック(ドメインメソッドごと
    差し替え)より検証範囲が広い。#76 の回帰テスト(ブロック取得 null / 例外
    時の再試行)も維持されている。見せかけのテストではない。
  - lint / build / test をレビュー側でも実行し全パッケージ通過を確認
    (collector 483・frontend 353・shared 2・e2e 34)。
- 決定事項・注意点:
  - コミット粒度: コンフリクト解消と統合リワーク(index.ts の呼び出し形式
    書き換え等)が1つのマージコミットに入っている点は許容と判断した。
    add/add 衝突のため両設計は共存コンパイル不能で、統合作業を別コミットに
    分けるとマージコミット単体がビルド不能になる(全コミットがビルド可能で
    あるべき原則に反する)。マージコミット本文と WORKLOG に内訳が明記されて
    おり追跡可能。WORKLOG 追記を別コミット(90a95b4)に分けた点も適切。

### 2026-07-05 Issue #77 mainマージとeth-rpc-client.tsの統合(collector)

- 担当: collector
- ブランチ: issue-77-wallet-tracking
- 内容: main に先行マージされた Issue #76(tx ライフサイクル)を取り込み、
  両ブランチが独立に追加していた
  `packages/collector/src/adapters/ethereum/eth-rpc-client.ts` を統合した。
- 何が競合したか:
  - eth-rpc-client.ts: #76 は `EthRpcClient` にドメイン固有メソッド
    (`getTransactionByHash` / `getBlockByHash`)を持たせる設計、#77 は汎用
    トランスポート `call<T>(url, method, params)` のみを持たせて上位を独立
    ヘルパー関数(`fetchBalanceWei` / `fetchNonce`)にする設計で、同じ
    インターフェース名・同じ実装関数名が add/add で衝突した。
  - targets.ts: HTTP JSON-RPC ポート(8545)の定数が #77 の
    `EXECUTION_RPC_PORT` と #76 の `EXECUTION_HTTP_PORT` として二重定義で
    衝突した。
  - index.ts / index(collector ルート) / store.ts / WORKLOG.md / PLAN.md でも
    追記・import 追加が衝突した。
- どう統合したか(方針: #77 スタイルへ統一):
  - `EthRpcClient` は #77 版(`call<T>` のみ)を共通トランスポートとして採用。
    #76 の `RpcTransaction` / `RpcBlock` 型・`normalizeTransaction` の正規化
    ロジックは削除せず、`getTransactionByHash(rpc, url, hash)` /
    `getBlockByHash(rpc, url, hash)` という独立関数(内部で
    `rpc.call(...)` を呼ぶ)として再実装し、`fetchBalanceWei` /
    `fetchNonce` と同じスタイルに揃えた。
  - index.ts の `this.ethRpc.getTransactionByHash(...)` 等のメソッド呼び出しを
    独立関数呼び出しへ書き換え。
  - ポート定数は `EXECUTION_RPC_PORT` に一本化(用途がウォレット問い合わせと
    tx 問い合わせの両方に広がったためコメントも統合)。参照していた
    targets.test.ts も追随。
  - eth-rpc-client.test.ts は両ブランチのテスト(getTransactionByHash /
    getBlockByHash と fetchBalanceWei / fetchNonce)を新シグネチャで統合。
    peer-block-adapter.test.ts のモック `EthRpcClient` も、メソッド実装から
    `call()` を method 名でディスパッチする形へ書き換えた。
- 決定事項・注意点:
  - #77 版 `call()` は `body.result === undefined` で例外を投げるが、
    未知の tx / ブロックは JSON-RPC 仕様で `result: null`(undefined ではない)
    で返るため、`getTransactionByHash` / `getBlockByHash` は従来どおり null を
    返せる(`normalizeTransaction(null)` が null を返す)。
  - lint / build / test は全パッケージで成功(collector 483・frontend 353・
    shared 2・e2e 34)。

### 2026-07-05 Issue #77 ワークベンチのウォレット追跡の実機検証(qa)

- 担当: qa
- ブランチ: issue-77-wallet-tracking
- 内容: 稼働中の Ethereum プロファイル(compose 起動、reth1/reth2 + beacon +
  workbench、ブロックは進行中)に対し、このブランチで `pnpm build` した
  collector を専用ポートで起動し、WebSocket クライアントで実際のスナップ
  ショット/差分を観測して完了条件を検証した。結果は合格。
- 検証結果:
  - lint / build / test は全パッケージで成功(collector 406・frontend 301
    ほか、全テスト green)。
  - BIP-44 派生の一致: collector の `deriveWalletAddress` が Foundry の
    `cast wallet address --mnemonic ... --mnemonic-index N` と index 0/1/2 で
    完全一致(index0=0x2BB7Dc..., index1=0xfCd956..., index2=0xaD7773...)。
    導出パスは Foundry 既定 `m/44'/60'/0'/0/N`。
  - WalletEntity 反映(条件1): compose 由来ワークベンチ(wallet-index ラベル
    なし → 既定 index 0)の WalletEntity がスナップショットに現れ、
    WorkbenchEntity.walletIds にも同じ index0 アドレスが載る。
  - 残高・nonce の反映(条件2): スナップショットの balance/nonce が
    eth_getBalance / eth_getTransactionCount の直接問い合わせ値と完全一致。
    workbench から `cast send` で送金すると、約3秒後のポーリングで
    entityUpdated 差分(nonce +1・balance が送金額+ガス分だけ減少)が実際に
    配信されることをライブで確認。
  - addWorkbench(条件3): addWorkbench(label=qa-daichi)で新規ワークベンチが
    作成され、wallet-index ラベル(採番=1)に応じた別アドレス
    0xfCd956...(index1)の WalletEntity が owner=新ワークベンチとして追加
    されることを確認。検証後に removeWorkbench でコンテナを後始末済み。
  - mnemonic 未設定/空文字列(条件4): CHAINVIZ_ETHEREUM_PROFILE_DIR を
    (a) EL_AND_CL_MNEMONIC="" (空文字列)、(b) キー自体を持たない values.env
    の 2 通りに差し替えて起動。両方とも起動ログに
    「mnemonic not found in profile values.env; wallet tracking disabled」が
    出力され、プロセスはクラッシュせず継続。スナップショットには wallet が
    現れない一方、node/workbench/block・peer edge(A/B 層)は正常に配信され、
    他機能が動作し続けることを確認。
- 注意点:
  - 本検証は既存の稼働中 compose 環境(別 worktree から起動)を共有し、
    collector のみブランチのビルドで別ポート起動して観測した。ブランチ側の
    collector・作成したワークベンチ・一時プロファイルはすべて後始末済み。

### 2026-07-05 Issue #77 falsy判定修正とmainマージの再々レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-77-wallet-tracking
- 内容: 前回差し戻し1件(空文字列 mnemonic で警告なしに無効化される問題)への
  対応と、main マージ・コミット分割を静的に確認した。結果は合格。
  - `walletTrackingDisabledWarning` の falsy 判定への統一を確認。無効化側
    (wallet-tracker.ts / adapters/ethereum/index.ts)の `!this.mnemonic` と
    条件が一致しており、判定の食い違いは解消された。
  - テストの有効性をミューテーションで確認: 判定を旧実装
    (`mnemonic !== undefined`)に一時的に戻すと「空文字列でも警告が出る」
    テストが実際に失敗する(1 failed / 73 passed)ことを確認し、元に戻した。
    元の不具合を検出できる有意味なテストになっている。
  - main マージ(a59ee13, 9314afd を取り込み)の妥当性: `git merge-tree` に
    よる機械的マージとの差分が WORKLOG のコンフリクト解消(両側のブロックを
    保持しマーカーを除去)のみであること、#77 側 4 件・#78 側 5 件の記録が
    1 件も失われていないこと、マーカーの残存がないことを確認。
  - コミット粒度: main..HEAD は chore(viem 依存) / refactor(mnemonic
    切り出し) / feat(ウォレット追跡) / docs / マージの 5 件で、いずれも
    1 コミット 1 関心事になっている。
  - `pnpm lint` / `pnpm build` / `pnpm test` は全通過
    (shared 2・e2e 34・collector 406・frontend 301)。
- 決定事項・注意点:
  - レビュー時点で origin/main はマージ済みの 9314afd からさらに進んでいる
    (PR #88, fb71515)。両側で WORKLOG.md が伸びているため、この PR の
    マージ時に WORKLOG の再コンフリクトが起きる見込み。解消方針は今回と
    同じく「両側のブロックを両方残す」でよい。
  - 次工程は chainviz-qa による実機検証。

### 2026-07-05 Issue #77 mnemonic未取得警告の判定を無効化条件に揃える(collector)

- 担当: collector
- ブランチ: issue-77-wallet-tracking
- 内容: 再レビューの差し戻し1件に対応した。
  - `walletTrackingDisabledWarning`(mnemonic.ts)の判定を
    `if (mnemonic !== undefined)` から `if (mnemonic)`(falsy 判定)に変更。
    ウォレット追跡を実際に無効化する側(wallet-tracker / adapters/ethereum/index)
    はいずれも `!mnemonic` の falsy 判定で無効化するため、警告の判定もそれに
    揃えた。これにより `EL_AND_CL_MNEMONIC=""`(空文字列)でも警告が出るようになり、
    無言でウォレット層が無効化される経路をふさいだ。
  - 上記に合わせて node-lifecycle.test.ts のテストを「空文字列でも警告する」に
    修正した(従来は「空文字列では警告しない」を仕様として固定していた)。
- 付帯対応:
  - main(9314afd, Issue #78 マージ済み)を取り込み、分岐点(e0d1a58)以降の
    #78 の PLAN チェック・WORKLOG 記録を巻き戻さないようにした。
  - 全変更を chore(viem 依存追加) / refactor(mnemonic 解析・読み込みの
    専用モジュール切り出し) / feat(ウォレット追跡 C 層の実装) / docs の
    論理単位に分割してコミットした。
- 決定事項・注意点:
  - 警告判定と無効化判定は今後も falsy で揃える。片方だけ変えると再び
    「無言の無効化」経路が生まれる。

### 2026-07-05 Issue #77 mnemonic未取得警告の対応の再レビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-77-wallet-tracking
- 内容: 前回の指摘(mnemonic 未取得時にウォレット層が無言で無効化される)への
  対応を再レビューした。`mnemonic.ts` の純粋関数
  `walletTrackingDisabledWarning` と、`main()` での起動時 console.warn 出力、
  ユニットテスト3件(node-lifecycle.test.ts)を確認。`pnpm lint` /
  `pnpm build` / `pnpm test`(collector 406件・frontend 301件ほか)は
  リポジトリ全体で通過。結果は**不合格(差し戻し1件)**。
- 差し戻し指摘:
  - 警告判定と実際の無効化条件が一致していない。
    `walletTrackingDisabledWarning`(mnemonic.ts:44)は
    `mnemonic !== undefined` なら警告なしとするが、ウォレット追跡を
    実際に無効化する側は `!mnemonic`(falsy)判定
    (wallet-tracker.ts:74,131 / adapters/ethereum/index.ts:156)。
    このため `EL_AND_CL_MNEMONIC=""`(parseMnemonic が空文字列を返すケース。
    node-lifecycle.test.ts:100-102 で明示的にサポート)では、警告なしで
    ウォレット追跡が無効化され、元の指摘と同じ「無言の無効化」経路が残る。
    さらに node-lifecycle.test.ts:124-128 のテストがこの誤った挙動
    (空文字列では警告しない)を仕様として固定してしまっている。
    修正方針: 警告判定を無効化側と同じ falsy 判定(`if (mnemonic) return
    undefined;`)に揃え、当該テストを「空文字列でも警告する」に改めること。
- 決定事項・注意点:
  - 上記以外(警告文の内容、main() での出力位置・1行ログ、undefined 系の
    テスト2件)は指摘どおりの対応で問題ない。
  - ブランチの分岐点が e0d1a58 で、main は 9314afd(Issue #78 マージ済み)まで
    進んでいる。このままコミット・PR すると docs/PLAN.md の #78 チェックと
    WORKLOG.md の #78 関連記録を巻き戻す差分になるため、コミット前に main を
    取り込む(merge または rebase)こと。
  - 前回指摘のコミット分割(refactor / feat / docs)は未コミットのため
    引き続き有効。

### 2026-07-05 Issue #77 ウォレット追跡実装のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-77-wallet-tracking
- 内容: collector 担当による Issue #77(ウォレット残高・nonce の追跡)実装の
  静的レビュー。`pnpm lint` / `pnpm build` / `pnpm test` はリポジトリ全体で
  通過(collector 403件・frontend 301件)。結果は合格(軽微な指摘あり。下記)。
  - ChainAdapter 境界: mnemonic 導出(BIP-44)・eth_getBalance /
    eth_getTransactionCount は `adapters/ethereum/` 内に閉じ、world-state 側は
    チェーン非依存の WalletObservation(address/balance/nonce/owner)のみを
    受け取る。境界違反なし。
  - `packages/shared` の型変更不要という判断は妥当。WalletEntity は
    ARCHITECTURE.md §2 どおり既に定義済みで、削除せず ownerWorkbenchId を
    null にする挙動も同 §「差分イベント」の決定と一致する。
  - ウォレット導出インデックスのラベル管理(`com.chainviz.wallet-index`)は
    Issue #65 の「Docker ラベルを単一の真実の情報源とする」方針と整合。
    recoverManagedContainers でのラベル復元テストもあり。
  - RPC 一時失敗と「ワークベンチ消滅」の分離(所有関係は Docker 観測、
    残高・nonce 未取得時は既存値維持・新規は追加保留)は妥当で、異常系
    テスト(全ノード到達不能・フォールバック・mnemonic なし)も揃っている。
  - viem 依存の追加は妥当と判断。BIP-39/BIP-32 導出の自前実装は避けるべきで、
    import は `viem/accounts` サブパスのみでツリーシェイク可能。
- 決定事項・注意点(指摘事項を含む):
  - 【軽微・要対応】mnemonic が読めない場合(values.env 欠落・読み取り失敗)、
    ウォレット層全体が無言で無効化される。`readProfileMnemonic` は catch で
    undefined を返すだけでログが無く、`main()` 側にも起動時の警告が無い。
    起動時に mnemonic 未取得なら「ウォレット追跡を無効化した」旨を 1 行
    ログに出すこと(CLAUDE.md「エラーを握りつぶすコードを見逃さない」)。
  - 【記録】removeWorkbench で解放された導出インデックスは次の addWorkbench で
    再利用される(最小空き番号方式)。同じアドレス(=旧ペルソナの残高・tx 履歴)を
    新しいワークベンチが引き継ぐことになるが、ラベルと env の mnemonic で
    実際にその鍵を使う以上、可視化としては実態どおり。プリマインが index 0〜7
    の 8 口座に限られるため funded な口座を使い回す判断として妥当と判断した。
  - 【既知の限界】compose 由来ワークベンチが複数あると全て index 0(同一
    アドレス)になり、computeWalletDiff で所有者がポーリングごとに入れ替わる
    可能性がある。現行プロファイルは compose ワークベンチ 1 台なので実害なし。
    複数化する際は要対応。
  - 【効率】WalletTracker が DockerPoller.pollOnce() を独自に呼ぶため、A 層の
    ポーリングと合わせて Docker Engine API(list/top/stats)を 3 秒ごとに
    二重取得する。コンテナ数が少ない現状は問題ないが、将来観測を共有する
    余地がある。
  - 【#76 との統合】#76(issue-76-tx-lifecycle)も同パスに `eth-rpc-client.ts` を
    追加しており、同名 interface `EthRpcClient` の形が非互換
    (#76: getTransactionByHash/getBlockByHash のドメインメソッド型、
    #77: 汎用 call(url, method, params) + fetchBalanceWei/fetchNonce ヘルパ)。
    マージ時に add/add コンフリクトになる。統合方針の推奨: #77 の汎用
    call() を共通トランスポートとして残し、#76 のドメインメソッド
    (tx/block 取得と正規化)をその上のヘルパ関数として再実装する
    (JsonRpcResponse 定義・fetch/タイムアウト処理の重複も解消できる)。
  - 【コミット】レビュー時点で未コミット。コミット時は少なくとも
    「mnemonic.ts への移設(refactor)」「ウォレット追跡本体(feat)」
    「docs 更新」を分けること(1 変更 = 1 コミット)。

### 2026-07-05 Issue #77 ワークベンチのウォレット残高・nonceをポーリングしWalletEntityに反映

- 担当: collector
- ブランチ: issue-77-wallet-tracking
- 内容: 稼働中のワークベンチが保持するウォレット（values.env の
  EL_AND_CL_MNEMONIC から導出）の残高・nonce を周期ポーリングし、
  WalletEntity として world-state に反映する C 層の実装。
  - `adapters/ethereum/wallet-derivation.ts`: viem の mnemonicToAccount で
    Foundry 既定パス（m/44'/60'/0'/0/N）のアドレスを導出。導出インデックスは
    コンテナラベル `com.chainviz.wallet-index` から読む（無ければ既定 0）。
  - `adapters/ethereum/eth-rpc-client.ts`: HTTP JSON-RPC クライアント。
    eth_getBalance（16進 wei→10進文字列に BigInt 経由で変換）・
    eth_getTransactionCount（→number）のヘルパを提供。
  - `adapters/ethereum/wallet-tracker.ts`: Docker 観測でワークベンチを列挙し、
    各ウォレットの残高・nonce を Execution ノードの JSON-RPC から取得して
    WalletObservation[] を返し、3 秒間隔で store へ流す。
  - `world-state/diff.ts` の `computeWalletDiff` と store の `applyWallets`:
    ウォレットは削除せず、観測から消えた（所有ワークベンチが消えた）ものは
    ownerWorkbenchId を null に更新して残す（CONCEPT.md の決定）。
  - `adapters/ethereum/node-lifecycle.ts`: addWorkbench 時にワークベンチごとに
    ウォレット導出インデックスを採番（0 は compose 由来ワークベンチ用に予約し
    1 から採番）し、`com.chainviz.wallet-index` ラベルに記録。回収時はラベルから
    復元。parseMnemonic は `mnemonic.ts` へ移して再エクスポート。
  - `adapters/ethereum/index.ts`（EthereumAdapter）: mnemonic 設定時に A 層の
    pollInfra で WorkbenchEntity.walletIds に主たるウォレットアドレスを載せる
    （ラベル index から導出。毎回同じ値なのでポーリングで安定し、C 層の
    WalletEntity と突き合う）。
- 決定事項・注意点:
  - mnemonic からのアドレス導出は Ethereum 固有ロジックとして
    `adapters/ethereum/` に閉じ込め、world-state 側は「アドレス・残高・nonce・
    所有者」というチェーン非依存の WalletObservation だけを受け取る。
  - 「1 ワークベンチ = 1 ユーザー = 1 つの主たる鍵」（CONCEPT.md 案B）に沿い、
    ワークベンチごとに異なる導出インデックス＝異なるアドレスを割り当てる。
    profiles/ethereum のプリマインは 0〜7 の 8 アカウントなので、index 1〜7 は
    残高付き、8 以降は残高 0 の有効アドレス（残高 0 でも WalletEntity として
    正しく表示される）。導出インデックスはコンテナラベルを単一の真実の
    情報源とし（Issue #65 の方針に揃える）、collector 再起動後も安定する。
  - RPC が一時的に落ちても所有関係の判定は Docker 観測に依存するため、RPC 失敗を
    「ワークベンチ消滅（= 所有者 null 化）」と取り違えない。残高・nonce が
    取れないアドレスは既存値を維持し、新規アドレスは値が取れるまで追加を保留
    （暫定の 0 を見せない）。
  - viem を collector の依存に追加（mnemonicToAccount のため）。
  - 実機確認（profiles/ethereum 稼働中）: compose ワークベンチ（index 0,
    0x2BB7…d4c0）の残高・nonce がスナップショットに含まれること、cast send 後に
    balance が約 1ETH+gas 減り nonce が 1→2 に更新されること、addWorkbench で
    index 1（0xfCd9…44d6）の別ウォレットが所有付きで現れること、removeWorkbench
    で当該ウォレットが削除されず ownerWorkbenchId が null に更新されることを確認。

