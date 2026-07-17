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
