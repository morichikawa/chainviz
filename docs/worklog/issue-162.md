# Issue #162 カタログABIによる関数呼び出し・イベントログの復号

### 2026-07-07 Issue #162 実装

- 担当: collector
- ブランチ: issue-162-decode-calls-events
- 内容: 新Phase4（C層拡張）の一部として、コントラクトカタログ（Issue #159）の
  ABIを使い、tx の関数呼び出し（`eth_getTransactionByHash` の `input`）と
  イベントログ（`eth_getBlockReceipts` の `logs`。Issue #160 で未復号のまま
  取得済み）を復号し、`TransactionEntity.contractCall` /
  `contractEvents` へ反映した。`docs/ARCHITECTURE.md` §4 の設計（viem の
  `decodeFunctionData`/`decodeEventLog` を使う、追加のRPC呼び出しは発生
  させない）どおりに実装している。

- 実装内容:
  - `packages/collector/src/adapters/ethereum/eth-rpc-client.ts`:
    - `RpcTransaction` に `input: string` を追加。`eth_getTransactionByHash`
      の生レスポンスから正規化する（フィールド欠落・非文字列は `"0x"` に
      フォールバック）。
  - `packages/collector/src/adapters/ethereum/decode.ts`（新規）:
    - `decodeContractCall(catalogEntry, contractAddress, inputHex)`:
      `input` の先頭4バイト（関数セレクタ）が無い（`"0x"` のみ・4バイト
      未満）場合は `undefined`（関数呼び出しではないと判定し、呼び出し側は
      `contractCall` 自体を省略する）。セレクタがあれば viem の
      `decodeFunctionData` でカタログの ABI を使って復号し、成功すれば
      `functionName`/`args`（`DecodedArgument[]`）を、失敗すれば
      `rawFunctionId`（セレクタ）のみを返す。
    - `decodeContractEvent(catalogEntry | undefined, log)`: ログの発行元
      （`log.address`）がカタログ照合済み（`catalogEntry` が渡された）場合
      のみ `decodeEventLog` で復号を試み、成功すれば `eventName`/`args`、
      失敗または `catalogEntry` が `undefined`（未追跡・未カタログの発行元）
      なら `rawEventId`（`topics[0]`。匿名イベント等で `topics` が空なら
      省略）のみを返す。
    - 引数の名前付け: viem の `decodeFunctionData`/`decodeEventLog` は ABI の
      入力定義に応じて `args` を配列（位置指定）またはオブジェクト（名前
      指定）のどちらで返すか変わる（実測で確認: 関数は常に配列、イベントは
      全入力に名前があればオブジェクト、1つでも無名ならその関数/イベント
      全体が配列になる）ため、`toDecodedArgs()` は両方の形を受け付けて
      ABI の入力定義（`abiInputs`）の順序に沿った `DecodedArgument[]` へ
      正規化する。無名の入力には位置ベースの `argN`（N は0始まり）を
      割り当てる（`catalog.json` の `allowance` 等、内部的な引数名を持たない
      関数に対応）。
    - 大きな `uint256` 引数は BigInt のまま `toString(10)` して文字列化し、
      精度落ちを防ぐ（`DecodedArgument.value` は表示用文字列）。
    - 復号失敗時は `console.warn` で「どのセレクタ/イベント signature が
      どのコントラクトで復号できなかったか」を具体的にログしてから
      raw フォールバックを返す（CLAUDE.md「エラーを握りつぶさない」原則。
      カタログ外の関数呼び出し自体は正常な運用でも起こりうるため warn
      レベルに留めた）。
    - ABI（`unknown[]`）は `viem` の `Abi` 型へキャストして扱う。ここで
      扱う ABI はカタログ由来のもの限りで、ワールドステートには一切出さない
      （呼び出し側 = `index.ts` へは `ContractCall`/`ContractEvent` という
      チェーン非依存の型だけを返す）。
  - `packages/collector/src/adapters/ethereum/contracts.ts`:
    - `ContractTracker.getCatalogEntry(address)` を追加。address が
      追跡中かつカタログ照合済み（`catalogKey` 確定）であれば対応する
      `CatalogEntry`（ABI 含む）を返し、未追跡・未照合なら `undefined`。
      既存の `get()` と同じ `normalizeAddress`（小文字化）でキーを揃える。
  - `packages/collector/src/adapters/ethereum/transactions.ts`:
    - `TxDetail` に `contractCall?: ContractCall` を追加。`recordPending`
      は渡されればそのまま `TransactionEntity.contractCall` へ載せる。
    - `TxInclusionDetail` に `contractEvents?: ContractEvent[]` を追加。
      `recordInclusion` は非空配列が渡されたときだけ
      `TransactionEntity.contractEvents` へ載せる（空配列を「イベント
      なし」の全 tx に埋め尽くさない）。ブロックが変わるたびに渡された
      値で置き換える（過去ブロックの内容を引き継がない）。
    - `recordInclusion` は `contractCall` を自分では計算せず、既存
      エンティティ（pending 時に付いていれば）の値をそのまま引き継ぐ。
      inclusion 側は receipt から `input` を取得しないため、pending を
      経ない tx には `contractCall` が付かない制約（ARCHITECTURE.md の
      既知の制約）をそのまま体現している。
  - `packages/collector/src/adapters/ethereum/index.ts`:
    - `handlePendingTx`: `getTransactionByHash` の結果（`input` 込み）を
      使い、`resolveContractCall(to, input)` で `to` が
      `contractTracker.getCatalogEntry()` に一致すれば
      `decodeContractCall` を呼ぶ。一致しなければ（未追跡・未カタログ・
      コントラクト作成 tx で `to` が null）`contractCall` 自体を省略する。
      RPC 呼び出しは既存の `eth_getTransactionByHash` のみで増えない。
    - `handleBlockInclusion`: `decodeReceiptLogs(logs)` を追加し、各
      receipt の `logs`（Issue #160 で取得済み）を、ログごとの発行元
      （`log.address`。tx の `to` ではなく、tx が呼び出した先の別コントラクト
      が発したイベントもありうるため）でカタログ照合し
      `decodeContractEvent` を呼ぶ。結果を `TxInclusionDetail.
      contractEvents` として `recordInclusion` に渡す。RPC 呼び出しは
      既存の `eth_getBlockReceipts` のみで増えない。

