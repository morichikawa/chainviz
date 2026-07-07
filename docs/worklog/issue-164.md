### 2026-07-07 Issue #164 追跡中トークンコントラクトの残高ポーリング

- 担当: collector
- ブランチ: issue-164-token-balance-polling
- 内容: `docs/ARCHITECTURE.md` §4「ウォレットのトークン残高」の設計どおり、
  既存の `WalletTracker`（ETH残高・nonceポーリング）を拡張し、追跡中の
  トークンコントラクト（`ContractEntity.token` を持つもの＝カタログの
  ChainvizToken）に対する `balanceOf` 残高照会を同じ周期・同じウォレット
  集合に対して行い、`WalletEntity.tokenBalances` へ反映した。

  - `packages/collector/src/adapters/ethereum/eth-rpc-client.ts`: 汎用の
    `ethCall(rpc, url, to, data)` を追加した（`eth_call` を `{to, data}` /
    `"latest"` で呼ぶだけの薄いラッパー。ABIの意味論はここでは扱わない）。
  - `packages/collector/src/adapters/ethereum/erc20.ts`（新規）: ERC20の
    `balanceOf(address)` のABIエンコード/デコードを担う。viemの標準
    `erc20Abi`（`encodeFunctionData`/`decodeFunctionResult`）を使い、
    コントラクトごとに異なりうるカタログABIには依存しない（token メタ
    情報を持つコントラクトはいずれもERC20標準のbalanceOfを実装している
    前提のため）。`fetchErc20Balance(rpc, url, tokenAddress, walletAddress)`
    が最小単位の残高を10進文字列で返す。
  - `packages/collector/src/adapters/ethereum/contracts.ts`
    (`ContractTracker`): `tokenContractAddresses(): string[]` を追加した。
    追跡中（デプロイ検知済み）かつカタログの `token` メタ情報を持つ
    コントラクトのアドレス一覧（正規化済み・小文字表記）を返す。
  - `packages/collector/src/adapters/ethereum/index.ts`
    (`EthereumAdapter`): `trackedTokenContractAddresses(): string[]` を
    追加し、`contractTracker.tokenContractAddresses()` へ委譲する。
    `registerContractDeployment` と同じく `ChainAdapter` インターフェース
    には含めない `EthereumAdapter` 固有の拡張APIとした。
  - `packages/collector/src/world-state/diff.ts`: `WalletObservation` に
    `tokenBalances?: TokenBalance[]` を追加した（collector内部のみの型。
    `packages/shared` の変更ではない）。`mergeTokenBalances(before, observed)`
    を新設し、`computeWalletDiff` から使う。マージ規則:
    - `observed`（今回のポーリングで取得できた分だけ）が `undefined`
      （追跡中トークンコントラクトが0件で、ポーリング自体を行わなかった）
      なら `before` をそのまま維持する
    - `observed` にあるコントラクトアドレスは最新値で上書き・追加。
      `observed` に無い（今回だけ取得に失敗した）コントラクトアドレスは
      `before` の値を維持する（balance/nonceの「undefinedなら既存値を
      維持する」という既存方針を、配列の要素単位に拡張した形）
    - マージ結果が空配列になる場合は `undefined` を返す。これにより
      「トークンは追跡されているがこのウォレットの残高がまだ一度も
      取得できていない」状態を、`tokenBalances: []`（0件と確定している
      状態）と区別する（`WalletEntity.tokenBalances` の「省略＝情報なし」
      という既存の約束を保つ）
  - `packages/collector/src/adapters/ethereum/wallet-tracker.ts`
    (`WalletTracker`): `WalletTrackerDeps` に
    `getTokenContractAddresses?: () => string[]`（既定は常に空配列を返す
    関数）を追加した。`pollOnce()` で、この関数が返すアドレスが1件以上
    あるときだけ、各ウォレット × 各トークンコントラクトの `balanceOf` を
    追加取得する（0件なら追加のRPC呼び出し自体を一切行わない設計。
    無駄なポーリングを避けるという今回の要求どおり）。個別のトークンの
    取得失敗は、既存の `fetchWalletState`（balance/nonce。ノードを順に
    フォールバック）と同じパターンで、Execution RPC URLを順に試し、
    全滅時のみそのトークンだけ結果配列から除外する（他のトークン・他の
    ウォレットの取得は継続する）。
  - `packages/collector/src/index.ts`: `WalletTracker` の生成時に
    `getTokenContractAddresses: () => adapter.trackedTokenContractAddresses()`
    を渡すよう配線した（`EthereumAdapter` の `ContractTracker` を単一の
    真実の情報源として都度問い合わせる）。

