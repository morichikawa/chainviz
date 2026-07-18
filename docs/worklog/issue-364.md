### 2026-07-17 Issue #364 サンプルコントラクトのトークンシンボル(CVZ等)がSolidityの定数でハードコードされておりデプロイ時に変更できない（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-364-backlog
- 内容: ユーザーからの指摘で起票したIssue #364の、`docs/PLAN.md`
  バックログ節への追記（docsのみの変更）のレビュー。
  - Issue #364本文と`docs/PLAN.md`追記の照合: 指摘の出所（ユーザーからの
    指摘）・事実関係（`symbol = "CVZ"`が定数、コンストラクタ引数は
    `initialSupply`のみ）・問題点（「CVZ」が一般的なブロックチェーン
    用語・ティッカーに見えてしまう）・対応の論点（name/symbolの
    コンストラクタ引数化、または表記変更）・影響範囲（catalog.json・
    operationCatalog.ts・mockData.ts等のCVZ依存箇所の洗い出しが必要）の
    いずれも一致。Issue本文にあるChainvizNFT.solの`symbol = "CVN"`への
    言及（本文では「要確認」扱い）はPLAN.md側ではタイトルの「(CVZ等)」に
    要約されているが、バックログ項目は要約で足りるため過不足なしと判断
  - Issue本文が参照する事実の実在確認:
    `profiles/ethereum/contracts/src/ChainvizToken.sol` 13行目に
    `string public constant symbol = "CVZ";` が実在し、コンストラクタは
    `constructor(uint256 initialSupply)` のみ（symbolは引数化されて
    いない）。Issue本文で「要確認」とされていた
    `profiles/ethereum/contracts/src/ChainvizNFT.sol` についても30行目に
    `string public constant symbol = "CVN";` が実在し、同じ構造であることを
    レビュー時に確認済み（着手時の再調査は不要）。影響範囲として挙げられた
    `profiles/ethereum/contracts/catalog.json`・
    `packages/frontend/src/chain-profiles/ethereum/operationCatalog.ts`・
    `packages/frontend/src/websocket/mockData.ts` もいずれもCVZ文字列を
    含んで実在（そのほかfrontend/collector/shared/e2eのテスト等にも
    CVZ参照が多数あり、Issue本文の「該当箇所多数」と整合）
  - `docs/PLAN.md` の追記フォーマットは直前の #359 項目等と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - コミット粒度: `git log main..HEAD` は1コミット（PLAN.md追記のみ）で
    1変更1コミットの規約に適合。Conventional Commits形式も適合
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
    （frontend 198ファイル2592テスト含む）
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - 実装着手は後日。コンストラクタ引数化（DeployFormからの入力）か
    表記変更かは着手時に設計判断が必要。引数化する場合はfrontend
    （DeployForm）にも波及するため、着手時はchainviz-designerの設計を
    先行させるのがよい

### 2026-07-18 Issue #364 設計（トークンシンボルの扱いの方針決定・影響範囲の洗い出し）