- 決定事項・注意点（次の担当・レビューが知っておくべきこと）:
  - **`contractCall` を付ける条件は「宛先がカタログ照合済み」の場合のみ**。
    宛先が観測はされているが未カタログ（`ContractTracker.get()` は返るが
    `catalogKey` が無い「未知のコントラクト」）の場合も `contractCall` は
    省略する（`rawFunctionId` すら付けない）。ARCHITECTURE.md の
    「宛先が追跡中のコントラクトなら…復号する」という記述をこのように
    解釈した。理由: ABI が無ければ `rawFunctionId` 自体は input から
    機械的に切り出せるが、それを表示する意味は薄く、フロントは既に
    `to`/`ContractEntity.address` の照合で「コントラクト宛て」の判定が
    できる設計（ARCHITECTURE.md の既存記述）なので、中途半端な情報を
    足さない判断にした。`rawFunctionId`/`rawEventId` フォールバックが
    実際に使われるのは「宛先/発行元はカタログ照合済みだが、呼ばれた
    関数/発生したイベント自体がその ABI に無い（バージョン不一致・
    別インターフェースの呼び出し等）」場合に限られる。
  - **イベントログはログの発行元ごとに個別にカタログ照合する**
    （tx 全体の `to` ではなく `log.address`）。1つの tx が呼び出した
    コントラクトが、さらに別のコントラクトを呼び出してイベントを
    発することがあるため（例: token 経由の別コントラクト呼び出し）。
  - **`input`/`data` の先頭4バイト判定は正規表現
    `/^0x[0-9a-fA-F]{8,}$/` で行う**。`"0x"` ちょうど（純粋な value
    送金）や4バイト未満は「関数呼び出しではない」として `contractCall`
    自体を省略する。この判定は catalogEntry の有無より前に行うため、
    カタログ照合済みの宛先への value 送金（例: `receive()`）でも
    `contractCall` は付かない。
  - **viem のバージョン挙動を実測で確認した**（`viem@2.54.2`。
    `decodeFunctionData`/`decodeEventLog`/`encodeFunctionData`/
    `encodeEventTopics` で往復させて確認）:
    - `decodeFunctionData` の `args` は ABI の入力の名前有無に関わらず
      常に配列（位置指定）で返る
    - `decodeEventLog` の `args` は、その event の全入力に名前が
      揃っていればオブジェクト（名前指定）、1つでも無名（`name: ""`）が
      あれば配列で返る
    - 引数なし関数/イベントは `args: undefined` で返る
    - デコード失敗時は `AbiFunctionSignatureNotFoundError` /
      `AbiEventSignatureNotFoundError` / `AbiEventSignatureEmptyTopicsError`
      （いずれも `Error` のサブクラス）を投げる。`decode.ts` はこれらを
      具体的な内容と共にログしたうえで raw フォールバックへ倒す
    - これらの前提が変わりうるため、`toDecodedArgs()` は配列・オブジェクト
      どちらの形でも動くように書いてあり、将来の viem バージョンアップで
      挙動が変わっても壊れにくい
  - `packages/shared` の型定義（`ContractCall`/`ContractEvent`/
    `DecodedArgument`）は変更していない（既に Issue #159/#161 の設計時に
    確定済みの型をそのまま使用）。