- 決定事項・注意点:
  - **ポーリング間隔は既存の `WALLET_POLL_INTERVAL_MS`（3秒）をそのまま
    使う**。新しい定数は追加していない。`docs/ARCHITECTURE.md` の
    「既存の残高・nonceポーリングと同じ周期で行う」という決定に従った
    ためで、CLAUDE.mdの「観測できる状態に依存した固定値」の懸念とは
    無関係（値は既存の合意値の再利用であり、新規の決め打ちではない）。
  - **RPC呼び出し回数の増加**: トークンコントラクトが `N` 件追跡される
    ようになると、1ポーリング周期あたり `(追跡中ウォレット数) ×
    N` 回の `eth_call` が追加される。現状のカタログはChainvizToken
    1件のみなので実運用上の影響は小さいが、将来カタログにトークンが
    追加された場合はこの積が増える点に留意（設計時の想定どおりで、
    「トークンが1つもデプロイされていなければ何もしない」という要求は
    満たしている）。
  - **`fetchErc20Balance` はカタログのABIを使わない**: `decode.ts`
    （tx呼び出し・イベントログの復号）はコントラクトごとに異なりうる
    カタログABIを使うのに対し、こちらはviemの標準 `erc20Abi` を直接使う。
    `WalletEntity.tokenBalances` の対象がカタログの `token` メタ情報
    （symbol/decimals）を持つコントラクトに限定されており、これらは
    いずれもERC20標準の `balanceOf(address)` を実装している前提のため、
    コントラクトごとのABIを引き回す必要がないと判断した。将来ERC20標準
    から外れるトークン相当のコントラクトを追加する場合はこの前提が
    崩れるため、その時点で再検討が必要。
  - **`ContractTracker.tokenContractAddresses()` の対象範囲**:
    `recordDeployment` 済み（実際にチェーン上でデプロイが検知された）
    かつ `registerDeployment` でカタログ照合済み（`token` フィールドが
    確定済み）のもののみを返す。`registerDeployment` がデプロイ検知前に
    呼ばれ `pendingCatalogKeys` に保留されているだけの状態では対象に
    含まれない（コントラクト自体がまだ追跡マップに存在しないため）。
  - テスト用のアドレス生成に関する注意（次の担当への申し送り）:
    viemの `encodeFunctionData`（`erc20Abi.balanceOf` の `address` 引数の
    ABIエンコード）は、渡されたアドレスがEIP-55チェックサムに一致しない
    「大小混在」表記だと `InvalidAddressError` を投げる。ただし数字のみ
    （英字を含まない）表記や全小文字表記は常に有効と判定される。
    `wallet-tracker.test.ts` では既存の `deriveAddress` スタブが
    `"0xindex0"` のような非16進文字列を返すため、トークン残高を扱う
    新規テストでは別の `deriveHexAddress`（`index` を16進の数字のみの
    アドレスへ写す）スタブを用意した。`erc20.test.ts` でも同様に
    `padStart` で生成した数字のみのアドレスを使っている。
  - 新規・変更したテスト: `eth-rpc-client.test.ts`（`ethCall`）、
    `erc20.test.ts`（新規。`fetchErc20Balance` のセレクタ・エンコード・
    エラー伝播）、`contracts.test.ts`（`tokenContractAddresses`）、
    `peer-block-adapter.test.ts`（`EthereumAdapter.trackedTokenContractAddresses`
    の統合的な確認）、`diff.test.ts`（`computeWalletDiff` の
    tokenBalancesマージ規則：新規追加・上書き・部分失敗時の既存値維持・
    空配列と省略の区別）、`wallet-tracker.test.ts`（トークン0件時に
    `eth_call` を一切行わないこと、複数ウォレット×複数トークンの網羅、
    個別トークン失敗時の部分的な除外、ノードフォールバック）。
  - `pnpm --filter @chainviz/collector build`・
    `pnpm --filter @chainviz/collector test`（935件、うち新規29件）・
    `pnpm lint`（リポジトリ全体）がいずれも成功することを確認した。