- 担当: designer
- ブランチ: issue-364-cvz-token-symbol
- 設計メモ:
  - **採用方針: 案B「命名変更のみ」**。Solidity定数のまま、シンボルを
    `CVZ` → `CVZDEMO`（ChainvizToken）、`CVN` → `CVNDEMO`（ChainvizNFT）に
    変更する。コンストラクタ引数化（案A）は本Issueでは採用しない
  - 案Aを採用しない理由:
    1. 現行アーキテクチャは「コントラクトカタログ（catalog.json）が
       token/nft メタ情報の単一の真実の情報源」（ARCHITECTURE.md §4）。
       collector はチェーンから `symbol()` を読まず、カタログの静的値を
       `ContractEntity.token` / `ContractEntity.nft` にそのまま転記する
       （`packages/collector/src/adapters/ethereum/catalog.ts` /
       `contracts.ts`）。シンボルをデプロイ時のユーザー入力にすると、
       入力値とカタログ静的値が乖離して表示が嘘になるため、正しく作るには
       collector にデプロイ検知時のオンチェーンメタデータ読み取り
       （`symbol()` の eth_call 相当）という新規機構が必要になる
    2. shared 側は変更不要（`WorkbenchOperation.deployContract.
       constructorArgs?: string[]` と `OperationArgType` の `"string"` が
       既に存在する）だが、上記の collector 変更に加え、frontend でも
       デプロイタブの単位ラベル（「CVZ単位」は `operationCatalog.ts` の
       静的 `token.symbol` 由来）や NFT 台帳ラベル「CVN #1」の動的化が
       必要になり、影響が collector / frontend 双方のロジックへ広がる
    3. Issue の中心的な問題（「CVZ」が実在の一般的なティッカーに見える）は
       命名変更だけで解決する。「symbol はデプロイヤーが決められる」と
       いう学習ポイントの提示は価値があるが、「Phase 単体で動くデモを
       優先し先回り実装をしない」原則に照らして本 Issue の範囲外とし、
       将来の独立した Issue（バックログ候補）として分離する。その際は
       上記 1. のオンチェーンメタデータ読み取りを collector に足すのが
       前提条件になる
  - 新シンボルを `CVZDEMO` / `CVNDEMO` とする理由: 既存の CVZ / CVN との
    連続性を保ちつつ「DEMO」でサンプルであることが一目で分かる。7文字で
    実在ティッカーの慣習（3〜5文字）から外れ、一般的なティッカーに
    見えない。UI 上のラベル（「5.0000 CVZDEMO」「CVNDEMO #1」
    「（CVZDEMO単位）」）でも許容できる長さ
  - 変更しないもの:
    - コントラクト名・catalogKey（`ChainvizToken` / `ChainvizNFT`）。
      forge のデプロイターゲット解決・`ContractEntity.catalogKey` 照合の
      キーであり、変更すると影響が桁違いに広がる
    - Solidity の `name` 定数（"Chainviz Token" / "Chainviz NFT"）。既に
      chainviz 固有と分かる表記で、Issue の指摘対象はシンボルのみ
    - `decimals`（18）
  - **shared の型変更: 不要**（`token.symbol` / `nft.symbol` は自由文字列。
    プロトコルにも変更なし）
- 影響範囲（実装担当向けファイル一覧）:
  - **必須（node-env）**:
    - `profiles/ethereum/contracts/src/ChainvizToken.sol`（13行目
      `symbol = "CVZ"`）
    - `profiles/ethereum/contracts/src/ChainvizNFT.sol`（30行目
      `symbol = "CVN"`）
    - `profiles/ethereum/contracts/build-catalog.sh`（115〜125行目の
      add_entry の token/nft JSON リテラルとコメント）
    - `profiles/ethereum/contracts/catalog.json`（手編集せず
      `./build-catalog.sh` で再生成する。ソース全文の埋め込み
      （source.code）もこれで追随する）
    - `profiles/ethereum/README.md`（324行目・368行目）
  - **必須（frontend）**:
    - `packages/frontend/src/chain-profiles/ethereum/operationCatalog.ts`
      （93行目 `token: { symbol: "CVZ", decimals: 18 }`）
    - `packages/frontend/src/chain-profiles/ethereum/operationCatalog.test.ts`
      （68〜69行目。実値 `"CVZ"` をアサートしているため放置するとテストが
      落ちる。唯一の「命名変更で壊れる」テスト）
    - `packages/frontend/src/websocket/mockData.ts`（16箇所: モックの
      `token.symbol` / `nft.symbol`、埋め込みソース文字列466行目、定数名
      `ALICE_CVZ_BALANCE_WEI` 等とコメント。モックモードはユーザーが実際に
      見る表示なので必須扱い）
    - `packages/frontend/src/operations/OperationArgInput.tsx`（44行目、
      コメント内の例のみ）
    - `packages/frontend/src/entities/walletNftHoldings.ts`（80行目、
      コメント内の例のみ）
  - **必須（docs）**:
    - `docs/ARCHITECTURE.md`（2690行目 `nft: { symbol: "CVN" }`・
      2735行目「CVN #1」）
  - **表記統一のための追随（機能的には変更しなくてもテストは通る。
    自己完結フィクスチャだが、「実在ティッカーに見える表記」を残さない
    ため同一PR内で更新する）**:
    - collector テスト8ファイル: `adapter-chain-reset.test.ts` /
      `catalog.test.ts` / `contract-deploy-wiring.test.ts` /
      `contract-subscribe.test.ts` / `contracts.nft.test.ts` /
      `contracts.source-code.test.ts` / `contracts.test.ts` /
      `nft-observation-wiring.test.ts`
    - frontend テスト15ファイル: `WalletCard.test.tsx` /
      `WalletPopover.test.tsx` / `WalletCard.nftHoldings.test.tsx` /
      `WalletPopover.nftHoldings.test.tsx` / `ContractCard.nftLedger.test.tsx` /
      `ContractPopover.nftLedger.test.tsx` / `ContractListPanel.test.tsx` /
      `contractList.test.ts` / `walletNftHoldings.test.ts` /
      `walletTokenBalances.test.ts` / `deployedContracts.test.ts` /
      `CallForm.tokenUnit.test.tsx` / `DeployForm.tokenUnit.test.tsx` /
      `OperationArgInput.tokenUnit.test.tsx` /
      `sourceTokenizer.tokenize.test.ts`、および
      `mockData.workbenchOperations.test.ts`
    - shared テスト2ファイル: `entities.contractSource.test.ts` /
      `entities.nftOwnership.test.ts`
    - e2e: `packages/e2e/src/ui/token-balance.spec.ts`（84行目・109行目、
      コメントのみ。アサートはシンボル文字列に依存しない）
  - **変更してはいけないもの**: `docs/worklog/` 配下の過去の記録・
    `docs/WORKLOG.md` の過去の要約・`docs/PLAN.md` バックログ項目の本文
    （いずれも当時の事実の記録。「CVZ」の記載が残っていてよい）