- テスト:
  - `eth-rpc-client.test.ts`: 既存の `getTransactionByHash` のテストに
    `input` フィールドの期待値を追加し、新たに `input` 正規化の
    describe（+3件: フィールド欠落時のデフォルト、非文字列時の
    デフォルト、フルの呼び出しデータの素通し）を追加。
  - `decode.ts` 用の単体テスト `decode.test.ts`（新規、16件）:
    `decodeContractCall` は named引数の復号・無名引数の `argN`
    フォールバック・引数なし関数・セレクタ不一致時の `rawFunctionId`
    フォールバック（ログ確認込み）・`"0x"`/短すぎる input での `undefined`・
    小文字 input での復号・巨大 `uint256` の精度保持を確認。
    `decodeContractEvent` は named引数の復号・単一 indexed 引数のみの
    イベント・未カタログ発行元での `rawEventId` フォールバック・
    signature 不一致時のフォールバック（ログ確認込み）・匿名イベント
    （空 `topics`）で `rawEventId` 自体を省略することを確認。
  - `contracts.test.ts`: `getCatalogEntry` の describe を追加（+5件）:
    カタログ照合済みコントラクトでの取得、casing 正規化、未追跡・
    未カタログ・カタログ自体が無い場合の `undefined`。
  - `transactions.test.ts`: `contractCall`/`contractEvents` 反映の
    describe を追加（+7件）: pending 時の `contractCall` 付与・省略、
    inclusion での `contractCall` の引き継ぎ、pending を経ない tx には
    付かない制約の固定、`contractEvents` の反映・空配列時の省略・
    未指定時の省略・reorg（別ブロックへの付け替え）時に古い
    `contractEvents` を引き継がず新しい値で置き換わること。
  - `contract-decode.test.ts`（新規、6件）: `EthereumAdapter` を通した
    end-to-end 統合テスト。pending tx の関数呼び出し復号（カタログ照合済み
    宛先）、未カタログ宛先での `contractCall` 省略、ブロック取り込みでの
    イベント復号（カタログ照合済み発行元）、未カタログ発行元での
    `rawEventId` フォールバック、カタログ自体が無い（読み込み失敗）
    縮退時に両方とも一切付かないこと、デコード配線を追加してもデプロイ
    検知（`subscribeContracts`）自体は既存どおり機能すること（回帰
    ガード）を確認。
  - `pnpm --filter @chainviz/collector build`・
    `pnpm --filter @chainviz/collector test`（896件全て成功）・
    `pnpm lint` で確認済み。

### 2026-07-07 テスト強化（chainviz-tester）

実装担当の基本テストを土台に、異常系・境界値・発行元ごとのABI選択の
観点でテストを追加した。実装ロジックは変更していない。