### 2026-07-07 Issue #164 テスト強化（エッジケース・境界値）

- 担当: tester
- ブランチ: issue-164-token-balance-polling（実装担当の続き）
- 内容: 実装担当が書いた基本テストのカバー範囲を確認し、異常系・境界値の
  観点で不足していたテストを追加した。実装コードは変更していない。
  - `erc20.test.ts`: `fetchErc20Balance` の巨大残高の精度保持を追加。
    uint256 最大値（2^256 - 1、78桁）と、18桁小数トークン相当の非丸め値で、
    bigint 経由の10進文字列化により number の桁落ちが起きないことを確認する
    （既存テストは24桁までの値のみだった）。
  - `wallet-tracker.test.ts`: トークン残高0の扱いと到達不能時の追加確認。
    - `balanceOf` が0を返すケースで、`amount: "0"` として結果に含まれ、
      取得失敗（undefined で除外）と区別されることを確認する。
    - トークン追跡中だが Execution ノードが1件も観測に無い（RPC URL が空）
      場合に、tokenBalances が空配列・balance/nonce が undefined になり、
      `eth_call` が1度も発行されないことを確認する。
    - トークン0件時のテストに、ETH 残高・nonce のポーリングには影響しない
      ことの明示的なアサーション（balance/nonce が保持される）を追加した。
  - `diff.test.ts`（`computeWalletDiff` の tokenBalances マージ）:
    - 既存 tokenBalances に無い新しいコントラクトアドレスの追加を、
      既存アドレスの更新と同時に行うケース（A更新 + B新規 → 両方残る）。
    - 新規アドレスが既存の順序を乱さず末尾に追加されること。
    - 複数ウォレットが別々の tokenBalances を持つとき、1回の diff 計算で
      各ウォレットが独立にマージされ、観測が混ざらないこと。
    - uint256 最大値相当の amount がマージを通して文字列として保持され、
      数値化・桁落ちが起きないこと（erc20層の精度保持との end-to-end の裏づけ）。
- 実装のバグは発見しなかった。差し戻しなし。
- `pnpm --filter @chainviz/collector test`（943件、うち今回追加8件）・
  `pnpm --filter @chainviz/collector build`・`pnpm -r build`（全パッケージ）
  がいずれも成功することを確認した。

### 2026-07-07 Issue #164 レビュー（1回目・差し戻し）

- 担当: reviewer
- ブランチ: issue-164-token-balance-polling
- 内容: トークン残高ポーリング実装（erc20.ts 新設、ethCall 追加、
  tokenContractAddresses、mergeTokenBalances、WalletTracker 統合）と
  tester による境界値テスト追加の静的レビュー。
