# Issue #315 ERC-721(NFT)の所有関係を可視化する

### 2026-07-17 Issue #315 設計メモ(designer)

- 担当: designer
- ブランチ: issue-315-erc721-ownership
- 内容: ERC-721(NFT)の「誰がどの tokenId を持っているか」を可視化するための
  設計。`packages/shared` の型定義(`NftToken` / `ContractEntity.nft` /
  `ContractEntity.nftTokens`)を先行実装し、`docs/ARCHITECTURE.md` に §13
  (設計本文)・§2(スキーマ)・§4(カタログ)を反映した。実装ロジック
  (collector のポーリング・frontend の表示・サンプルコントラクト本体)は
  未着手で、下記の分担で実装担当に引き継ぐ。

## 設計の要点

### データモデル: 台帳はコントラクト側に持つ(ウォレット側ではない)

- `ContractEntity.nft?: { symbol: string }` — NFT コントラクトの表示メタ情報。
  `token`(数量ベース。decimals を持つ)とは別軸のフィールドとして新設した。
  ERC-20 の残高(数量)と NFT の所有(個体)を型のレベルで混ぜないため
- `ContractEntity.nftTokens?: NftToken[]` — 発行済み NFT の所有台帳
  (`{ tokenId: string, ownerAddress: string }` の配列、tokenId 昇順)。
  省略 = 未観測、空配列 = 観測できたが未発行(tokenBalances と同じ区別)
- ウォレット側に「保有 tokenId 一覧」フィールドは**持たせない**。理由:
  1. 所有台帳は実体としてコントラクトの内部状態であり、モデルを実体に
     合わせる方が「NFT の台帳はコントラクトが管理する」という学習ポイント
     そのものになる(既存の `token` = 「コントラクトが管理する残高台帳」と
     同じ整理)
  2. ウォレット単位の保有一覧は台帳から純関数で導出できる(逆は、追跡外
     アドレスが持つトークンが失われるため導出できない。mint 先が追跡外
     アドレスでも台帳側は完全な情報を保つ)
  3. 観測(ownerOf の列挙)がコントラクト単位なので、観測の形とスキーマの
     形が一致し、ウォレット数に依存しない