- `decode.test.ts`（16件 → 21件）:
  - `decodeContractCall`:
    - bool 引数を `"true"`/`"false"` へ文字列化する（`stringifyArgValue`
      の boolean 分岐。従来未カバー）。
    - 配列引数（`uint256[]`）を JSON 文字列化し、ネストした各要素の
      bigint 精度を保つ（`stringifyArgValue` の `JSON.stringify`
      bigint-replacer 分岐。従来未カバー。ネストした引数構造への備え）。
    - セレクタは ABI に一致するが引数のバイト列が不正（短すぎる）場合、
      viem が `AbiDecodingDataSizeTooSmallError` を投げるため
      `rawFunctionId` へフォールバックする（ログ確認込み。「引数の型が
      一致しない input」への対応確認）。
    - セレクタ長のプレフィックスの後に非16進文字が続く input は、
      セレクタ抽出の段階で「関数呼び出しではない」と判定して
      `contractCall` 自体を省略する（`rawFunctionId` も積まない）。
  - `decodeContractEvent`:
    - `topics[0]` は既知イベント（Transfer）と一致するが `data` が不正
      （非 indexed 引数分が空）な場合、viem が `DecodeLogDataMismatch` を
      投げるため `rawEventId` へフォールバックする（従来は「未知の
      topic0」でのフォールバックのみカバーしていた）。
  - 上記の検証用に、テスト内の模擬 ABI へ `setFlag(bool)` と
    `batchMint(uint256[])` を追加した（実物の ChainvizToken/Counter には
    無い形だが、復号ロジックの分岐を網羅するため）。
- `contract-decode.test.ts`（6件 → 8件、`EthereumAdapter` 統合）:
  - 同一 tx の receipt に、カタログ照合済みトークンが発した Transfer と
    未知コントラクトが発したログが混在する場合、`decodeReceiptLogs` が
    `tx.to` ではなく各 `log.address` ごとにカタログを引くため、片方は
    復号・片方は `rawEventId` フォールバックになること（発行元アドレス
    ごとの正しい ABI 選択）を確認。
  - pending を経ず直接ブロック取り込みだけを観測した tx（カタログ照合済み
    宛先）で、`contractCall` は付かない一方 receipt.logs からの
    `contractEvents` は付くこと（ARCHITECTURE.md §4 の制約を統合レベルで
    確認）。
- lint 確認: `pnpm lint`（eslint）はクリーン。実装担当が報告した
  prettier 警告は、`prettier --check` でパッケージ配下 86 ファイルが
  非準拠（本 Issue と無関係な `blocks.ts`/`classify.ts` 等も含む）で
  あることから、リポジトリ全体で prettier が適用されていない既存状態と
  確認した。prettier は `pnpm lint` にも pre-push フックの
  `pnpm lint && pnpm build && pnpm test` にも含まれず（root の別スクリプト
  `format` 扱い）、強制ゲートではない。今回の変更で新たな eslint 違反は
  生じていない。
- `pnpm --filter @chainviz/collector test`（903件全て成功）・
  `pnpm --filter @chainviz/collector build`・`pnpm -r build`・`pnpm lint`
  で確認済み。

### 2026-07-07 レビュー（chainviz-reviewer）

- 担当: reviewer
- ブランチ: issue-162-decode-calls-events（レビュー時点で未コミット）
- 判定: **1点差し戻し**（下記「要修正」）。それ以外の観点は全て問題なし。

#### 確認して問題なかった点

- **ChainAdapter境界**: ABI（viem への依存含む）は `catalog.ts` /
  `decode.ts` / `contracts.ts`（いずれもアダプタ配下）に閉じており、
  `TransactionEntity` に載るのはチェーン非依存の文字列
  （`functionName` / `eventName` / `DecodedArgument {name, value}` /
  raw 識別子）のみ。`DecodedArgument.value` は BigInt を 10 進文字列化して
  精度を保っており、shared の型コメントの意図どおり。
- **RPC 呼び出し回数**: `input` は既存の `eth_getTransactionByHash` の
  正規化拡張、`logs` は既存の `eth_getBlockReceipts` のレスポンス利用で、
  新規の RPC 呼び出しは無い。統合テストのスタブが想定外メソッドで例外を
  投げる作りになっており、回数増加への回帰ガードも効いている。
- **エラーハンドリング**: viem のデコード例外は `decodeContractCall` /
  `decodeContractEvent` の try/catch で捕捉し、どのセレクタ/シグネチャが
  どのコントラクトで復号できなかったかを `console.warn` で具体的に
  ログしたうえで raw 識別子へ縮退する。「握りつぶし」ではなく意図された
  縮退であり、ログ出力自体もテストで検証されている。
  `eth-rpc-client.ts` の `input` 欠落・非文字列 → `"0x"` フォールバックも
  コメント・テストともに妥当。
