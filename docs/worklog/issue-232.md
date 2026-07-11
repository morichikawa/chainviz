### 2026-07-11 Issue #232 確定時のコントラクトへのパルス/フラッシュがアドレス表記の食い違いで発火しない(設計メモ)

- 担当: frontend
- ブランチ: issue-232-flash-address-match

#### 設計メモ(着手前)

**原因**: Issue #201 で `deployEdge.ts` の `deployEdgesToFlowEdges` に見つけた
のと同型のバグが、以下の2箇所に残っている。

- `packages/frontend/src/entities/contractCallPulseEdge.ts` の
  `buildContractCallPulseEdge`: `presentWalletIds.has(fromWalletAddress)` が
  単純な文字列一致(`Set.has`)で判定している。
- `packages/frontend/src/entities/useContractSettlementEffects.ts`: 呼び出し側
  で `presentWalletIds.has(event.fromAddress)` を事前条件として使い、これが
  falseだと `buildContractCallPulseEdge` を呼ばずにフラッシュのみへフォール
  バックしてしまう(この事前チェック自体が同じ理由で常にfalseになる)。

`ContractEntity.deployerAddress` / `TransactionEntity.from` はチェーン側の
生の表記(Ethereumアダプタでは全小文字)である一方、`WalletEntity.address`
(=`presentWalletIds`の中身。App.tsxで`walletNodes.map(n => n.id)`から作る)
はmnemonicからviemで導出したEIP-55チェックサム表記になりうる
(`wallet-derivation.ts`参照)。単純な`Set.has`では常に不一致になり、
ウォレット→コントラクトのパルスエッジが一切描画されず、
`useContractSettlementEffects.ts`の「ウォレット不在」フォールバック
(フラッシュのみ)に常に落ちる。

**修正方針**: `deployEdge.ts`で採用した「小文字キーで正規化して照合し、
キャンバス上に実在する側(present側)の表記をエッジの端点として使う」方針を
そのまま適用する。ただし今回は同じ照合パターンが3ファイル目
(`contractCallPulseEdge.ts`)にも増えることになるため、今後また特定の
1箇所だけ直して他を直し忘れる(今回のIssue自体がその再発)ことを防ぐ目的で、
照合ロジックを共通ヘルパー
`packages/frontend/src/entities/addressCasing.ts` に切り出す
(`resolvePresentId`: 単発の照合、`buildLowerCaseIndex`: 複数件を照合する
ときに使う索引作成)。

- `contractCallPulseEdge.ts`の`buildContractCallPulseEdge`は
  `resolvePresentId`を使い、fromWalletAddress・contractAddressの両方を
  present側の表記に解決してからエッジを組み立てる(表記がずれたままだと
  React Flowがノードを解決できずエッジを描画できないため)。
- `useContractSettlementEffects.ts`は、`buildContractCallPulseEdge`自身が
  存在チェック(nullを返す)を行うようになるため、呼び出し側の
  `presentWalletIds.has(event.fromAddress)`という重複した事前チェックを
  削除し、常に`buildContractCallPulseEdge`を呼んでnullなら
  フラッシュのみにフォールバックする形に単純化する。
- `deployEdge.ts`の`deployEdgesToFlowEdges`は既存のインライン実装を
  `buildLowerCaseIndex`を使う形にリファクタリングする(動作は変えない。
  既存テストがそのまま回帰確認になる)。挙動を変えない純粋なリファクタ
  リングなので、バグ修正2件とは別コミットに分ける。

**確認方法**: 修正前に、大文字小文字が食い違うアドレスでのテストケースを
`contractCallPulseEdge.test.ts`と`useContractSettlementEffects.test.tsx`に
追加し、実際に現在の実装で失敗する(パルスが作られない/描画されない)ことを
確認してから修正する。

#### 実装後の記録(2026-07-11)

設計メモどおりに実装した。

**再現の確認**: `contractCallPulseEdge.test.ts`に
「wallet/contractアドレスの表記がpresent側と大文字小文字だけ違う場合」の
2ケース、`useContractSettlementEffects.test.tsx`に「tx.fromが小文字・
presentWalletIdsがチェックサム表記の場合にパルスエッジが張られる」1ケースを
先に追加し、修正前の実装でこれら3ケースがすべて失敗すること
(`buildContractCallPulseEdge`がnullを返す/`pulseEdges`が空のまま)を確認
した。

**実装内容**:

- `packages/frontend/src/entities/addressCasing.ts`(新規): 大文字小文字を
  無視した照合の共通ヘルパー。`resolvePresentId`(単発の照合。present側の
  元の表記を返す)と`buildLowerCaseIndex`(複数件を照合するための索引作成)
  の2関数。
- `packages/frontend/src/entities/contractCallPulseEdge.ts`:
  `buildContractCallPulseEdge`を`resolvePresentId`を使う実装に変更。
  `fromWalletAddress`・`contractAddress`の両方をpresent側の表記に解決して
  からエッジを組み立てるようにした(自己ループ判定も解決後の表記同士で
  比較するよう調整)。