- 確認できたこと（問題なし）:
  - ChainAdapter 境界: ERC20 固有のロジック（balanceOf のセレクタ、viem の
    erc20Abi によるエンコード/デコード）は `adapters/ethereum/erc20.ts` に
    閉じている。`WalletObservation.tokenBalances` / 共有型 `TokenBalance` は
    contractAddress・amount というチェーン非依存の語彙のみで、
    `packages/shared` に変更は無い（既存型をそのまま使用）
  - RPC 呼び出しの最適化: `pollOnce()` で `getTokenContractAddresses()` を
    周期あたり1回だけ呼び、空配列なら `eth_call` を一切発行しない。テスト
    （`omits tokenBalances and makes no eth_call ...`）が `ethCallLog` の
    件数 0 を直接検証しており、実装・テストとも要求どおり
  - 固定値: 新しい定数の追加は無く、既存の `WALLET_POLL_INTERVAL_MS`（3秒）の
    再利用のみ。実装担当の報告は正確
  - mergeTokenBalances: 「undefined = ポーリング自体なし → 既存値維持」
    「observed に無いアドレス = 今回取得失敗 → 既存値維持」「空配列への
    縮退時は undefined に戻し『0件』と『情報なし』を区別」という規則が
    balance/nonce の「undefined なら既存値維持」方針と一貫している。
    fieldPatch は deepEqual 比較のため、値が変わらない周期で無駄な
    entityUpdated が出ないことも確認した
  - テストの質: uint256 最大値の精度保持、0 と undefined の区別、複数
    ウォレットの独立マージ、部分失敗時の既存値維持、ノードフォールバック、
    トークン0件時の呼び出し抑止など、異常系・境界値を実質的に検証している。
    セレクタ（0x70a08231）や calldata の引数エンコードまで確認しており、
    実装をなぞるだけの無意味なテストは見当たらない
  - `pnpm lint` / `pnpm build` / `pnpm test`（shared 40・collector 943・
    frontend 791・e2e 34）すべて成功
- 差し戻し指摘（要修正1件）:
  1. `wallet-tracker.ts` の `fetchTokenBalance`: URL ごとの catch で捕捉した
     エラーを保持せず破棄し、全滅時のログを固定文言
     「all execution RPC endpoints unreachable」にすり替えている。実際の
     失敗原因は到達不能とは限らず（balanceOf の revert、viem のデコード
     失敗、HTTP エラー等もこの経路に入る）、CLAUDE.md「具体的なエラー内容を
     握りつぶして汎用メッセージにすり替えている箇所」に該当する。最後に
     捕捉したエラーを変数に保持し、ログに含めること（文言も原因を断定
     しない形にする。例:
     `console.error("[ethereum] token balance poll failed for token ... / wallet ...:", lastError)`）
- 軽微な推奨（差し戻し理由ではない）:
  - `world-state/diff.ts` の `WalletObservation.tokenBalances` のコメントに
    チェーン固有の語彙「balanceOf」が入っている。スキーマ自体は
    チェーン非依存で問題ないが、コメントも「残高照会」等の中立な表現に
    直すとより一貫する
  - ブランチは未コミットのため「1変更 = 1コミット」の粒度確認は未実施。
    コミット時は少なくとも実装（コード＋基本テスト）・tester のテスト強化・
    docs 更新を関心事ごとに分けること（再レビュー時に確認する）

### 2026-07-07 Issue #164 差し戻し対応（fetchTokenBalance のエラー握りつぶし修正）

- 担当: collector
- ブランチ: issue-164-token-balance-polling
- 内容: レビュー差し戻し指摘（上記1件）に対応した。
  - まず `wallet-tracker.test.ts` に、全ての Execution RPC URL で
    `balanceOf` が revert 相当のエラーを投げるケースの回帰テストを追加し、
    修正前の状態で実際に失敗する（`console.error` の第1引数が固定文言
    `"...: all execution RPC endpoints unreachable"` になり、実際の
    エラー内容が渡っていない）ことを確認してから修正した。
  - `packages/collector/src/adapters/ethereum/wallet-tracker.ts`
    (`fetchTokenBalance`): URL ごとの `catch` で捕捉したエラーを
    `lastError` 変数に保持するよう変更した。全滅時のログは、他の箇所
    （`index.ts` の `console.error(\`[ethereum] failed to fetch pending tx
    ${hash}:\`, err)` 等）と同じ「`メッセージ:`, err」の形式に揃え、
    `console.error("[ethereum] token balance poll failed for token ... /
    wallet ...:", lastError)` とした。文言からも「all execution RPC
    endpoints unreachable」という到達不能を断定する固定文言を削除した
    （実際には balanceOf の revert・viem のデコード失敗・HTTP エラーの
    可能性もあるため、原因を特定しない中立な見出しのみにし、実際の理由は
    `lastError` の内容そのものに語らせる）。
  - 上記の回帰テストが修正後に成功することを確認した
    （`console.error` の第1引数が固定文言を含まず、第2引数に実際の
    エラーオブジェクトが渡っていることを検証）。
  - `urls` が最初から空（Execution ノードが観測に無い）の場合、ループが
    一度も実行されず `lastError` は `undefined` のままログされる。この
    挙動は差し戻し前の実装でも同様（無条件で `console.error` を呼んで
    いた）であり、今回の修正はメッセージの中身の改善に留め、この
    エッジケースの挙動自体は変更していない（差し戻し指摘の範囲外のため）。