- **発行元ごとの ABI 選択**: `decodeReceiptLogs` は tx.to ではなく各
  `log.address` で `getCatalogEntry` を引いており、カタログ済み/未知の
  ログが 1 receipt に混在するケースの統合テストもある。
- **pending 無しでの部分反映**: `recordInclusion` は `contractCall` を
  再計算せず既存値の引き継ぎのみ（ARCHITECTURE.md §4 の制約どおり）。
  単体・統合の両方でテストされている。
- **既知の限界（token 残留）への影響**: `contracts.ts` の変更は読み取り
  専用の `getCatalogEntry` 追加のみで、`applyCatalog` 経路には触れて
  いない。影響なし。
- **ビルド・lint・テスト**: `pnpm lint` / `pnpm build` / `pnpm test` を
  リポジトリ全体で実行し全て成功（collector 903 / frontend 791 /
  shared 40 / e2e 34 件）。
- **テストの質**: 異常系（malformed data で viem が投げる系・非16進
  input・カタログ無し縮退）・境界値（4バイト未満・空 topics・空配列）・
  回帰ガード（デプロイ検知の継続）まで具体的で、実装の詳細をなぞるだけの
  無意味なテストは見当たらない。

#### 要修正（差し戻し1点）

- **追跡中だが未カタログのコントラクト宛て tx に `contractCall` が
  一切付かず、`rawFunctionId` も載らない**。worklog の決定事項として
  「表示する意味は薄い」と記録されているが、以下と矛盾する:
  - Issue #162 本文: 「復号不能時はrawFunctionId/rawEventIdを載せる」
  - `docs/ARCHITECTURE.md` §6.4（未知のコントラクトカード）:
    「アクティビティチップは `rawFunctionId` / `rawEventId` の短縮表示
    （6.6）」— 現実装では未知コントラクト宛ての呼び出しに
    `rawFunctionId` が存在しないため、このフロント設計が実現不可能になる
  - イベント側との非対称: 同じ未知コントラクトでも、発したイベントは
    `rawEventId` 付きで載る（`decodeContractEvent` は
    `catalogEntry: undefined` を受け付ける）のに、そこへの呼び出しは
    何も載らない
- 修正の方向性（提案）: `decodeContractCall` をイベント側と対称に
  `catalogEntry: CatalogEntry | undefined` を受け付ける形にし、
  undefined なら（セレクタがあれば）`{contractAddress, rawFunctionId}`
  を返す。`index.ts` の `resolveContractCall` は「宛先が追跡中の
  コントラクトか」を `contractTracker.get(to)` で判定し、追跡中なら
  カタログ有無に関わらず復号を試みる（未追跡の宛先＝EOA 等は従来どおり
  `contractCall` を省略）。対応するテスト（未カタログ宛先 →
  `rawFunctionId` 付与）も追加すること。既存テスト
  `omits contractCall for a pending tx addressed to a non-cataloged
  destination`（contract-decode.test.ts）は「未追跡の EOA 宛て」を
  検証する形に読み替え可能なので大きな書き換えは不要のはず。

#### 補足（差し戻し対象ではない指摘）

- prettier について: tester 報告の「86 ファイル非準拠は今回の変更に
  起因しない」は概ね正しい（main 時点でも 100 件超が非準拠で、
  `pnpm lint` は eslint のみ、pre-push フックにも prettier は含まれず
  強制ゲートではない）が、今回新規追加した 3 ファイル
  （`decode.ts` / `decode.test.ts` / `contract-decode.test.ts`）自体も
  `prettier --check` 非準拠である点は報告と異なる。ゲート違反ではない
  ため差し戻し対象にはしないが、記録として残す。
- コミット粒度: レビュー時点で全変更が未コミット。コミット時は
  「1つの変更内容 = 1コミット」（例: rpc-client の input 追加 /
  decode.ts と配線 / tracker への反映 / テスト強化 / docs 更新）に
  分けること。

### 2026-07-07 差し戻し対応（collector）

- 担当: collector
- ブランチ: issue-162-decode-calls-events（未コミット）
- 対応内容: レビュー差し戻し1点（追跡中だが未カタログのコントラクト宛て
  tx に `contractCall`/`rawFunctionId` が一切付かない非対称）を、reviewer
  の提案どおりに修正した。