- 実装分担とコミット分割の案:
  1. node-env（構築初）: Sol 2ファイル + build-catalog.sh 修正 +
     catalog.json 再生成 + README 追随（feat または fix、1コミット）
  2. frontend（描画麗）: operationCatalog.ts + 同テスト + mockData.ts +
     コメント2箇所（1コミット）
  3. テストフィクスチャの表記追随（collector/shared/frontend/e2e。
     test: の1コミットにまとめてよい。機械的な置換）
  4. docs: ARCHITECTURE.md の2箇所（docs: の1コミット）
  - 1と2は独立して着手できるが、operationCatalog.test.ts のコメントが
    「ソースの定数と一致させる」と明記しているとおり、**Sol の新シンボルと
    operationCatalog.ts / catalog.json の値は完全一致が必須**。先に
    このworklogの決定値（CVZDEMO / CVNDEMO）を両担当が前提にすること
- 注意点:

  - catalog.json の再生成には forge（無ければ docker 経由のフォール
    バック）と jq が必要（build-catalog.sh 冒頭コメント参照）
  - 稼働中のチェーンに旧シンボル定数でデプロイ済みのコントラクトが
    残っている場合、カタログ更新後は表示が CVZDEMO 側に変わる（カタログが
    単一の真実の情報源であり、チェーン上の定数は読まないため）。学習環境は
    使い捨て（docker compose down -v で再構築）前提なので許容する
  - glossary/ 配下に CVZ/CVN への言及は無いことを確認済み（i18n 影響なし）

### 2026-07-18 Issue #364 実装（node-env: Solidity定数変更・catalog.json再生成・README追随）