- `pnpm lint`・`pnpm --filter @chainviz/collector build`・
  `pnpm --filter @chainviz/collector test`（944件、うち今回追加1件）が
  いずれも成功することを確認した。

### 2026-07-07 Issue #164 レビュー（2回目・合格）

- 担当: reviewer
- ブランチ: issue-164-token-balance-polling
- 内容: 差し戻し指摘（`fetchTokenBalance` のエラー握りつぶし）への対応の
  再レビュー。`git diff main` の全体確認と `pnpm lint` / `pnpm build` /
  `pnpm test` の実行。
- 確認結果（すべて問題なし）:
  - 差し戻し指摘の解消: `wallet-tracker.ts` の `fetchTokenBalance` が URL
    ごとの `catch` で捕捉したエラーを `lastError` に保持し、全滅時に
    `console.error("[ethereum] token balance poll failed for token ... /
    wallet ...:", lastError)` として実際のエラーオブジェクトをログする形に
    修正された。到達不能を断定する固定文言「all execution RPC endpoints
    unreachable」は削除され、原因を特定しない中立な見出し＋実エラーの構成に
    なっている。コメントにも「失敗理由は URL への到達不能とは限らない」と
    修正意図が明記されている
  - 回帰テスト: `wallet-tracker.test.ts` の「logs the actual last error
    (not a fixed 'unreachable' message) ...」が、revert 相当のエラーで全滅
    したとき `console.error` の第2引数に実エラーが渡ること・第1引数に
    "unreachable" を含まないことの両方を検証しており、元の不具合（固定文言
    へのすり替え）を実際に検出できる内容になっている
  - ログ形式の一貫性: 既存の `[ethereum] wallet poll failed:`（同ファイル）、
    `[ethereum] failed to fetch pending tx ${hash}:`（index.ts）等と同じ
    「`[ethereum] <メッセージ>:`, err」形式で一貫している
  - `pnpm lint` / `pnpm build` / `pnpm test` がリポジトリ全体で成功
    （shared 40 / collector 944 / frontend 791 / e2e 34 件）。テスト実行時の
    実ログにも修正後の形式で実エラーが出力されることを確認した
- 前回の軽微な推奨（`diff.ts` コメント内の「balanceOf」）の最終判断:
  **対応不要**とする。理由:
  - CLAUDE.md「ChainAdapter 境界」が禁じるのは、ワールドステートの
    スキーマ（`packages/shared` の型）とフロントのコードへのチェーン固有
    語彙の漏出。`TokenBalance` 型（contractAddress / amount）と frontend
    には漏出が無いことを grep で確認済み
  - 該当箇所は collector 内部の共通層（`world-state/diff.ts`）のドキュメント
    コメントであり、値の出所（wallet-tracker / erc20.ts）を保守者に示す
    説明として機能している。コード・型の語彙自体はチェーン非依存
  - ただし将来、別チェーンのアダプタが `WalletObservation` を生成するように
    なった時点で、このコメントは「残高照会」等の中立表現へ直すのが望ましい
    （その際の修正で十分であり、今回の差し戻し理由にはしない）