- 修正前に、指摘された不具合を再現する統合テストを
  `contract-decode.test.ts` に追加し（デプロイは検知するが
  `registerContractDeployment` を呼ばない「追跡中・未カタログ」の宛先へ
  `transfer` セレクタ付き input の pending tx を送るケース）、修正前の
  コードで実際に失敗する（`contractCall` が `undefined` になる）ことを
  確認したうえで、修正を適用してテストが通ることを確認した。

- 実装内容:
  - `packages/collector/src/adapters/ethereum/decode.ts`:
    - `decodeContractCall` の第1引数を `CatalogEntry` から
      `CatalogEntry | undefined` に変更。セレクタが抽出できた場合、
      `catalogEntry` が `undefined` なら `decodeContractEvent` と対称に
      `{contractAddress, rawFunctionId}` を返すようにした（従来は
      `catalogEntry.abi` へのアクセスで呼び出し前提だったため、
      呼び出し元がカタログ有無を先に判定する必要があった）。
    - デコード失敗時のフォールバック（`{contractAddress, rawFunctionId}`）
      と `catalogEntry` 未指定時のフォールバックを同一の `fallback`
      変数にまとめ、二重定義を避けた。
  - `packages/collector/src/adapters/ethereum/index.ts`:
    - `resolveContractCall` の判定を `contractTracker.getCatalogEntry(to)`
      の有無から `contractTracker.get(to)`（= 追跡中の `ContractEntity` が
      存在するか）の有無に変更。追跡中であれば `getCatalogEntry` の結果
      （カタログ未照合なら `undefined`）をそのまま `decodeContractCall`
      に渡す。未追跡（通常の EOA 宛てなど）の場合のみ `contractCall`
      自体を省略する。
    - `resolveContractCall`・`handlePendingTx` のコメントを新しい判定基準
      に合わせて更新。

- 動作の変化（整理）:
  - 追跡すらされていない宛先（EOA 等）: 従来どおり `contractCall` 自体を
    省略。
  - 追跡中だがカタログ未照合（未知のコントラクト）: 従来は
    `contractCall` を一切付けなかったが、修正後はセレクタが抽出できれば
    `{contractAddress, rawFunctionId}` を付ける（`decodeContractEvent` と
    対称）。
  - 追跡中かつカタログ照合済み: 従来と変わらず（デコード成功なら
    `functionName`/`args`、失敗なら `rawFunctionId`）。
  - `packages/shared` の型定義（`ContractCall`）は変更していない。
    `contractAddress` のみ・`rawFunctionId` のみ・`functionName`/`args`
    ありのいずれの形も既存の型定義がそのまま許容する。

- テスト:
  - `decode.test.ts`: `decodeContractCall` に `catalogEntry` が
    `undefined` の場合のテストを2件追加（セレクタありで
    `rawFunctionId` を返すこと、`"0x"` では従来どおり `undefined` を
    返すこと）。
  - `contract-decode.test.ts`:
    - 既存の「非カタログ宛先で `contractCall` を省略する」テストを
      「追跡すらされていない（EOA）宛先」であることが分かるようテスト名・
      コメントを修正（挙動・アサーションは変更なし）。
    - 新規テスト「デプロイは検知したが `registerContractDeployment` を
      呼んでいない（追跡中・未カタログ）宛先への pending tx に、
      `rawFunctionId` のみを持つ `contractCall` が付く」ことを確認する
      テストを追加。
  - `pnpm lint && pnpm --filter @chainviz/collector build && pnpm --filter
    @chainviz/collector test` を実行し、全て成功（906件、修正前は903件 +
    今回追加した新規失敗テスト1件で確認したのち修正）。既存テスト
    （`decode.test.ts`/`contract-decode.test.ts`/`contracts.test.ts`
    含む）に破壊的変更なし。

### 2026-07-07 再レビュー（chainviz-reviewer）

- 担当: reviewer
- ブランチ: issue-162-decode-calls-events（再レビュー時点で未コミット）
- 判定: **合格**（差し戻し1点は解消済み）。ただしコミット前に下記
  「軽微な指摘」1点（コメントのみ・ロジック変更不要）を修正すること。
  修正後の再レビューは不要。

#### 確認した内容

