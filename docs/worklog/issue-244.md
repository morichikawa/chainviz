# Issue #244 デプロイtxで発生したイベント(mintのTransfer等)が復号されず生チップ表示になる

### 2026-07-11 Issue #244 原因調査・修正方針の設計（設計フェーズ）

- 担当: designer
- ブランチ: issue-244-deploy-event-decode
- 内容: 実機再現による根本原因の特定と、collector 側の修正方針の設計。
  実装はまだ行っていない（後続の collector 担当が実装する）。

## 再現手順と観測結果（実機確認済み）

profiles/ethereum の Docker スタック + collector を起動し、WebSocket 経由で
`runWorkbenchOperation`（`deployContract` / ChainvizToken /
initialSupply=1000e18）を送信して diff を観測した。タイムライン
（2026-07-11T03:36:41、1回のデプロイ）:

1. `.044` デプロイ tx が `included` になり、`contractEvents` は
   `rawEventId: 0xddf252…b3ef`（Transfer の topic0 生値）のみ。
   `eventName` なし
2. `.044` 同時に ContractEntity が「未知」（name/catalogKey 未設定）として
   entityAdded される
3. `.089`（**45ms 後**）`registerContractDeployment` 由来の entityUpdated で
   コントラクトに `name: ChainvizToken` / `catalogKey` / `token` が付く
4. tx の `contractEvents` はその後も生値のまま二度と更新されない
   （30 秒観測）

対比実験: 同じコントラクトへその後 `callContract`（`transfer`）を実行すると、
その tx の `contractEvents` は `eventName: "Transfer"` + 引数付きで正しく
復号された。カタログ・ABI 自体は正しく、デプロイ tx だけが復号されない。

補足: GUI（ブラウザ）でのチップ表示確認は、この検証環境に libnspr4 が無く
Playwright の chromium が起動できないため実施していない。ただしフロントの
チップ導出（`packages/frontend/src/entities/contractActivity.ts`）は
`eventName` 有無だけで決まる純関数（ユニットテスト済み）であり、上記の
WebSocket ペイロードがそのまま Issue の症状（`◆ 0xddf252…b3ef` チップ +
「カタログに定義が無いため復号できません」ホバー）になることはコード上
確定している。

## 根本原因（2 層のタイミング問題）

デプロイ tx のイベントログは
`EthereumAdapter.handleBlockInclusion`（`packages/collector/src/adapters/ethereum/index.ts`）
で `decodeReceiptLogs`（発行元アドレスを `ContractTracker.getCatalogEntry`
で照合）により復号されるが、デプロイ tx の時点では以下の 2 つの理由で
照合に失敗する:

1. **同一ブロック処理内の順序**: `handleBlockInclusion` は
   「ログ復号（`decodeReceiptLogs`）→ デプロイ検知
   （`detectContractDeployments` = `ContractTracker.recordDeployment`）」の
   順で処理する。復号の時点で発行元コントラクトはまだ未追跡なので、
   `getCatalogEntry` は undefined を返し raw フォールバックになる。
   `ContractTracker.pendingCatalogKeys`（カタログ登録がデプロイ検知より
   先に届くケースへの対応）があっても、適用されるのは `recordDeployment`
   時なので、この順序では効かない
2. **カタログ登録の後着（実測で支配的なケース）**: `deployContract` 経由の
   カタログ登録（`registerContractDeployment`）は forge create の stdout
   解析後に呼ばれるため、ブロック取り込み処理より**後着**する（実測 45ms）。
   この場合コントラクトは一旦「未知」として追跡され、後からカタログ既知へ
   更新される（コントラクトカード自体の表示はこれで直る）が、既に配信済みの
   tx の `contractEvents` を再計算する仕組みが存在しないため、生値のまま
   永続する

原因 1 だけ直しても（順序を入れ替えても）、原因 2 のケース（実測の支配的
ケース）ではデプロイ検知時点でカタログキーがまだ届いていないため復号
できない。両方の対処が必要。

## 修正方針（collector 担当への設計）

`docs/ARCHITECTURE.md` §4「subscribeContracts」の追記も参照。
`packages/shared` の型変更は**不要**（`TransactionEntity.contractEvents` の
更新は既存の entityUpdated パッチで配信できることを実機で確認済み）。
フロントのコード変更も**不要**（tx の entityUpdated を受ければチップは
自動的に復号表示へ変わる。`contractActivity.ts` は導出のたびに再計算され、
`sameContractActivity` はラベル変化を検知して再描画する）。

### (A) handleBlockInclusion 内の順序修正（原因 1）

`this.detectContractDeployments(receipts)` の呼び出しを、
`recordInclusion`（の入力を組み立てる `decodeReceiptLogs`）より**前**に
移動する。これで:

- デプロイ検知が先に走り、`pendingCatalogKeys`（カタログ登録が先着した
  ケース）がその場で適用されるため、同一 tx 内のイベントが復号できる
- 副次効果として、コントラクトの entityAdded が同一ブロックの tx
  entityUpdated より先に配信されるようになる（tx が
  `createdContractAddress` で参照するコントラクトが先に存在する、
  より自然な順序）

### (B) カタログ登録の後着時にデプロイ tx のイベントを再復号（原因 2）

1. **生ログの一時保持**: `EthereumAdapter` にフィールド
   `undecodedDeployLogs: Map<string, { txHash: string; logs: RpcLog[] }>`
   （キーは正規化済み小文字アドレス）を追加。`handleBlockInclusion` で
   デプロイ検知後、`receipt.contractAddress` が非 null かつ
   `getCatalogEntry(contractAddress)` が undefined（カタログ未照合）かつ
   `receipt.logs` が非空の tx について、生ログを保持する。
   追加の RPC 呼び出しはしない（Issue #86 の方針を維持。receipt は既に
   手元にある）