- `packages/frontend/src/entities/useContractSettlementEffects.ts`:
  呼び出し側にあった`presentWalletIds.has(event.fromAddress)`という
  大文字小文字を無視しない重複の事前チェックを削除。存在判定は
  `buildContractCallPulseEdge`自身(nullを返す)に一本化した。
- `packages/frontend/src/entities/deployEdge.ts`: 既存のインライン実装
  (小文字キーのMapをその場で構築)を`buildLowerCaseIndex`を使う形に
  リファクタリング(動作は変えていない。既存のIssue #201向けテストが
  そのまま回帰確認になっている)。

**テスト**: 上記の再現テスト3件に加えて`addressCasing.ts`用の新規テスト
(`addressCasing.test.ts`、8件)を追加。修正後、全て green になることを
確認した。

**確認結果**:

- `pnpm --filter @chainviz/frontend test`: 113ファイル / 1744件、全green
  (新規8件・拡張4件を含む)。
- `pnpm --filter @chainviz/frontend build`(`tsc -b`): エラーなし。
- 変更対象ファイルへの`eslint`: 警告・エラーなし。

**次の担当が知っておくべきこと**: アドレス表記の食い違い吸収ロジックは
今後`addressCasing.ts`に集約する方針にした。新たにウォレット/コントラクト
アドレスをキャンバス上のIDと照合する処理を書く場合は、都度
`Set.has`で比較するのではなくここの`resolvePresentId`/
`buildLowerCaseIndex`を使うこと(今回のIssueが「1箇所直しても他の同型箇所
を直し忘れる」という再発だったため)。

#### テスト強化の記録(2026-07-11)

実装担当が書いた基本テストに、異常系・境界値の観点で以下のケースを追加した
(全て追加のみ。実装コードは変更していない)。

- `addressCasing.test.ts`(+6件):
  - `resolvePresentId`: 空文字idと空文字present entryの一致/非一致、
    前後空白を正規化しないこと(大文字小文字のみ吸収する責務境界の明確化)、
    大文字小文字だけ違う重複がpresentにある場合に走査順で最初の一致を返す
    こと(`buildLowerCaseIndex`の「後勝ち」と解決順が逆になる点を明示)。
  - `buildLowerCaseIndex`: 空文字idの索引化、前後空白を正規化せず空白違いが
    別キーとして共存すること。
- `contractCallPulseEdge.test.ts`(+4件):
  - コントラクト側がcaseを無視しても一致しない場合のnull(casing修正が
    「存在しない端点」ガードを弱めていないことの回帰)、両端点が不在の場合の
    null、wallet/contractが大文字小文字だけ違う同一アドレスのとき解決後の
    表記同士で自己ループと判定されること、前後空白のずれは一致しないこと。
- `deployEdge.test.ts`(+3件): リファクタリング(buildLowerCaseIndexへの
  切り出し)の等価性確認。1回の呼び出しで複数コントラクトに単一の索引を
  再利用しても従来と同じ端点解決になること、入力コントラクトの順序が出力
  エッジに保存されること、正規化されるのはdeployer(source)側だけで
  コントラクトtargetは生の表記を保つ非対称性の回帰。
- `useContractSettlementEffects.test.tsx`(+2件): 呼び出し側の重複事前
  チェック削除後の回帰。present集合が空でなくてもcaseを無視して一致しない
  ウォレットしか無ければフラッシュのみにフォールバックすること、その
  フォールバックのフラッシュがpulse duration を待たずadvance(0)時点で
  即座に当たること。

**確認結果**:

- `pnpm --filter @chainviz/frontend test`: 113ファイル / 1759件、全green
  (テスト強化で+15件)。
- `pnpm --filter @chainviz/frontend build`(`tsc -b`): エラーなし。
- 追加したテストファイルへの`eslint`: 警告・エラーなし。

#### レビューの記録(2026-07-11)

chainviz-reviewer による静的レビュー。判定: **合格**。

**確認内容**:

- ビルド・lint・テスト: リポジトリ全体で `pnpm build` / `pnpm lint` /
  `pnpm test` すべて成功(exit 0)。テストは shared 62 / e2e 97 /
  collector 1154 / frontend 1759 件、全green。
- コミット粒度: 5コミット(ヘルパー共通化のリファクタ → バグ修正+再現
  テスト → docs → テスト強化 → docs)がそれぞれ単一の関心事になっており、
  Conventional Commits 準拠。リファクタとバグ修正が分かれているのも設計
  メモどおり。
- `deployEdge.ts` のリファクタリング等価性: 旧実装(インラインで
  「小文字→元の表記」Mapを構築。後勝ち)と `buildLowerCaseIndex`(同じく
  後勝ち)は意味的に同一で、動作不変。既存の Issue #201 テストに加えて
  テスト強化で等価性の回帰テスト(索引の再利用・順序保存・source側のみ
  正規化する非対称性)も追加されている。