- **差し戻し点の解消**: `decode.ts` の `decodeContractCall` が
  `CatalogEntry | undefined` を受け付け、undefined ならセレクタ抽出
  時点で `{contractAddress, rawFunctionId}` を返す。`index.ts` の
  `resolveContractCall` は判定を `getCatalogEntry(to)` の有無から
  `contractTracker.get(to)`（追跡中か）の有無に変更しており、
  「追跡中だが未カタログの宛先に rawFunctionId が載らない」問題は
  解消している。`docs/ARCHITECTURE.md` の記述（211行「追跡中の
  コントラクト宛てで、入力データを観測できた場合のみ」、453行
  「宛先が追跡中のコントラクトならカタログの ABI で復号する」、
  §6.4 の rawFunctionId チップ）とも一致する。
- **イベント側との対称性**: `decodeContractCall` / `decodeContractEvent`
  とも「catalogEntry 無し → raw 識別子のみの fallback を返す」同じ
  構造になった（call 側のみ「セレクタ自体が無ければ undefined =
  contractCall 省略」という追加の入口判定があるが、これは value 送金を
  関数呼び出し扱いしないための意図された差で、docstring にも明記あり）。
- **既存挙動の維持（未追跡宛先）**: 未追跡の宛先（EOA 等）では
  `resolveContractCall` が `contractTracker.get(to)` で弾き、従来どおり
  `contractCall` を省略する。統合テストでは「EOA 宛て・input 0x」
  （contract-decode.test.ts 218行）に加え、「未追跡宛先・セレクタ付き
  input で contractCall が付かない」ことがカタログ無し縮退テスト
  （同 505行。宛先の tokenAddress はデプロイ未観測 = 未追跡）で
  実質的にガードされていることを確認した。
- **テストが元の不具合を検出できることの確認（変異テスト）**:
  `resolveContractCall` を一時的に修正前のロジック（`getCatalogEntry`
  の有無で判定）へ書き戻して contract-decode.test.ts を実行し、
  新規テスト「attaches rawFunctionId for a pending tx to a tracked but
  non-cataloged (unknown) contract」が実際に失敗する（contractCall が
  undefined になる）ことを確認したうえで、ファイルを完全復元した
  （sha256 で復元一致を確認）。collector 報告の「修正前に失敗する
  ことを確認した」は再現できた。
- **ビルド・lint・テスト**: リポジトリ全体で `pnpm lint` / `pnpm build` /
  `pnpm test` を実行し全て成功（collector 906 / frontend 791 /
  shared 40 / e2e 34 件）。
- **shared 型**: 変更なし。`ContractCall` の既存型が rawFunctionId のみの
  形をそのまま許容することを確認。

#### 軽微な指摘（コミット前に修正すること・再レビュー不要）

- `packages/collector/src/adapters/ethereum/transactions.ts` の
  `TxDetail.contractCall` の doc コメントが差し戻し前の仕様のまま:
  「この tx がカタログ照合済みコントラクト宛ての関数呼び出しであると
  アダプタが判定・復号できた場合」「宛先が未追跡・未カタログ、または
  input に関数セレクタが無い場合は省略する」。修正後は追跡中であれば
  未カタログでも rawFunctionId のみの contractCall が付くため、
  「カタログ照合済み」「未カタログ…は省略」の記述が実装と矛盾する。
  コメントを「宛先が追跡中のコントラクトで…宛先が未追跡、または
  input に関数セレクタが無い場合は省略」の趣旨に更新すること。
  他ファイルのコメント（index.ts / decode.ts / contracts.ts）は
  新仕様に更新済みであることを確認した。

#### 前回からの引き継ぎ（再掲・変更なし）

- コミット粒度: 全変更が未コミットのままなので、コミット時は
  「1つの変更内容 = 1コミット」に分けること（前回レビューの補足参照）。
- prettier 非準拠は強制ゲート外のため差し戻し対象にしない（前回記録
  どおり）。

### 2026-07-07 QA検証（chainviz-qa）

- 担当: qa
- ブランチ: issue-162-decode-calls-events（QA時点で未コミット）
- 判定: **合格**（Issue #162の完了条件をすべて満たしていることを確認）。

#### 検証方法と制約