- 担当: node-env
- ブランチ: issue-364-cvz-token-symbol
- 実装設計メモ（node-env）:
  - 設計メモの決定どおり、`profiles/ethereum/contracts/src/ChainvizToken.sol`の
    `symbol`定数を`"CVZ"`→`"CVZDEMO"`、
    `profiles/ethereum/contracts/src/ChainvizNFT.sol`の`symbol`定数を
    `"CVN"`→`"CVNDEMO"`に変更する。`name`定数・コントラクト名・`decimals`は
    変更しない
  - `build-catalog.sh`はスクリプト本体（`add_entry`呼び出しのJSONリテラル）と
    直上のコメント（「symbol="CVZ"と一致させること」等の記述）の両方に
    ハードコードされた旧シンボルがあるため、両方を新シンボルに合わせて
    修正してからスクリプトを実行し、`catalog.json`を再生成する
    （catalog.jsonは手編集しない）
  - `README.md`はコード変更ではなくドキュメントだが、実装ファイル・生成物と
    矛盾しないよう同一コミットに含める（324行目のトークン説明表・368行目の
    コメント例）
  - コミット分割: worklogの分担案どおり「Sol 2ファイル + build-catalog.sh +
    catalog.json再生成 + README」を1コミット（node-env担当分はこれで完結。
    frontend担当分・テストフィクスチャの表記統一・docs(ARCHITECTURE.md)は
    別担当・別コミット）
  - 実装後、`pnpm lint && pnpm build && pnpm test`を実行し、
    node-env配下（profiles/）の変更に起因するテスト失敗が無いことを確認する。
    frontend/collector側のCVZ固定文字列テストは別エージェントが並行対応中の
    ため、その分の失敗は本タスクの完了条件に含めない
  - `profiles/`配下を`grep -rl "CVZ\|CVN"`で確認したところ、対象は
    `src/ChainvizToken.sol` / `src/ChainvizNFT.sol` / `build-catalog.sh` /
    `README.md` / `catalog.json`（再生成で追随）の5点のみで、
    profiles配下に単独のテストファイルは存在しない（テスト・コメント追随の
    対象は無し）

### 2026-07-18 Issue #364 実装設計メモ(frontend)

- 担当: frontend
- ブランチ: issue-364-cvz-token-symbol-frontend（designerのissue-364-cvz-token-symbol
  から分岐した一時ブランチ。node-env担当と並行作業のためworktreeを分けている。
  後で統括がcherry-pickして合流させる）
- 前提: 上記designerの設計メモに従い、案B（命名変更のみ）を採用。新シンボルは
  `CVZDEMO`（ChainvizToken）・`CVNDEMO`（ChainvizNFT）。node-env側が
  `catalog.json`を並行して再生成中のため、本ブランチでは`catalog.json`を
  変更せず、`operationCatalog.ts`のロジック（catalog.jsonを読み込む処理）にも
  手を入れない。あくまでテストの期待値・モックデータの表示値のみを変更する
- 実装方針:
  1. `operationCatalog.ts`の93行目`token: { symbol: "CVZ", decimals: 18 }`を
     `"CVZDEMO"`に更新し、同じ箇所の日本語コメント（「ソース...の
     symbol/decimals定数と一致させる」）はそのまま残す（値のみ変更）
  2. `operationCatalog.test.ts`の実値アサート（`{ symbol: "CVZ", decimals: 18 }`）
     を`"CVZDEMO"`に更新。このテストのみ「放置すると落ちる」箇所（catalog.json
     とは無関係にoperationCatalog.ts自身の値をハードコードでアサートしている
     ため）
  3. `mockData.ts`はモックモードでユーザーが実際に目にする表示値なので必須で
     更新する。対象は次の3種類:
     - リテラル値: `token: { symbol: "CVZ", decimals: 18 }` →
       `"CVZDEMO"`、`nft: { symbol: "CVN" }` → `"CVNDEMO"`（
       `chainvizTokenContract`/`chainvizNftContract`/`MOCK_DEPLOYABLE_CATALOG`
       の3箇所ずつ）、埋め込みソース文字列
       `'    string public constant symbol = "CVZ";'`
     - 定数名: `ALICE_CVZ_BALANCE_WEI` → `ALICE_CVZDEMO_BALANCE_WEI`、
       `BOB_CVZ_BALANCE_WEI` → `BOB_CVZDEMO_BALANCE_WEI`（宣言・参照箇所とも
       リネーム。値自体は変更しない）
     - コメント中の「CVZ」「CVN」表記（例:「CVZ残高」「CVZトークン残高」
       「"ChainvizToken" / "CVZ" と完全に一致させる」）も表示値に揃えて
       `CVZDEMO`/`CVNDEMO`に更新する
  4. `OperationArgInput.tsx`（44行目）・`walletNftHoldings.ts`（80行目）の
     コメント内の例（「（CVZ単位）」「CVN #1」）を`CVZDEMO`/`CVNDEMO`に更新
     （コードロジックへの変更はない）
  5. worklogの「表記統一の追随」リストのfrontend 15ファイルは、いずれも
     自己完結フィクスチャ内のテスト用文字列（symbol/表示ラベルの期待値・
     テスト内で組み立てるダミーコントラクトのsymbolなど）を`CVZDEMO`/
     `CVNDEMO`に置換する。ロジック（フォーマット関数・コンポーネント）は
     変更しない