- 境界の遵守・shared型: 変更はすべて frontend 内。`packages/shared` の
  型変更なし。チェーン固有ロジックの新たな漏れなし(コメント中の EIP-55
  への言及は不具合の背景説明で、Issue #201 時点の deployEdge.ts と同様)。
- エラー握りつぶし・環境依存の固定値: 新規の該当なし。`null` 返却は
  ダングリング参照ガードとして docstring に理由が明記され、呼び出し側の
  フラッシュのみフォールバックは ARCHITECTURE.md §6.6 の記述どおり。
- docs: worklog・PLAN.md(チェック+Issueリンク)・WORKLOG.md 索引とも実装
  を正しく反映。ARCHITECTURE.md は §6.6 の記述どおりの動作を回復させる
  修正のため変更不要。

**申し送り事項(衝突解決順の非対称性)への判断**:

`resolvePresentId`(走査順で最初勝ち)と `buildLowerCaseIndex`(後勝ち)の
非対称性は、**実害のないものとして許容**と判断した。理由:

1. 衝突の前提条件が成立しない。present 集合はいずれも単一の表記規約を
   持つソースから作られる — `presentWalletIds` は collector の
   `wallet-derivation.ts`(viem `mnemonicToAccount().address`、常に EIP-55
   表記)由来の `WalletEntity.address`、`presentContractIds` は receipt
   由来の `ContractEntity.address`(アダプタ内で一貫)。同一アドレスが
   大文字小文字違いで重複するには、上流で同一アドレスのエンティティが
   2件できるというそれ自体がバグの状態が必要。
2. 仮に衝突が起きても、どちらのエントリもキャンバス上に実在するノード
   IDなので、どちらへ解決してもエッジは描画可能。差は「どちらの重複
   ノードに繋がるか」だけで、機能不全にはならない。
3. テスト強化で両者の解決順がテストとして明示的に固定されており
   (`addressCasing.test.ts`)、将来挙動を変える場合に気づける。

軽微な指摘(対応任意): `buildLowerCaseIndex` の docstring には「後勝ち」
が明記されているが、`resolvePresentId` 側の docstring には「最初勝ち」の
言及がない(テストのコメントにのみある)。将来この2関数の挙動を揃えたく
なった際の判断材料として、docstring にも一言あるとよい。差し戻し理由
にはしない。

#### QA検証記録(2026-07-11)

chainviz-qa による実機検証。判定: **合格**。

**検証環境**: ブランチ `issue-232-flash-address-match`
(worktree `wt-issue-232`)。

**実施内容**:

- ビルド確認: `pnpm --filter @chainviz/frontend build`(tsc -b)・
  `build:web`(vite本番ビルド)ともエラーなし。`preview` サーバを起動し
  `http://localhost:4319/` が HTTP 200 でアプリ(title=chainviz、
  `id="root"`)を配信することを確認した。
- 既存テスト全数: `pnpm --filter @chainviz/frontend test` が
  113ファイル / 1759件すべて green。
- 独立検証(既存テストの再実行ではなく、QAが別に用意したシナリオで
  実ランタイムの `useContractSettlementEffects` フックを jsdom 上で駆動):
  本番に近い実アドレス対(present側ウォレット=EIP-55チェックサム表記
  `0xA0Cf7988...251e`、tx.from=同一アドレスの全小文字)で、
  ウォレット→コントラクト呼び出しtxが pending→included に確定した際に
  パルスエッジが1本描かれること、その端点 source が present 側の表記
  (チェックサム)で解決されること(React Flowがノードを解決できる表記)、
  パルス完了後にコントラクトへ success フラッシュが当たり
  `TX_SETTLE_FLASH_MS` 後に消えることを確認した。修正前の単純な
  `Set.has(tx.from)` ではこのウォレット集合が一致しない
  (=元Issueの再現条件が成立している)ことも同じテストで確認した。
  検証後、この一時テストファイルは削除済み(リポジトリに残していない)。
- 回帰確認: ウォレット表記が一致するケース(present側・tx.from とも
  全小文字)でも従来どおりパルス+フラッシュが発火することを確認した。

**確認した本番のデータフロー**: `TransactionEntity.from` は JSON-RPC
由来(全小文字)、`ContractEntity.address` と `contractCall.contractAddress`
は collector 側で lowercase 正規化される(`adapters/ethereum/contracts.ts`
の `normalizeAddress`)一方、`WalletEntity.address` は
`wallet-tracker.ts` の viem 導出でチェックサム表記になりうる。つまり本番で
表記が食い違うのはウォレット側のみで、Issue #232 の想定と一致する。
コントラクト側は両端とも小文字で一貫するため食い違わない。

**補足(範囲外の観察、差し戻し理由ではない)**: 検証過程で、コントラクト
アドレスの表記を人為的に食い違わせると `contractSettlement.ts` の
`resolveContractSettlementEvent` 内の `knownContractAddresses.has()` が
case-sensitive のためイベント自体がドロップされる(パルスもフラッシュも
出ない)ことを確認した。ただし上記のとおり本番ではコントラクト側の表記は
一貫して小文字であり、この経路が実データで発火することはない。将来
アダプタがチェックサム表記のコントラクトアドレスを出すようになった場合に
備え、この照合も `addressCasing.ts` に寄せる余地がある(Issue #232 の
範囲外)。

**結論**: 元Issue(アドレス表記の食い違いでコントラクトへのパルス/
フラッシュが発火しない)は解消されている。完了条件を満たす。