Issue #161のQA検証時と同じ制約に遭遇した。collectorの
`node-lifecycle.ts` は `composeProject` が `"chainviz-ethereum"` に
ハードコードされており（`DEFAULTS`。`index.ts` の `main()` でも環境変数
での上書き経路が無い）、独立したdocker composeプロジェクト名で立てた
スタックはcollectorのコンテナ探索・ワークベンチ操作（`runWorkbenchOperation`）
の対象から外れる。このため、タスク手順3〜7（独立プロジェクトで
`deployContract`/`callContract`をGUI経由で実行し、実配信のworld-stateを
確認する）を本番スタックに触れずに実施することはできない。Issue #161の
QAで合意された代替方針（統合テストでの検証）に従い、以下で判定した。

#### 実施した検証

- **lint/build/test の独立実行**: 対象worktreeで `pnpm lint && pnpm build
  && pnpm test` を実行し全て成功（collector 906 / frontend 791 /
  shared 40 / e2e 34、いずれも0失敗）。
- **統合テスト（contract-decode.test.ts）の内容確認**: `EthereumAdapter`
  の実購読経路（`subscribeTransactions` の pending/inclusion ハンドラ）を
  通して、完了条件の4項目がすべてカバーされていることを確認した。
  各テストは viem の `encodeFunctionData`/`encodeEventTopics` で生成した
  実データを流し、`resolveContractCall`（`contractTracker.get(to)` で
  追跡判定 → `getCatalogEntry` を `decodeContractCall` に渡す）・
  `decodeReceiptLogs`（`log.address` ごとに `getCatalogEntry`）の配線を
  経由している:
  - カタログ照合済みコントラクト宛ての `transfer` → `contractCall`
    （`functionName: "transfer"`、引数 `to`/`amount` 付き）
  - カタログ照合済みコントラクト発の `Transfer` ログ → `contractEvents`
    （`eventName: "Transfer"`、引数 `from`/`to`/`value` 付き）。同一 tx の
    inclusion 経路で付与されること・混在receiptで発行元ごとにABIを引き
    分けることも確認
  - 追跡中だが未カタログ（`registerContractDeployment` 未実施）の宛先 →
    `rawFunctionId` のみ（今回のレビュー差し戻しで修正された非対称の解消）
  - 未追跡の宛先（EOA、input `0x`）→ `contractCall` が付かない
- **実カタログABIによる復号ロジックの実動作確認**: `profiles/ethereum/
  contracts/catalog.json`（マージ済みの本物のChainvizToken/Counter ABI）を
  読み込み、ビルド済み `dist/adapters/ethereum/decode.js` の
  `decodeContractCall`/`decodeContractEvent` へ viem で生成した実データを
  流す独立スクリプトを実行し、以下7項目がすべてPASSすることを確認した
  （テスト内の手書きサブセットABIではなく、実配布されるABIでの確認）:
  1. `transfer(to, 1000)` → `functionName: "transfer"`、引数 `to`/`amount`
  2. `Transfer(from, to, 1000)` → `eventName: "Transfer"`、引数 `from`/`to`/`value`
  3. `catalogEntry` undefined（追跡中・未カタログ相当）→ `rawFunctionId` のみ
  4. input `0x`（value送金）→ `undefined`（contractCall省略）
  5. カタログ照合済みアドレスへの未知セレクタ → `rawFunctionId` フォールバック
     （`console.warn` で具体的なセレクタ・アドレスをログしてから縮退）
  6. `uint256` 最大値（2^256-1）の精度が10進文字列で保持される
  7. Counter の `increment()`（引数なし）→ `functionName` と空 `args`
  検証スクリプトは検証後に削除済み（成果物として残していない）。

#### 後片付け

- 独立docker composeスタックは上記制約により起動しなかった（本番スタックにも
  一切触れていない。検証中に稼働中コンテナは0件だった）。一時検証スクリプトは
  削除済み。scratchpad以外に成果物は残していない。

#### 完了条件の判定

Issue #162本文の4条件（カタログ照合済み宛ての関数呼び出しが関数名・引数
付きで反映／同コントラクト発イベントがイベント名・引数付きで反映／追跡中・
未カタログ宛ては `rawFunctionId` のみ／未追跡宛てには `contractCall` 自体が
付かない）を、統合テスト・実カタログABIでの実動作確認の両方で満たすことを
確認した。docker/GUI経由のend-to-end確認は `composeProject` ハードコードの
既知制約により代替したが、判定に迷う要素は無いため合格とする。