2. **再復号と再配信**: `registerContractDeployment` で
   `ContractTracker.registerDeployment` が更新後エンティティを返した
   （= 未知 → カタログ既知への昇格が起きた）場合、`undecodedDeployLogs` を
   アドレスで引き、ヒットしたら `decodeReceiptLogs` で再復号 →
   `TransactionLifecycleTracker.updateContractEvents(txHash, events)`
   （新設メソッド）で tx を更新 → 更新後の `TransactionEntity` を onTx へ
   渡して entityUpdated として再配信 → バッファのエントリを削除する。
   配信順序は既存どおり「コントラクトの entityUpdated → tx の
   entityUpdated」
3. **onTx の保持**: 現在 onTx は `subscribeTransactions` のクロージャ引数
   でしか持っていないため、`onContract` と同様に
   `private onTx?: (tx: TransactionEntity) => void` としてフィールドに保持
   する。onTx 未登録でも txTracker の更新自体は行う
   （`detectContractDeployments` の「onContract 未登録でも追跡自体は行う」
   と同じ流儀）
4. **新設メソッド**
   `TransactionLifecycleTracker.updateContractEvents(hash: string, contractEvents: ContractEvent[]): TransactionEntity | null`
   （`packages/collector/src/adapters/ethereum/transactions.ts`）:
   - 未追跡の hash（既に evict 済み等）→ null（エラーではない正常系。
     呼び出し側は何もしない）
   - `contractEvents` が空 → null（意味のない更新を配信しない。
     `recordInclusion` の「空配列はフィールド省略」と整合）
   - それ以外 → `contractEvents` を差し替えたエンティティを put
     （最新扱いに入れ直し）して返す
5. **バッファの後始末**: カタログ照合の適用時（上記 2）に削除。手動
   `forge create` 等で永遠に登録が来ないデプロイ分が溜まり続けないよう、
   Map に上限を設けて挿入順で evict する（txTracker の maxTxs と同様の
   考え方。上限値は実装時に決めてよいが、「固定値の前提条件をコメントと
   worklog に明記する」品質ゲートに従うこと。tx 側が evict 済みなら
   `updateContractEvents` が null を返すだけなので、バッファに古い
   エントリが残っていても害はない）

### スコープ外とした判断（理由つき）

- **デプロイ tx 以外の再復号はしない**: カタログ登録が後着するまでの
  数十 ms の間に、同じコントラクト宛ての別 tx（transfer 等）が確定した
  場合、その tx のイベントも生値のままになる理論上の窓はあるが、
  全 tx の生ログをアドレス索引で保持する仕組みが必要になり、
  発生確率（ユーザー操作で数十 ms 内に 2 操作）に対して複雑さが
  釣り合わない。デプロイ tx（Issue の症状そのもの）に限定する
- **`contractCall`（関数呼び出し側）の遡及復号はしない**: デプロイ tx は
  `to: null` なので `contractCall` を持たず、本 Issue の対象外。
  「追跡前の pending 検知で contractCall が付かない」制約は Issue #162 の
  設計（ARCHITECTURE.md §4 の既存の制約記述）どおり
- **未復号チップのホバー文言（`contract.chip.undecoded`）は変更しない**:
  修正後、未復号チップが出るのは(a)カタログ外コントラクト、(b)既知
  コントラクトだが ABI に無いイベント、のどちらかに限られ、いずれも
  「カタログに定義が無いため復号できません」は事実と一致する。Issue が
  指摘する「事実と異なるホバー」はカタログ既知デプロイの生チップ自体が
  消える（数十 ms で自己修復する）ことで解消される

### テスト（実装担当・tester への引き継ぎ）

- `transactions.test.ts`（または 1 ファイル 1 責務で分割した新ファイル）:
  `updateContractEvents` の単体（未追跡 hash → null / 空配列 → null /
  正常更新で contractEvents 差し替え・他フィールド不変）
- アダプタ統合: `contract-decode.test.ts` が既に「購読経路にモック WS/RPC
  を流し込んで復号の配線を検証する」形を持っている。同じ道具立てで
  新ファイル（例: `deploy-event-redecode.test.ts`）に回帰テストを追加する:
  1. 順序 A（登録先着）: `registerContractDeployment` → ブロック取り込み、
     でデプロイ tx のイベントが最初から復号されること
  2. 順序 B（登録後着。実測の支配的ケース）: ブロック取り込み →
     `registerContractDeployment`、で tx の entityUpdated が再配信され
     `eventName` が付くこと
  - 回帰テストが元の不具合を検出できることを、修正前のコードで一度
    確認してから修正を入れること（品質ゲート「直したはずで済ませない」）

## 検証環境についての注意（次の担当向け）

- 検証時、既存の Docker スタックが**削除済みの別 worktree**
  （wt-issue-233）の bind mount で起動されたまま残っており、workbench
  コンテナの `/contracts` が空で `docker exec` も
  「container breakout detected」で失敗する状態だった。workbench
  サービスのみ `docker compose up -d --no-deps --force-recreate workbench`
  で作り直して復旧した（チェーン本体には触れていない）。worktree を
  消す前にスタックを畳まなかった名残と思われる。同様の症状
  （デプロイ操作が即失敗する）を見たら bind mount の Source を
  `docker inspect` で確認するとよい
- `callContract` の `functionName` は `transfer` ではなく
  `transfer(address,uint256)` のような完全シグネチャで送る必要がある
  （cast send の仕様。フロントは操作カタログ
  `chain-profiles/ethereum/operationCatalog.ts` の `signature` を
  そのまま送っている）