- `WalletEntity` は変更なし。`tokenBalances`(Issue #168)もそのまま
- DiffEvent・WebSocket プロトコルの変更なし(`entityUpdated` の patch に
  `nftTokens` が乗るだけ。store の `applyContract` → `computeDiff` は
  JSON ベースの深い比較なので、台帳が変わらなければイベントは出ない
  ことを確認済み)

### collector 側の観測: Transfer イベントの畳み込みではなく ownerOf ポーリング

- 追跡中かつ `nft` メタを持つコントラクトに対し `totalSupply()` →
  `ownerOf(1..totalSupply)` を `eth_call` で照会(3 秒周期。NFT コントラクト
  が無ければ何もしない)。ウォレット残高・トークン残高(`wallet-tracker.ts` /
  `erc20.ts`)と同じ「チェーンに直接問い合わせる」流儀
- イベント畳み込み(Transfer を購読して台帳を組み立てる)を不採用にした
  理由: collector の再起動・取りこぼしで台帳が静かに狂い自己修復できない。
  ポーリングはステートレスで毎回実状態と一致する
- Transfer イベントの表示自体は既存機構で足りる: `decode.ts` は ABI 汎用で、
  カタログに ChainvizNFT の ABI が載れば indexed tokenId を含む Transfer が
  そのまま復号され、コントラクトカードの「直近の呼び出し・イベント」に出る
  (Issue #162 の仕組みに追加実装は不要。ERC-20 と ERC-721 の Transfer は
  topic0 が同一だが、復号はコントラクト単位のカタログ ABI で行うため
  取り違えは起きない)
- `ownerAddress` は小文字へ正規化(`normalizeAddress` を再利用)。
  `WalletEntity.address` は EIP-55 表記になりうるため、フロントは
  `addressCasing` ヘルパーで大文字小文字無視の照合を行う(Issue #201/#232 の
  教訓を型コメントにも明記した)

### サンプルコントラクト: ChainvizNFT は「学習用サブセット」で EIP-721 完全準拠にしない

- 持つもの: name/symbol 定数、totalSupply、balanceOf/ownerOf/getApproved、
  approve/transferFrom、mint(address to)(onlyOwner、tokenId は 1 始まりの
  連番自動採番)、Transfer/Approval イベント(ERC-721 標準シグネチャ。
  tokenId は indexed)
- 持たないもの: safeTransferFrom、setApprovalForAll/isApprovedForAll、
  ERC-165、tokenURI、burn。「誰がどの tokenId を持つか」という主題から
  外れる概念(受信フック・オペレータ承認・インターフェース検出・オフチェーン
  メタデータ)を持ち込まないため。実物の ERC-721 との差分はソースコメントと
  用語解説で明示する
- **前提条件(重要)**: burn なし + 連番採番により「発行済み tokenId =
  1〜totalSupply」が常に成立する。collector のポーリングはこの前提に依存する
  (ERC721Enumerable を実装せずに全 tokenId を列挙できる)。ソース・
  collector 実装の両方にコメントで明記すること
- RPC 回数は「NFT コントラクト数 × (1 + 発行済み個数)」/ 周期。学習用
  ローカル環境で発行数は高々数十個という前提を置き、固定上限は設けない
  (CLAUDE.md「固定値の前提条件を明記する」ルールに基づき、前提をコード
  コメントと本ファイルに残す)

### フロント表現: エッジは張らない。カード 2 視点 + 既存機構

- NFT コントラクトカード: サブタイトルに symbol、「発行済み NFT」セクションに
  tokenId チップ(#1 等) + 所有者の短縮表記。空配列は「まだ発行されて
  いません」、省略はセクションを出さない
- ウォレットカード: トークン残高の下に「保有 NFT」セクション。「CVN #1」形式の
  チップ。導出は全コントラクトの nftTokens から ownerAddress 照合(純関数)
- 新しいエッジ(NFT コントラクト → 所有ウォレット等)は**張らない**。既存の
  視覚語彙「エッジ = 実在の接続・呼び出し・秘密鍵の所有」を守り、所有エッジ
  (ownershipEdge = ワークベンチがウォレットの秘密鍵を持つ関係)との混同を
  避けるため(§6.10 決定 1 と同じ判断)
- 定型操作はプロトコル変更なし。`operationCatalog.ts` に ChainvizNFT の
  エントリを足すだけ(mint(address) / approve(address,uint256) /
  transferFrom(address,address,uint256)。コンストラクタ引数なし)

### 用語解説

- `glossary/ethereum/terms/c-transaction.yaml` に `nft` を追加(定義内で
  ERC-721 に言及。「ERC-20 との違い = 数量ではなく個体」を必ず含める)。
  アンカーは「保有 NFT」「発行済み NFT」ラベル。`token` の relatedTerms に
  `nft` を追加

## 評価方法の注記

現状 UI の実機評価は、frontend をモックモード(vite dev server)で起動した
うえで Playwright によるスクリーンショット確認を試みたが、この設計作業の
worktree 環境ではブラウザ起動に必要なシステムライブラリ(libnspr4.so)が
無く実行できなかった。代替として、モックデータ(`mockData.ts`)・
`WalletCard.tsx` / `ContractCard.tsx` / `ownershipEdge.ts` の実装・既存 UX
設計(ARCHITECTURE.md §6.7)の読解で現状のトークン残高表示・所有エッジの
見せ方を確認した。実画面での確認は実装後の QA(chainviz-qa)で行われる。

## この設計フェーズで実施済みのもの

- `packages/shared/src/world-state/entities.ts`: `NftToken` 新設、
  `ContractEntity.nft` / `ContractEntity.nftTokens` 追加(doc コメント込み)
- `packages/shared/src/world-state/entities.nftOwnership.test.ts`: 新規
  (JSON 往復・空配列と省略の区別・旧スナップショット互換・照合の表記揺れ)
- `docs/ARCHITECTURE.md`: §2(スキーマ + ER 図)・§4(カタログ)・§13(新設)
- `pnpm build` / `pnpm test` / `pnpm lint` 全パッケージ通過を確認済み
  (collector/frontend のビルドは壊れていない。optional フィールドの追加
  のみなので既存コードへの影響なし)

## 実装分担(引き継ぎ)

依存順序: **node-env が先**(catalog.json の ABI・関数シグネチャが確定して
から collector / frontend が着手)。collector と frontend は相互に依存しない
ので並行可。

1. **node-env**: `profiles/ethereum/contracts/src/ChainvizNFT.sol`(上記
   サブセット)、`build-catalog.sh` に nft メタ情報付きエントリ追加
   (`add_entry` の第 2 引数が token 専用なので、nft 用の受け渡しに拡張する)、
   `catalog.json` 再生成。コンストラクタ引数なし
2. **collector**: `catalog.ts`(`nft` フィールドの検証・`CatalogEntry.nft`)、
   `contracts.ts`(`applyCatalog` で nft 転記、`nftContractAddresses()`、
   台帳マージ用メソッド)、`erc721.ts` 新規(`totalSupply`/`ownerOf` の
   eth_call。viem の ABI 定義はこのファイルに閉じる)、NFT 所有トラッカー
   新規(`wallet-tracker.ts` と同型の 3 秒ポーリング。1 ファイル 1 責務で
   wallet-tracker には足さない)、`index.ts` での配線(既存の
   `trackedTokenContractAddresses` の配線と同型)。取得失敗時は前回値を
   維持(更新をスキップ)し、実際のエラー内容をログに残す
3. **frontend**: 導出純関数 2 本(`contractNftLedger.ts` /
   `walletNftHoldings.ts` 相当。命名は実装担当に委ねる)、ContractCard /
   ContractPopover の「発行済み NFT」、WalletCard / WalletPopover の
   「保有 NFT」、`operationCatalog.ts` の ChainvizNFT エントリ、i18n 文言、
   モックデータ(`mockData.ts`)への NFT コントラクト追加、glossary の
   `nft` 用語(en 訳は chainviz-i18n がレビュー)

## node-env 実装(2026-07-17)

- 担当: node-env
- 実施内容:
  - `profiles/ethereum/contracts/src/ChainvizNFT.sol` を新規追加。設計メモ
    どおりの学習用サブセット(name/symbol 定数、totalSupply、balanceOf/
    ownerOf/getApproved、approve/transferFrom、mint(address)、Transfer/
    Approval イベント)。safeTransferFrom/setApprovalForAll/ERC-165/
    tokenURI/burn は実装していない。burn なし+1 始まり連番採番により
    「発行済み tokenId = 1〜totalSupply」が常に成立する不変条件を
    コントラクト先頭のコメントと mint() 直上のコメントの両方に明記した
    (collector 側のポーリング実装が依存する前提のため)
  - `build-catalog.sh` の `add_entry()` に第 3 引数(`nft_json`)を追加し、
    渡された場合はエントリに `nft: { symbol }` を足すよう拡張。第 2 引数
    (`token_json`)とは独立して扱い、既存の呼び出し(ChainvizToken/Counter)
    は空文字列を追加で渡すよう更新した(後方非互換の呼び出し形式変更だが
    このスクリプト内で閉じているため影響なし)
  - `catalog.json` に `ChainvizNFT` エントリ(`nft: { symbol: "CVN" }`)を
    追加。`token` フィールドは持たせていない(§13.1 の「排他」方針どおり)
- 動作確認:
  - ローカルに `forge` が無かったため `build-catalog.sh` のフォールバック
    経路(`docker run ghcr.io/foundry-rs/foundry:latest forge build`)で
    3 コントラクト(ChainvizToken/Counter/ChainvizNFT)のコンパイルが
    成功することを確認
  - `jq` もローカルに無く、かつ非対話 sudo が使えない worktree 環境だった
    ため、`docker run imega/jq` を呼ぶラッパースクリプトを一時的に PATH に
    追加し(`TMPDIR` もコンテナにマウントされる作業ディレクトリ配下に
    切り替えて)`build-catalog.sh` を最後まで実行できることを確認した。
    このラッパー自体はスクラッチパス上の一時ファイルでリポジトリには
    含まれない
  - 生成された `catalog.json` の差分を確認し、既存の ChainvizToken/Counter
    エントリが変化していないこと(純粋な追加のみ)、ChainvizNFT の ABI に
    `mint(address)` / `approve(address,uint256)` /
    `transferFrom(address,address,uint256)` が設計メモどおりのシグネチャで
    含まれること、`nft.symbol` が `"CVN"` になっていることを確認した
- 次の担当への申し送り:
  - `catalog.json` の ChainvizNFT エントリ・ABI は確定済み。collector 側
    (`catalog.ts` の `nft` フィールド検証、`erc721.ts` の
    totalSupply/ownerOf 呼び出し)・frontend 側
    (`operationCatalog.ts` への mint/approve/transferFrom 追加)はこの
    ABI・関数シグネチャに合わせて実装できる
  - `docs/PLAN.md` の #315 チェックボックスは、collector/frontend 実装が
    完了してから(担当をまたぐ1つの Issue のため)まとめてチェックする。
    node-env 単独では未完了のまま残している

## 実装時に判断してよいこと(未確定のまま渡す点)

- カード上の tokenId チップの表示上限(ウォレットの tx チップは 6 件上限の
  前例あり。超過分をポップオーバーで見せる等は frontend の判断)
- 定型操作フォームで tokenId 入力に既存 tokenId の候補を提示するか
  (最初はプレーンな uint 入力でよい)
- `erc721.ts` で viem の `erc721Abi` を使うか最小 ABI をインラインで持つか
  (totalSupply が viem の erc721Abi に含まれるかは実装時に確認)
- ChainvizNFT の mint に 1 tx で複数個 mint する補助(バッチ)を付けるか
  (最小実装では不要)

## collector 実装(2026-07-17)

- 担当: collector

### 設計メモ(着手前)

- ファイル構成: 既存の ERC-20/ウォレット残高ポーリングの3ファイル構成
  (`erc20.ts` = ABI エンコード/デコード、`wallet-tracker.ts` = 3秒周期
  ポーリング、`contracts.ts`/`index.ts` = 状態への反映)にならい、NFT側は
  `erc721.ts`(ABI エンコード/デコード)・`nft-tracker.ts`(3秒周期
  ポーリング、新規)の2ファイルに分離する。`wallet-tracker.ts` には追加しない
  (1ファイル1責務。台帳の単位がウォレットではなくコントラクトのため型も
  責務も別)
- `erc721.ts`: `totalSupply()` は ERC-721 コア標準ではなく
  ERC721Enumerable 拡張のため viem の `erc721Abi` に含まれないことを実装前に
  確認した。`ownerOf` は標準に含まれるが、2関数の取得元を viem標準/自前
  定義に分けると読みにくいため、両方を含む最小 ABI をこのファイル内に
  自己完結させる方針にした(設計メモの未確定事項3の実装時判断)
- `fetchErc721Ledger` は「totalSupply + 全 tokenId の ownerOf が揃って初めて
  成功」という全成功・全失敗の二値契約にする(部分成功の台帳を返さない)。
  理由: ステートレス方式の前提上、1回のポーリングで台帳全体を洗い替える
  設計なので、部分的にしか取得できなかった場合に「未観測」なのか「本当に
  所有者が変わった」のか区別がつかなくなる。これにより
  `ContractTracker.applyNftObservation` はtokenId単位のマージを行わず、
  観測結果で `nftTokens` を丸ごと置き換えるだけの単純な実装にできる
  (`tokenBalances` のようなコントラクト単位のマージは不要。あちらは
  「トークンコントラクトごとに個別のポーリング呼び出し」なので部分失敗を
  許容する設計だが、NFTは「1コントラクトの台帳をまとめて1回で取得」と
  いう単位が違うため、同じマージパターンを流用しない判断)
- `ContractTracker` に `nftContractAddresses()`(`tokenContractAddresses()`
  と同型)、`applyNftObservation(address, tokens)`(`registerDeployment`と
  同じく更新後のエンティティ or null を返す)を追加。`applyCatalog` に
  `nft` の転記を追加(`token` と同じパターン)
- `EthereumAdapter` に `trackedNftContractAddresses()` /
  `applyNftObservation()` を追加。後者は内部で保持している `onContract`
  コールバック(`subscribeContracts` で登録済み)を再利用する
  `registerContractDeployment` と同じ経路にする。これにより `index.ts`
  (collector本体)側は新しい `store.applyContract`/`broadcastDiff` の配線を
  増やす必要がなく、`NftTracker` の購読コールバックは
  `adapter.applyNftObservation(...)` を呼ぶだけで済む
- `catalog.ts` の `CatalogEntry.nft` は `token` と同じく形を検証しない
  (既存の「token は未検証で通す」方針を踏襲。将来的に検証を入れる場合は
  token/nft 両方まとめて見直す)

### 実施内容

- `packages/collector/src/adapters/ethereum/catalog.ts`: `CatalogEntry.nft?:
  { symbol: string }` を追加
- `packages/collector/src/adapters/ethereum/contracts.ts`: `applyCatalog` が
  `nft` を転記するよう変更、`nftContractAddresses()` /
  `applyNftObservation()` を追加
- `packages/collector/src/adapters/ethereum/erc721.ts`(新規):
  `fetchErc721Ledger(rpc, url, contractAddress)` — totalSupply +
  1〜totalSupply の ownerOf を eth_call で取得し `NftToken[]` を返す
- `packages/collector/src/adapters/ethereum/nft-tracker.ts`(新規):
  `NftTracker` クラス — `wallet-tracker.ts` と同型の3秒周期ポーリング。
  追跡中の NFT コントラクトが1つも無ければ Docker 観測自体を省略する
- `packages/collector/src/adapters/ethereum/index.ts`
  (`EthereumAdapter`): `trackedNftContractAddresses()` /
  `applyNftObservation()` を追加
- `packages/collector/src/index.ts`: `NftTracker` を配線
  (`walletTracker.subscribe` の直後)。購読コールバックは各観測結果を
  `adapter.applyNftObservation(address, tokens)` に渡すだけ
- テスト(すべて新規): `erc721.test.ts`、`nft-tracker.test.ts`、
  `contracts.nft.test.ts`(既存 `contracts.test.ts` の肥大化を避けて分離、
  `contracts.source-code.test.ts` と同じ方針)、
  `nft-observation-wiring.test.ts`(`EthereumAdapter` レベルの配線確認、
  `contract-deploy-wiring.test.ts` と同じ構図)。加えて `catalog.test.ts`
  に `nft` フィールドの読み込み・素通し検証を2件追加
- `pnpm --filter @chainviz/collector build` / `pnpm --filter @chainviz/collector
  test`(69ファイル・1519テスト全通過)を確認済み

### 次の担当への申し送り

- frontend側は `ContractEntity.nft` / `nftTokens` を購読すればよい状態に
  なっている。`WalletEntity` 側の変更は無い(設計どおり、保有NFTはフロント側で
  `nftTokens` から導出する)
- `docs/PLAN.md` の #315 チェックボックスは、frontend側の実装も完了してから
  まとめてチェックする(node-envの申し送りと同じ理由)

## frontend実装(2026-07-17)

- 担当: frontend
- ブランチ: `issue-315-erc721-ownership-frontend`（node-env/collector 側は
  別ブランチ `issue-315-erc721-ownership` で並行実装中のため、`packages/shared`
  の型変更コミット・設計docsコミット・node-env のコミット（サンプル
  コントラクト・catalog.json）を cherry-pick してこのブランチへ取り込んだ
  上で着手した。catalog.json を取り込んだのは、`operationCatalog.test.ts`
  が実カタログの ABI とフロント表現セットの突き合わせを行うため）

### 設計メモ(実装前の方針)

- 導出関数は2本、方向を分けて実装する:
  - `entities/walletNftHoldings.ts`
    (`resolveWalletNftHoldings(walletAddress, contracts: Iterable<ContractEntity>)`):
    ウォレット起点。全コントラクトの `nftTokens` を `ownerAddress` の大文字
    小文字無視の照合で集約する。複数コントラクトを横断して集約するため、
    `contractAddress` → `tokenId`(数値)の順で明示的にソートし、
    `contractsByAddress` の走査順序に依存しない決定的な表示順にする
    (`resolveWalletTokenBalances` は単一ウォレットの配列の入力順をそのまま
    保つだけで足りるが、こちらは複数コントラクトの集約なので追加のソートが
    要る違いがある)
  - `entities/contractNftLedger.ts`
    (`resolveContractNftLedger(nftTokens, walletAddresses: Iterable<string>)`):
    コントラクト起点。`nftTokens` の入力順(collector 側で tokenId 昇順が
    保証される)をそのまま使う。所有者ラベルの解決は既存の
    `addressCasing.buildLowerCaseIndex` を再利用する(Issue #201/#232 で
    確立済みの、大文字小文字表記ゆれの照合ヘルパー)
- カード/ポップオーバーへの配線は既存の2つの索引の対称性をそのまま使う:
  ウォレット側は既存の `WalletNodeData.contractsByAddress`
  (`Map<string, ContractEntity>`)をそのまま流用でき、新しいフィールド追加は
  不要。コントラクト側は「対応するウォレットの表記」を引く索引が無かった
  ため、`ContractNodeData`/`ContractNodeContext` に `walletAddresses:
  ReadonlySet<string>` を新設し、`WalletNodeData.contractsByAddress`
  (逆方向の索引)と対にした。`isNew`/`flashKind` と同じく optional にして
  おき(`contractsToFlowNodes` は常に値を入れるが、この型のノードデータを
  直接組み立てている既存の他ファイル・テストまで書き換えずに済むように
  する)、消費側の `ContractCard`/`ContractPopover` で未指定時は空集合に
  フォールバックする
- 表示の空/未観測の区別(「まだ発行されていません」 vs セクション自体を
  出さない)は、解決後の配列の長さではなく元の `entity.nftTokens !==
  undefined` で判定する(`resolveContractNftLedger` 自体は空配列と未定義を
  区別しない仕様のため、呼び出し側でこの判定を持つ)
- `operationCatalog.ts` の tokenId 引数には `unit: "token"` を絶対に付けない
  よう明示的に注意する(付けると `OperationArgInput` が decimals 換算を
  行ってしまい、tokenId という整数の個体識別子が壊れる。ERC-20 の
  `approve`/`transferFrom` と関数シグネチャが同型なだけに、既存のコピペで
  混入しやすい罠として設計メモに残す)

### 実装内容

- `entities/walletNftHoldings.ts` / `entities/contractNftLedger.ts`: 上記の
  導出純関数2本。`formatNftChipLabel`(「CVN #1」形式)も
  `walletNftHoldings.ts` に置いた
- `entities/WalletCard.tsx` / `entities/WalletPopover.tsx`: トークン残高の下に
  「保有 NFT」節を追加(カードはチップ列、ポップオーバーは
  コントラクト名+短縮アドレス/「SYMBOL #tokenId」の一覧)。1件も無ければ
  セクション自体を出さない(トークン残高と同じ流儀)
- `entities/ContractCard.tsx` / `entities/ContractPopover.tsx`: 活動チップ列/
  トークンフィールドの下に「発行済み NFT」節を追加。tokenId チップ(または
  一覧行)に所有者の短縮アドレスを添える
- `entities/contractNode.ts`: `ContractNodeData`/`ContractNodeContext` に
  `walletAddresses` を追加、`isSameContractNode` の比較にも追加(参照比較。
  `WalletNodeData.contractsByAddress` と同じ流儀)
- `app/App.tsx`: `wallets` から `walletAddresses`(`Set<string>`)を
  `useMemo` で導出し、`contractsToFlowNodes` の呼び出しに渡すよう配線
- `chain-profiles/ethereum/operationCatalog.ts`: `ChainvizNFT` エントリを
  追加(`mint(address)` / `approve(address,uint256)` /
  `transferFrom(address,address,uint256)`)。`token` メタ情報は持たせず、
  tokenId 引数に `unit: "token"` を付けない設計メモどおりに実装した
- `i18n/messages.ts`: `field.nftHoldings`(保有 NFT) /
  `contract.issuedNft`(発行済み NFT) / `contract.noNft`(まだ発行されて
  いません)の3キーを追加
- `glossary/ethereum/terms/c-transaction.yaml`: `nft` エントリを追加
  (定義内で ERC-721 に言及し「ERC-20 との違い = 数量ではなく個体」を含む)。
  既存の `token` の `relatedTerms` に `nft` を追加
- `websocket/mockData.ts`: `chainvizNftContract()`(catalogKey
  `"ChainvizNFT"`、`nft.symbol: "CVN"`)を追加し、tokenId 1→Alice、
  2→Bob、3→追跡外アドレス(`NFT_UNTRACKED_OWNER`)の3件の台帳を持たせた
  (対応するウォレットが見つかる通常ケースと、見つからず台帳の生の表記に
  フォールバックするケースの両方をオフラインで確認できるようにするため)。
  `MOCK_DEPLOYABLE_CATALOG`・`deployedContractCatalogKeys` にも
  `ChainvizNFT` を追加し、モックの deploy/callContract シミュレーションが
  ChainvizNFT に対しても機能するようにした
- `styles.css`: 上記セクション用のクラス(`.wallet-card__nft*` /
  `.contract-card__nft*` / `.wallet-popover__nft*` /
  `.contract-popover__nft*`)を、既存のトークン残高/活動チップ列と同じ
  見た目で追加

### テスト

- `walletNftHoldings.test.ts` / `contractNftLedger.test.ts`: 導出純関数の
  単体テスト(空配列、ownerAddress の大文字小文字無視の照合、複数
  コントラクトの集約順序、tokenId の数値ソートなど)
- `WalletCard.nftHoldings.test.tsx` / `WalletPopover.nftHoldings.test.tsx` /
  `ContractCard.nftLedger.test.tsx` / `ContractPopover.nftLedger.test.tsx`:
  各カード/ポップオーバーでのセクション表示・非表示・チップ内容の統合テスト
  (既存の `WalletCard.test.tsx`/`ContractCard.test.tsx` 等を肥大化させない
  よう、CLAUDE.md の方針どおり関心事ごとに新規ファイルへ分離した)
- `contractNode.walletAddresses.test.ts`: `walletAddresses` の配線
  (`contractsToFlowNodes` のデフォルト値・全ノードへの伝播)と
  `isSameContractNode` の参照比較を確認する新規ファイル
- `operationCatalog.test.ts`: `ChainvizNFT` 追加に伴い、既存の
  `catalogKey` 完全一致テストを更新。加えて constructorArgs 空・token
  メタ情報なし・tokenId 引数に `unit: "token"` が付かないこと・
  `mint`/`approve`/`transferFrom` の3関数がちょうど揃っていることを
  確認する新規テストを追加

### 実装中に踏んだ落とし穴(申し送り)

- `ContractNodeData.walletAddresses` を必須フィールドにすると、この型の
  ノードデータを直接組み立てている既存の複数ファイル
  (`canvasLayers.test.ts`/`chainRibbonCrossHighlight.test.tsx`/
  `canvasNode.test.ts`/`popoverPortalConsistency.test.tsx` 等、NFT機能とは
  無関係な既存テスト)がコンパイルエラーになった。`isNew`/`flashKind` と
  同じく optional にし、消費側でフォールバックする方針に変えて解決した
- `isSameContractNode` に `walletAddresses` の参照比較を追加した結果、
  `contractNode.test.ts` の「デフォルト値のまま2回呼んでも変化なし」という
  既存テストが、`contractsToFlowNodes` 内部のデフォルト値生成
  (`ctx.walletAddresses ?? new Set()`)が呼び出しごとに新しい `Set` を
  作ってしまうため落ちた。`walletNode.test.ts` の `EMPTY_CONTRACTS`
  (`contractsByAddress` 用の安定した既定値)と同じ前例があったため、
  `contractNode.test.ts` の `ctx()` にも `EMPTY_WALLET_ADDRESSES`
  (モジュールレベルの安定した空 `Set`)を既定値として持たせて解決した。
  本番コード側(`contractsToFlowNodes`)はこれまでどおり呼び出しごとに
  新しい `Set` を作るデフォルト実装のままにしている(実際の呼び出し元
  `App.tsx` は常に `useMemo` で安定させた値を渡すため無害)
- `shortHex` は `0x` + 先頭 **6文字** + `…` + 末尾4文字を返す
  (`hex.slice(0, 2 + lead)`)。テスト記述時に `address.slice(0, 6)` と
  誤って書いて2文字分ズレる失敗を最初に踏んだ(既存テストの
  `address.slice(0, 8)` を見て気づいた)

### 確認結果

- `pnpm --filter @chainviz/frontend build` / `pnpm --filter @chainviz/frontend
  test`(168 test files / 2357 tests)通過
- `eslint`(変更ファイルのみ個別実行)で警告・エラーなし
- `vite build` の成果物 + `vite preview` を起動し、`curl` でバンドルJSに
  `ChainvizNFT` が含まれることを確認(この worktree 環境には Playwright
  のブラウザ起動に必要なシステムライブラリが無く、実画面のスクリーン
  ショット確認はできなかった。設計フェーズの `docs/worklog/issue-315.md`
  「評価方法の注記」と同じ制約。実画面の確認は QA(chainviz-qa)に委ねる)

### 次の担当への申し送り

- `docs/PLAN.md` の #315 チェックボックスは、collector 側実装が別ブランチ
  (`issue-315-erc721-ownership`)でまだ進行中のため、このブランチ単独では
  更新していない(node-env・collector・frontend が揃った時点で担当をまたぐ
  1つの Issue としてまとめてチェックする)
- collector 側が合流すると `ContractEntity.nftTokens` に実データが載る。
  フロント側は台帳の `tokenId` 昇順を前提にしている(`resolveContractNftLedger`
  はソートせず入力順をそのまま使う)ため、collector 側がこの前提を崩さない
  ことを QA で確認してほしい

## テスト強化(2026-07-17)

- 担当: tester
- ブランチ: `issue-315-erc721-ownership-frontend`(node-env/collector を
  cherry-pick で合流済みの本ブランチ上で実施)
- 目的: 実装担当が書いた基本テスト(ハッピーパス中心)に対し、境界値・
  異常系の観点を追加する。実装ロジックは変更していない。追加テストはすべて
  関心事が既存テストファイルと同一のため、新規ファイルを作らず該当ファイルへ
  追記した(1ファイル1責務の範囲内)。

### 追加したテスト

- `packages/collector/src/adapters/ethereum/erc721.test.ts`(2件追加):
  - `ownerOf` を tokenId 1〜totalSupply の範囲でちょうど問い合わせること
    (0 や totalSupply+1 を問い合わせないこと)の回帰ガード。「burn なし +
    1 始まりの連番採番」という ChainvizNFT の不変条件に collector が依存する
    ため、`i + 1` のオフバイワンや列挙範囲の取り違えを検出する。
  - `ownerOf` が Promise.all で並行実行され解決順が昇順と逆になっても、
    返り値の並びが tokenId 昇順に固定されること(frontend の
    `resolveContractNftLedger` が入力順をそのまま使う前提を守る)。
- `packages/collector/src/adapters/ethereum/nft-tracker.test.ts`(1件追加):
  - totalSupply の取得は成功したが一部の `ownerOf` が revert した場合に、
    `NftTracker.pollOnce` が部分的な台帳ではなく `tokens: undefined` を
    返すこと(全成功・全失敗の二値契約の end-to-end 確認。呼び出し側が
    前回値を維持する経路に繋がる)。
- `packages/collector/src/adapters/ethereum/contracts.nft.test.ts`(1件追加):
  - 前回 non-empty だった台帳を空配列 `[]` で観測した場合に、マージ(前回値の
    残存)ではなく `[]` へ洗い替わること。取得失敗(undefined)とは異なり
    `[]` は「観測できたが 0 件」という正当な状態であり前回内容を消す、という
    設計上の区別の境界を固定する。
- `packages/frontend/src/entities/walletNftHoldings.test.ts`(1件追加):
  - 複数コントラクト横断時に「contractAddress 昇順 → 各コントラクト内で
    tokenId 数値昇順」の2段ソートが同時に効くことを、走査順とは逆の入力で
    一括確認する(既存テストは単一コントラクトの tokenId ソートと複数
    コントラクトの address ソートを別々に確認していた)。
- `packages/frontend/src/entities/contractNftLedger.test.ts`(1件追加):
  - `walletAddresses` に同一アドレスの大文字小文字違いが混入した場合でも、
    例外を投げず後勝ち(`buildLowerCaseIndex` の仕様)で決定的に解決する
    ことの防御的テスト。
- `packages/frontend/src/chain-profiles/ethereum/operationCatalog.test.ts`
  (1件追加):
  - token メタ情報を持たないエントリの全引数(コンストラクタ・関数)に
    `unit: "token"` が付かないことを、引数名に依存しない一般則として保証する。
    既存テストは ChainvizNFT の `tokenId` という名前の引数のみを見ていたが、
    ERC-20 との copy-paste で `unit: "token"` が混入して decimals 換算で
    tokenId が壊れる罠を、より広く検出する。

### 確認結果

- 追加した回帰テストが実際に不具合を検出することを、最重要の列挙境界テスト
  で確認した(`erc721.ts` の `BigInt(i + 1)` を `BigInt(i)` に一時的に
  壊すと該当テストが fail し、元に戻すと pass することを確認して revert)。
- `pnpm lint`(eslint 全体)警告・エラーなし。
- `pnpm build`(全パッケージ)成功。
- `pnpm test` 全パッケージ通過: shared 74 / collector 1523(基本テストの
  1519 に +4)/ frontend 2360(2357 に +3)/ e2e 171。

### 発見した問題

- なし。実装・既存テストの品質は高く、二値契約(全成功・全失敗)・
  表記揺れ照合・空配列と未観測の区別・sort 順など主要な境界は実装担当の
  基本テストで既にカバーされていた。本作業はその周辺の穴埋め(列挙範囲の
  厳密性・解決順非依存・partial failure の end-to-end・一般則としての
  unit ガード等)を追加したもの。

## レビュー(2026-07-17)

- 担当: reviewer
- 対象: node-env + collector + frontend の3担当分すべて(cherry-pick 合流後の
  `issue-315-erc721-ownership-frontend` ブランチ、HEAD = 06e1186)
- 判定: **要修正(軽微)**。ロジック・型・境界・テストはすべて合格水準。
  指摘は下記2件のみで、いずれもコメントの追記・整形(ロジック変更なし)

### 確認した内容

- `packages/shared` の型変更(`NftToken` / `ContractEntity.nft` / `nftTokens`):
  設計メモどおり。`token`(数量・decimals あり)と `nft`(個体・symbol のみ)が
  別軸のフィールドとして分離されており、型レベルの混同なし。tokenId は
  balance/TokenBalance.amount と同じ10進文字列で精度問題なし。省略=未観測/
  空配列=観測済み未発行の区別も doc コメントに明記されている
- 境界の遵守: frontend は `ContractEntity.nftTokens` を読むだけで、
  `eth_call`/`ownerOf`/`totalSupply` 等のチェーン固有語彙は collector の
  `erc721.ts`(viem ABI もこのファイル内に自己完結)に閉じている。frontend 側で
  ERC-721 に言及するのは `chain-profiles/ethereum/`(チェーンプロファイルの
  フロント表現セット)と glossary・モックのみで、いずれも許容範囲。shared の
  スキーマのフィールド名はチェーン非依存(doc コメント内の「EVM では〜」は
  既存フィールドと同じ説明例示の流儀)
- チェーンプロファイル独立性: 既存プロファイルへの分岐追加なし。
  ChainvizToken/Counter の既存カタログエントリは無変更(純粋な追加のみ)
- エラーの握りつぶし: なし。`NftTracker.fetchLedger` は全ノード失敗時に
  最後に捕捉した実際のエラーをログし(固定文言へのすり替えなし。テストで
  検証済み)、`fetchErc721Ledger` は部分失敗で reject する二値契約。frontend の
  `compareTokenId` の catch → 文字列比較フォールバックは理由コメントあり
- 固定値: `NFT_POLL_INTERVAL_MS = 3000` は他層と揃えた周期でコメントあり。
  観測環境依存の決め打ち定数なし
- テストの質: tester 追加分を含め意味のある検証になっている。特に
  ownerOf の列挙範囲(1..totalSupply ちょうど)の回帰ガードは実装を意図的に
  壊して fail することを確認済みと記録されており、解決順非依存の並び保証・
  部分失敗→undefined の end-to-end・空配列洗い替え・大文字小文字表記ゆれ・
  `unit: "token"` 混入の一般則ガードなど、境界が広くカバーされている
- cherry-pick 合流の過不足: `git diff issue-315-erc721-ownership..HEAD --
  packages/collector packages/shared profiles docs/ARCHITECTURE.md` の差分は
  tester が本ブランチで追加したテスト3ファイル分のみで、designer/collector/
  node-env の内容は過不足なく反映されている
- コミット粒度: main..HEAD の22コミットはいずれも単一関心事で
  Conventional Commits 形式に適合
- `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を実測で確認
  (shared 74 / e2e 171 / collector 1523 / frontend 2360)

### 指摘(要修正・いずれも軽微)

1. **collector: RPC 回数のスケール前提がコードコメントに無い**。
   設計メモ(本ファイル「RPC 回数は…固定上限は設けない」)と
   `docs/ARCHITECTURE.md` §13.2 は「学習用ローカル環境で発行数は高々数十個
   という前提を置き、固定上限は設けない。**この前提はコード上のコメントにも
   明記する**」と宣言しているが、`erc721.ts` / `nft-tracker.ts` のどちらにも
   このスケール前提のコメントが無い(burn なし+連番採番の前提は `erc721.ts`
   に明記済み。無いのはスケール前提のみ)。`fetchErc721Ledger` は
   `Number(totalSupply)` 変換と無制限の `Promise.all` ファンアウトがこの
   前提に依存しているため、docs が約束したとおり `erc721.ts` の
   doc コメントに1〜2行追記すること(docs と実装の齟齬の解消)
2. **frontend: `WalletPopover.tsx` の doc コメント整形崩れ**。129〜130行目、
   ブロックコメント内に `*` プレフィックスの無い空行が1行紛れ込んでいる
   (`* ...同じ関数）。` の直後)。構文上は問題なく lint も通るが、編集時の
   消し忘れなので `*` 付きの空行1行に直すこと

### 差し戻し判断の材料

- 2件ともコメントのみの修正でロジック・テストに影響しない。修正後の
  再レビューは該当2ファイルの差分確認だけで足りる(ビルド・テストの
  全再実行は pre-push フックに委ねてよい)
- `docs/PLAN.md` の #315 チェックボックスは上記2件の解消を確認してから
  チェックする(未チェックのまま残している)

### 再レビュー(2026-07-17・同日)

- 指摘2件の是正を確認し、**合格**とする:
  1. `erc721.ts`(コミット bbb2459): `fetchErc721Ledger` の JSDoc に「RPC 呼び出し回数は 1 + totalSupply。
     学習用ローカル環境では発行数が高々数十個という前提を置き、固定上限は
     設けない」と追記され、`docs/ARCHITECTURE.md` §13.2・設計メモとの齟齬が
     解消された
  2. `WalletPopover.tsx`(コミット ef32702): doc コメント内の `*` プレフィックス
     の無い空行が削除された
- 両コミットとも該当1ファイルのコメントのみの変更で、ロジックへの影響なし
  (統括が `pnpm lint` / `pnpm build` の全パッケージ通過を確認済み)
- あわせて `docs/PLAN.md` の #315 チェックボックスをチェックした(node-env・
  collector・frontend の3担当分が揃ったため、設計メモの申し送りどおり
  まとめて更新)。PR 作成・マージ・Issue クローズは統括に委ねる