- 補足（統括への申し送り）:
  - ブランチは依然として未コミット。コミット時は前回指摘のとおり、実装
    （コード＋基本テスト）・tester のテスト強化・差し戻し対応・docs 更新を
    関心事ごとに分けること（1変更 = 1コミット）
  - `urls` が空（Execution ノードが観測に無い）の場合に `lastError` が
    `undefined` のままログされる挙動は差し戻し前から同じであり、トークン
    追跡中に実行ノードが1つも無いという異常状態の通知として許容範囲と判断

### 2026-07-07 Issue #164 QA検証（合格）

- 担当: qa
- ブランチ: issue-164-token-balance-polling
- 目的: 完了条件3点を実物で検証する。
  1. 追跡中トークンコントラクトのデプロイ後、各ウォレット残高が
     `WalletEntity.tokenBalances` にポーリング反映される
  2. transfer 実行後、送金元・送金先両方の tokenBalances が正しく更新される
  3. 追跡中トークンが存在しない間は余分な RPC 呼び出しが発生せず、既存の
     ETH 残高・nonce ポーリングに影響しない
- 制約と検証方針: collector の composeProject が "chainviz-ethereum" に
  ハードコードされており（PLAN.md バックログ・Issue #161/#162 QA と同じ制約）、
  GUI 経由の runWorkbenchOperation を独立環境で回すのは困難。今回は
  collector 側のトークン残高ロジックが本物の EVM・本物のカタログ ERC20 に
  対して正しく動くことを、ビルド済み dist モジュールを直接使って検証する
  方針を採った（Issue #162 QA と同じ手法）。
- 静的確認: `pnpm lint` / `pnpm build` / `pnpm test` をブランチ上で実行し
  全成功（shared 40・collector 944・frontend 791・e2e 34）。
- 実物検証（独立環境）:
  - `ghcr.io/foundry-rs/foundry:latest` の anvil を起動し（mnemonic は
    標準の "test test ... junk"）、実際のカタログソース
    `profiles/ethereum/contracts/src/ChainvizToken.sol` を `forge create` で
    デプロイ（初期供給 1,000,000 CVZ をデプロイヤー account0 が保有）。
  - ビルド済み `dist/adapters/ethereum/erc20.js` の `fetchErc20Balance`
    （実 viem の erc20Abi でエンコード/デコード）を anvil の実 RPC に対して
    実行し、初期残高 acc0=1,000,000 CVZ / acc1=0 を正しく読めることを確認。
  - `cast send transfer(address,uint256)` で 250 CVZ を acc0→acc1 送金後、
    同じ `fetchErc20Balance` で再取得し、acc0=999,750 CVZ・acc1=250 CVZ と
    送金元・送金先の双方が正しく更新されることを確認（完了条件1・2）。
    チェックサム表記アドレスのデコードも問題なし。
  - ビルド済み `dist/adapters/ethereum/wallet-tracker.js` の `WalletTracker`
    を、reth ノード1 + foundry ワークベンチ1 を返す偽 poller と、メソッド
    呼び出しを計数しつつ anvil へ転送する rpc で実行:
    - `getTokenContractAddresses() => []`（トークン0件）のとき `eth_call`
      が0回、ETH 残高・nonce は取得済み（tokenBalances は付かない）→
      完了条件3を満たす（余分な RPC 無し・既存ポーリング非影響）。
    - `getTokenContractAddresses() => [token]`（1件）のとき `eth_call` が
      1回発生し、`tokenBalances` に `{contractAddress, amount:"999750...e18"}`
      が反映される。ワークベンチ検知・ウォレット導出（index0→account0）・
      executionRpcUrls・ゲーティング・fetchErc20Balance の一連が実物で通ることを確認。
- 判定: 完了条件3点をすべて満たす。**合格**。
- 検証後、起動した anvil コンテナは削除済み（環境をクリーンに戻した）。