- コミット分割の方針: 「1つの変更=1コミット」に従い、
  1) `operationCatalog.ts`＋同テスト（1コミット。唯一「放置すると落ちる」
     箇所であり独立してレビュー・巻き戻しできるようにする）、
  2) `mockData.ts`（1コミット。モック表示値の変更というまとまった関心事）、
  3) コメント2箇所（`OperationArgInput.tsx`/`walletNftHoldings.ts`。
     ロジック変更を伴わないコメントのみの変更として分離）、
  4) 表記統一の追随（frontend テスト15ファイルの機械的な置換。1コミント）
  の4コミットに分ける
- 注意点:
  - `catalog.json`は本ブランチで一切変更しない。`operationCatalog.test.ts`
    後半の「ETHEREUM_OPERATION_CATALOG matches the real catalog.json ABI」
    describeブロックはcatalog.jsonを読み込んで突き合わせるテストであり、
    node-env側の再生成が本ブランチのworktreeに反映されるまでは対象外
    （symbol自体はこのdescribeブロックの比較対象に含まれない -
    constructorArgs/functions/payableのみ突き合わせているため、catalog.json
    が旧シンボルのままでもこのテスト自体は落ちない見込み。ただし
    `pnpm test`実行結果は本項下部に事実として記録する）

### 2026-07-18 Issue #364 frontend実装完了

- 担当: frontend
- ブランチ: issue-364-cvz-token-symbol-frontend
- 内容: 上記「実装設計メモ(frontend)」の方針どおり、以下4コミットに
  分けて実装した。
  1. `operationCatalog.ts`の`token.symbol`を`"CVZ"` → `"CVZDEMO"`に更新し、
     `operationCatalog.test.ts`の実値アサートも合わせて更新（fix:）
  2. `mockData.ts`のトークン/NFTシンボル表示値・定数名
     （`ALICE_CVZ_BALANCE_WEI`等 → `ALICE_CVZDEMO_BALANCE_WEI`等）・
     埋め込みソース文字列・コメントを更新（fix:）
  3. `OperationArgInput.tsx`・`walletNftHoldings.ts`のコメント内の表示例
     （「CVZ単位」「CVN #1」）を更新（docs:、ロジック変更なし）
  4. worklog記載の frontend テスト15ファイル（自己完結フィクスチャ）の
     symbol表記を機械的に置換（test:）。`deployedContracts.test.ts`の
     `"CVZ2"`（catalog静的値と異なることを検証する意図的な別値）は
     `"CVZDEMO2"`に置き換え、意図（catalog値と異なる）は保持
- 確認結果:
  - `pnpm lint`（リポジトリルート、frontend含む全パッケージ）: 通過
  - `pnpm --filter @chainviz/frontend build`: 通過
  - `pnpm --filter @chainviz/frontend test`: 205ファイル2650テスト全て
    通過。`catalog.json`はnode-env側が並行作業中でまだ旧シンボル
    （"CVZ"/"CVN"）のままだったが、`operationCatalog.test.ts`の
    catalog.json突き合わせテストはsymbolを比較対象にしていないため
    影響を受けず、想定どおり失敗は発生しなかった
  - `packages/frontend/src`配下に裸の`CVZ`/`CVN`（`CVZDEMO`/`CVNDEMO`の
    一部でない）が残っていないことを`grep`で確認済み
- 注意点（次の担当向け）:
  - `catalog.json`はこのブランチで変更していない。node-env側の再生成が
    合流した後、統括が`operationCatalog.test.ts`の
    「matches the real catalog.json ABI」テストを含め`pnpm test`で
    最終的な整合性を再確認すること
  - `docs/ARCHITECTURE.md`の該当2箇所（2690行目・2735行目）・
    collector/shared/e2eの表記統一はこのブランチの対象外（node-env担当・
    別コミットで対応予定）
