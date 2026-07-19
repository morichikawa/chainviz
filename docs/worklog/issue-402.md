# Issue #402 トランザクション署名・PoS検証(attestation)の操作・処理をわかりやすく可視化する

### 2026-07-18 Issue #402 起票の経緯

- 担当: 統括
- ブランチ: issue-401-402-hash-signature-viz-backlog
- 内容: ユーザーから「何が署名で何が検証という操作・処理なのか全く
  わからない」という要望を受け、現状調査を実施した。Issue #401
  (ハッシュの計算・連結・改ざんの可視化)と同じ流れで発生した追加の
  要望。
- 調査結果:
  - EOAのトランザクション署名(secp256k1): `docs/ARCHITECTURE.md` §6.11
    (Issue #212)とglossary `signature`用語で説明済み。
    `TxLifecyclePopover.tsx`がtxライフサイクルの第1段階として表示する。
    ただし署名自体はcollectorが観測できないため常に完了扱いの事後表示で、
    「今署名中」という進行状態は意図的に表現しない設計。collector側は
    `ecrecover`等で署名者を復元せず、`eth_getTransactionByHash`が返す
    RPCの`from`をそのまま信頼している(`eth-rpc-client.ts`)。つまり
    「署名の検証」というプロセス自体はcollector・UIどちらにも存在しない
  - PoSバリデータのattestation(投票・証明): glossary `validator`用語と
    ARCHITECTURE.md §7.6.11(Issue #285)で「validator→beacon」の接続
    関係は説明されているが、attestation自体(投票内容・成否・スロット
    単位の証明)は可視化対象外(「validatorは自身のチェーンコピーを
    持たないため同期状態・ブロック高は表示しない」と明記)
  - Engine API経由のCL→EL検証: glossaryにEngine APIの説明はあるが、
    ブロック妥当性検証プロセス自体の可視化は無い
- ユーザーの意向により、Issue #401とは別Issueとして起票しつつ、同じ
  chainviz-uxに一括して検討させる方針(AskUserQuestionで確認)。

### 2026-07-19 Issue #402 UX設計メモ(署名・検証デモ「署名と検証のしくみ」)

- 担当: ux
- ブランチ: issue-402-signature-verification-viz
- 内容: モックデータ環境(`pnpm --filter @chainviz/frontend dev`)で、
  ワークベンチの送金操作パネル(宛先・金額の入力)と、txチップの
  ライフサイクルポップオーバー(署名→送信→mempool→ブロック取り込み)を
  実際に操作して確認したうえで、Issue #401 で設計した共通骨格
  (編集できる入力 → 実アルゴリズムを明示した処理帯 → 導出値 →
  検証バッジ → 影響伝播 → リセット → 誰がやるかの説明)を署名・検証に
  適用するUX設計をまとめた。以下が実装担当(chainviz-frontend)への
  引き継ぎ内容。**実装は Issue #401 の改ざんデモ(crypto-demo/ の共通
  部品)の完了後に着手すること**(部品を再利用するため)。

#### 1. スコープの絞り込み: 「検証」の3つの意味のうちどれを扱うか

Ethereum の文脈で「署名」「検証」は少なくとも3つある。扱いを次のとおり
絞り込む:

1. **EOA の tx 署名と、その検証(ecrecover)** → **インタラクティブな
   デモの主題にする**。理由:
   - ユーザーは送金操作(ワークベンチの操作パネル)を既に体験している。
     つまり**知らないうちに「署名」を毎回やっている**。デモはこの既存
     体験の裏側を開けて見せる位置づけになり、学習の接続が最も良い
   - 署名(secp256k1)も検証(署名からアドレスを復元し from と比較)も
     フロント内の砂場で本物の計算として完結でき、観測できないものを
     観測したふりをする必要がない
   - ライフサイクル表示の「mempool」段の説明文「ノードが署名・nonce・
     残高を検査し…」が既に「検査」に言及しており、その中身を見せる
     アンカーが既にある
2. **PoS の attestation(バリデーターの投票)** → **説明テキスト+用語集
   のみ**。chainviz は validator の詳細を観測しない設計
   (ARCHITECTURE.md §7.6.11: 活動パルスも「観測していないのに出すと
   誤った事実を伝える」ため出さない)であり、投票内容・成否を
   インタラクティブに見せることは観測の裏付けがなくできない。デモ末尾の
   「ほかの検証」説明で位置づけだけ示す
3. **CL→EL のブロック妥当性検証(Engine API)** → **説明テキストのみ**。
   同上。glossary `engine-api` が既にあるため relatedTerms で接続する

#### 2. 設計判断(共通骨格の適用)

- **表示場所**: サイドパネルの新 kind `"signatureDemo"`(Issue #401 の
  `"hashChainDemo"` と同じ判断・同じ機構。`SidePanelView` はフロント
  内部状態なので shared に影響しない)
- **データソース**: 完全に独立した砂場。**秘密鍵は砂場専用の使い捨て
  固定鍵**(Alice 役・攻撃者役の2つ)。実ウォレットの秘密鍵は絶対に
  画面に出さない(既存の glossary `signature` の「秘密鍵は外に出ない」
  という説明と矛盾させない。砂場専用である旨をパネル内に明記)
- **計算の表現**: 記号的説明ではなく本物の計算。`@noble/curves` の
  secp256k1(署名・公開鍵復元)+ `@noble/hashes` の keccak256
  (メッセージハッシュとアドレス導出。#401 で導入済みの依存)。
  検証は本物の ecrecover: 署名+内容からアドレスを復元し from と比較
- **署名対象の簡略化**: `${from}|${to}|${金額}` を UTF-8 連結して
  keccak256 したものに署名する(実際の RLP / EIP-155 エンコードは
  再現しない)。#401 と同じく簡略化の注記をパネル内に置く

#### 3. デモパネル「署名と検証のしくみ」の仕様

**構成**: 縦2ゾーン(上=ワークベンチ/署名する側、下=ノード/検証する側。
送信の流れを上→下の縦方向で見せる。#401 の縦チェーンと同じ因果方向):

- **上ゾーン「ワークベンチ(署名する側)」**
  - 「秘密鍵(砂場専用)」: Alice 役の固定鍵を表示。注記「実際の秘密鍵は
    画面に出しません。これは砂場専用の使い捨ての鍵です」
  - 「送信者(from)」: この鍵から導出した固定アドレス(読み取り専用)。
    注記「アドレスは秘密鍵から導出されます(秘密鍵→公開鍵→その
    keccak256 ハッシュの末尾20バイト)」— #401 のハッシュと接続する
  - 編集できる tx 内容: 「宛先」「金額」(送金パネルと同じ2項目に
    絞る。既存の送金体験との対応を最優先し、nonce 等は出さない)
  - 処理帯「secp256k1 で署名」(f(x)風アイコン+アルゴリズム名)
  - 導出値「署名データ」(hex 中略表示+title で全文。変化時フラッシュ)
- **ゾーン間の帯**: 「内容と署名がセットでノードへ届きます」(署名だけで
  なく内容も一緒に運ばれる、という前提を明示)
- **下ゾーン「ノード(検証する側)」**
  - 「届いた内容」: 宛先・金額(**ここも編集できる = 通信途中の改ざんの
    想定**。ヒント文「届いた内容を書き換えてみてください」)
  - 「届いた署名」(読み取り専用)
  - 処理帯「署名からアドレスを復元(ecrecover)」+注記「復元に秘密鍵は
    不要です。誰でも検証できます」(正確には公開鍵を復元しそこから
    アドレスを導出する旨も一行注記)
  - 導出値「復元されたアドレス」
  - **検証バッジ**: 復元アドレス === from → 「有効」(緑)/不一致 →
    「無効: 復元されたアドレスが送信者と一致しません」(赤)。from と
    復元アドレスを並べて表示し、不一致時は差分を赤で強調(shortHex でも
    ecrecover の性質上まったく別のアドレスになるため一目で分かる)

**状態モデル**(パネル内ローカル state で完結。閉じたら破棄・開き直しは
常に初期状態。#401 と同じ判断):

```ts
type DemoKeyId = "alice" | "attacker";
interface TxDraft { to: string; amountEth: string }
interface SignatureDemoState {
  /** ワークベンチが署名して送った時点の内容と使った鍵(署名はここから導出) */
  sent: { content: TxDraft; signedBy: DemoKeyId };
  /** ノード側で見えている内容(編集=改ざん) */
  received: TxDraft;
}
// 導出(stateに持たない):
//   messageHash(c) = keccak256(`${aliceAddress}|${c.to}|${c.amountEth}`)
//   signature      = secp256k1.sign(messageHash(sent.content), key(sent.signedBy))
//   recovered      = ecrecover(messageHash(received), signature) から導出したアドレス
//   isValid        = recovered === aliceAddress   // from は常に Alice のアドレスとして表示
```

**操作フロー**(学習の4拍):

1. **署名は内容+秘密鍵から計算される**: 開いた直後は有効状態。上ゾーンの
   宛先・金額を編集すると署名データが即座に別の値へ(フラッシュ)。
   `received` も追従する(=本人が署名し直して送り直した状態)ので
   有効のまま
2. **内容を1文字変えると検証が落ちる**: 下ゾーンの「届いた内容」を編集
   (改ざん)すると、復元アドレスが全く別の値になり「無効」+不一致の
   赤強調。`sent` は変わらない(署名は元の内容のもの)
3. **署名し直しても、なりすましはできない**: 無効状態で「攻撃者の鍵で
   署名し直す」ボタンが現れる。押すと `sent = { content: received,
   signedBy: "attacker" }` になり、署名自体は改ざん後の内容に対して
   数学的に正しくなるが、**復元されるのは攻撃者のアドレス**で from
   (Alice)と依然不一致 → 無効のまま。メッセージ「署名そのものは
   正しくなりましたが、復元されるのは攻撃者のアドレスです。送信者
   (Alice)にはなりすませません」
4. **内容を変えられるのは本人だけ**: 同じく無効状態で「Alice が署名し直す
   (正しく送り直す)」ボタン。押すと `sent = { content: received,
   signedBy: "alice" }` となり上ゾーンの内容も追従して有効に戻る。
   メッセージ「内容を変えて有効な署名を作れるのは、秘密鍵を持つ本人
   だけです」
5. 「最初に戻す」ボタン(常設)で初期状態へ
6. パネル末尾に2つの説明:
   - **誰が検証するか**: 「実際のチェーンでは、この検証は tx を受け取った
     各ノードが mempool に入れる前に行います。chainviz(collector)は
     この検証は行わず、ノードが報告する送信者(from)をそのまま表示して
     います」
   - **ほかの『検証』**: 「チェーンには署名検証のほかにも検証があります。
     ブロックの中身の検証(実行クライアントが行い、合意クライアントが
     Engine API 経由で依頼する)と、バリデーターによるブロックへの投票
     (attestation)です。chainviz では validator の投票内容までは観測して
     いません」— ここが attestation / engine-api の用語アンカーになる

**導線(入口)**:

1. **txライフサイクルポップオーバーの末尾**に「署名と検証のしくみを試す」
   ボタン。ポップオーバーはチップの子として描画済み(Issue #351 の
   パターン適用済みを確認)なのでホバー中のクリックが成立する
2. **送金フォーム(操作パネルの transfer タブ)内**に同文言の小リンク。
   「あなたが今からする送金の裏側」という最も文脈の強い導線
   (正確な配置は実装裁量。フォーム下部を第一候補)
3. glossary `signature` の定義文で砂場から試せることに言及(#401 と同じく
   機構的ジャンプは作らない)

#### 4. 用語集の対応

- `glossary/ethereum/terms/a-infra.yaml` に `attestation` を新設。
  定義に含める要素: (a) バリデーターが「このブロックが正しいチェーンの
  先端だ」と投票する署名付きの証明 (b) なぜ必要か: 多数の投票が集まる
  ことでチェーンが1本に確定していく(PoS の合意の実体) (c) chainviz
  では: validator カードと beacon への接続として見えるが、投票の中身は
  観測していない。`layer: a-infra`、`relatedTerms: [validator,
  beacon-api]`。アンカーはデモ末尾の「ほかの『検証』」説明文中の
  GlossaryTerm(アンカーの無い用語を作らない Issue #124 の教訓を守る)
- 既存 `signature` の定義文末尾に砂場デモへの案内を追記し、
  `relatedTerms` に `hash`(#401 で新設)を追加
- 英語版は初稿を書き、chainviz-i18n のレビューを受ける

#### 5. 新設する i18n 文言(初稿。`sigDemo.*` 名前空間)

- `sigDemo.title`: ja「署名と検証のしくみ」/ en "How signing and
  verification work"
- `sigDemo.intro`: ja「ここは学習用の砂場です。実際のチェーンには影響
  しません。ワークベンチから送金するとき、裏側ではこれが起きています。」
- `sigDemo.open`: ja「署名と検証のしくみを試す」/ en "Try how signing and
  verification work"
- `sigDemo.zone.workbench`: ja「ワークベンチ(署名する側)」/
  `sigDemo.zone.node`: ja「ノード(検証する側)」
- `sigDemo.privateKey`: ja「秘密鍵(砂場専用)」+ `sigDemo.privateKeyNote`:
  ja「実際の秘密鍵は画面に出しません。これは砂場専用の使い捨ての鍵です」
- `sigDemo.addressNote`: ja「アドレスは秘密鍵から導出されます(秘密鍵→
  公開鍵→その keccak256 ハッシュの末尾20バイト)」
- `sigDemo.field.from` ja「送信者(from)」/ `sigDemo.field.to` ja「宛先」/
  `sigDemo.field.amount` ja「金額」
- `sigDemo.compute.sign`: ja「secp256k1 で署名」/
  `sigDemo.compute.verify`: ja「署名からアドレスを復元(ecrecover)」
- `sigDemo.verifyNote`: ja「復元に秘密鍵は不要です。誰でも検証できます」
- `sigDemo.signature`: ja「署名データ」/ `sigDemo.recovered`:
  ja「復元されたアドレス」
- `sigDemo.transport`: ja「内容と署名がセットでノードへ届きます」
- `sigDemo.tamperHint`: ja「届いた内容を書き換えてみてください(通信の
  途中で改ざんされた想定です)」
- `sigDemo.badge.valid`: ja「有効: 復元されたアドレスが送信者と一致」/
  `sigDemo.badge.invalid`: ja「無効: 復元されたアドレスが送信者と一致
  しません」
- `sigDemo.resignAttacker`: ja「攻撃者の鍵で署名し直す」/
  `sigDemo.resignAttackerResult`: ja「署名そのものは正しくなりましたが、
  復元されるのは攻撃者のアドレスです。送信者(Alice)にはなりすませません」
- `sigDemo.resignAlice`: ja「Alice が署名し直す(正しく送り直す)」/
  `sigDemo.resignAliceResult`: ja「内容を変えて有効な署名を作れるのは、
  秘密鍵を持つ本人だけです」
- `sigDemo.reset`: ja「最初に戻す」
- `sigDemo.whoVerifies` / `sigDemo.otherVerifications`: 上記操作フロー6の
  2つの説明文
- `sigDemo.simplifiedNote`: ja「実際の tx はここに出した項目のほかにも
  多くの情報(nonce・gas など)を含み、決められた形式(RLP)で並べてから
  署名します。この砂場では『内容と署名が結びついている』ことに絞って
  簡略化しています」
- 英語版はすべて初稿を用意し chainviz-i18n レビューへ

#### 6. 共通骨格の再利用(#401 との関係)

- `packages/frontend/src/crypto-demo/` に `SignatureDemoView.tsx`(ビュー)
  と `signatureDemo.ts`(純粋ロジック: 状態型・初期値・導出・resign/reset)
  を追加し、#401 で作った部品(検証バッジ・処理帯・hex 中略表示・変化
  フラッシュ・導入文/リセットのレイアウト)を再利用する
- 依存の追加は `@noble/curves` のみ(`@noble/hashes` は #401 で導入済み)
- `SidePanelHost` の kind ディスパッチに `"signatureDemo"` を1ケース追加
- **着手順序**: #401 の実装完了(または同一ブランチへの合流)後に着手。
  共通部品の props を #402 側の都合で広げたくなった場合は、#401 側の
  表示を壊さないことを確認してから変更する

#### 7. 型変更の要否・影響範囲

- **`packages/shared` の型変更: 不要**。砂場はフロント内で完結する
- **collector の変更: 不要**。実データの from を RPC 報告のまま信頼する
  現状設計は変えない(collector に ecrecover を導入して実 tx を検証する
  案は、学習デモの目的に対して過剰で、このIssueでは採らない。必要に
  なったら別Issue)
- 変更対象: `packages/frontend`(kind 追加・crypto-demo/ へのデモ追加・
  ライフサイクルポップオーバーと送金フォームへの導線・i18n 文言・依存に
  `@noble/curves`)、`glossary/ethereum/terms/a-infra.yaml`(attestation)・
  `c-transaction.yaml`(signature 追記)
- `docs/CONCEPT.md` は #401 のブランチで追記済みの体験イメージ項目
  (「署名・検証も同じパターンで拡充予定。Issue #402」)が本Issueを
  カバーしているため、このブランチでは変更しない(同一箇所の二重編集に
  よるコンフリクトを避ける)。`docs/ARCHITECTURE.md` への正式節の追加は
  実装時に sync-docs で行う(#401 の節に続けて記載する想定)

#### 8. テスト観点(実装担当・tester への申し送り)

- 純粋ロジック(`signatureDemo.ts`)のユニットテスト: 署名→検証の
  ラウンドトリップ(固定鍵・固定内容→有効)、改ざん→無効(復元
  アドレスが from と不一致)、攻撃者の再署名→無効のまま(復元アドレス
  === 攻撃者アドレスであること)、Alice の再署名→有効に戻る、リセット。
  secp256k1 は既知の鍵→既知のアドレスの参照ベクトルで1本
- コンポーネントテスト: バッジ・再署名ボタンの出現条件(無効時のみ)・
  2つの入口からパネルが開くこと・ja/en 両方の文言キー
- 無効判定のテストは一致状態と不一致状態の両方を張る(#401 と同じ)

#### 9. 決めきれていない点(実装時の裁量・確認事項)

- 送金フォーム内の入口リンクの正確な配置(フォーム下部を第一候補と
  するが、送信ボタンとの視覚的競合は現物で判断してよい)
- attestation 用語のアンカーを validator→beacon エッジポップオーバーの
  説明文中にも置くか(既存文言に「ブロック提案・証明」の言及あり)は、
  文中アンカーの実装コストを見て実装担当が判断してよい(最低限デモ末尾の
  説明文中のアンカーがあれば Issue #124 の教訓は守れる)
- 文言(§5)はすべて初稿。日本語の言い回しは実装担当の裁量、英語版は
  chainviz-i18n のレビューで確定

### 2026-07-19 Issue #402 実装設計メモ

- 担当: frontend
- ブランチ: issue-402-signature-verification-viz
- 前提確認: Issue #401 は main にマージ済みで、このブランチにも取り込み
  済み。`crypto-demo/keccak256.ts`・`hashChainDemo.ts`・
  `HashChainDemoView.tsx`・`side-panel/sidePanelView.ts` の `"hashChainDemo"`
  kind を実装の型として踏襲する。

#### 依存関係

- `@noble/curves`(secp256k1 の署名・公開鍵復元)を `packages/frontend` の
  直接依存に追加する(`^2.2.0`。`@noble/hashes` と同じ v2 系列で揃える)。
  `pnpm-lock.yaml` には collector 側の transitive 依存として既に
  `@noble/curves@1.9.1` が存在するが、フロントの直接依存としては未導入
  だったため新規に追加する
- サブパス import は `@noble/hashes` と同じく拡張子 `.js` が必須
  (`@noble/curves/secp256k1.js`)。API は v2 系(`secp256k1.sign` /
  `recoverPublicKey` / `getPublicKey` / `Point` を直接 export する形。
  v1 系の `Signature.fromCompact` 等とは形が異なる)。ローカルで
  実際に import して動作を確認済み:
  - `secp256k1.sign(msgHash, secretKey, { prehash: false, format: "recovered" })`
    → 65byte(先頭1byteが recovery、残り64byteがr‖s)。`prehash: false` が
    必須(既定では内部で更に sha256 をかけてしまうため。Ethereum は
    keccak256 したメッセージにそのまま署名するので二重ハッシュしない)
  - `secp256k1.recoverPublicKey(signature, msgHash, { prehash: false })`
    → 圧縮公開鍵(33byte)。既定の圧縮形式のままではアドレス導出に
    使えないため、`secp256k1.Point.fromBytes(pub).toBytes(false)` で
    非圧縮(65byte, 先頭 `0x04`)に展開してから先頭1byteを除いた64byteを
    keccak256 し、末尾20byteを取る(Ethereum のアドレス導出そのもの)
  - 秘密鍵 `0x1`(32byte)→アドレス `0x7e5f4552091a69125d5dfcb7b8c2659029395bdf`
    という既知の参照値(複数の公開資料で言及される「秘密鍵=1」の
    アドレス)で、上記導出の参照ベクトルテストを1本張る

#### ファイル構成

- `crypto-demo/secp256k1.ts`(新規、`keccak256.ts` と対になる薄い
  ラッパー): `deriveAddress(secretKeyHex)` / `sign(secretKeyHex,
  messageHashHex)` / `recoverAddress(signatureHex, messageHashHex)` の
  3関数のみを公開する。すべて `0x` 始まり hex 文字列で入出力する
  (表示・保存のしやすさのため。`keccak256Hex` と同じ流儀)
- `crypto-demo/signatureDemo.ts`(新規、`hashChainDemo.ts` に対応する
  ドメインロジック): `DemoKeyId` / `TxDraft` / `SignatureDemoState` の
  型、`ALICE_ADDRESS` / `ATTACKER_ADDRESS` の砂場専用固定アドレス
  (`keccak256Hex("chainviz:sigdemo:alice")` 等のラベル文字列から
  秘密鍵を導出。乱数ではなく決定的な値にすることで「これは本物の
  秘密鍵ではない」ことを実装からも明確にする)、
  `createInitialSignatureDemoState` / `resetSignatureDemoState` /
  `updateWorkbenchContent` / `updateReceivedContent` /
  `resignAsAttacker` / `resignAsAlice` / `deriveSignature` /
  `deriveRecoveredAddress` / `isValid` を公開する
- `crypto-demo/SignatureDemoView.tsx`(新規、`HashChainDemoView.tsx` に
  対応するビュー): ローカル `useState` で完結。値変化時のフラッシュは
  同ファイル内に小さな `useFlash(value)` フックを閉じ込める(#401 の
  `flash()` はブロック配列の index 別管理が必要だったため Map 管理
  だったが、#402 は値が2つ(署名・復元アドレス)だけなので index 管理は
  不要。共通フックへ抽象化するのは早すぎる抽象化になるため見送り、
  #401 と同様ファイル内に閉じ込める)
- `side-panel/sidePanelView.ts` に kind `"signatureDemo"` を追加、
  `SidePanelHost.tsx` に振り分け1ケースを追加(#401 の `"hashChainDemo"`
  ケースと同じ形。ダングリングガード対象外も同じ理由)
- 導線: `entities/TxLifecyclePopover.tsx` の `<ul>` 末尾に文脈導線
  ボタンを1つ追加(`useOptionalSidePanel()` 経由。ChainRibbonPopover の
  導線と同じパターン)。`operations/TransferForm.tsx` のフォーム下部
  (送信ボタンの直前)に同じ導線の小リンクを追加
- `i18n/messages.ts` に `sigDemo.*` 名前空間を追加(UX設計§5の初稿ベース。
  英語は初稿のまま、chainviz-i18n のレビュー対象)
- `glossary/ethereum/terms/a-infra.yaml` に `attestation` を新設、
  `glossary/ethereum/terms/c-transaction.yaml` の `signature` 定義文と
  `relatedTerms` を更新

#### 状態遷移の実装方針(UX設計§3の状態モデルをそのままコードに落とす)

- `updateWorkbenchContent(state, patch)`: 上ゾーン(ワークベンチ)の編集は
  常に Alice 自身の操作という前提のため、`signedBy` を明示的に
  `"alice"` に固定した上で `sent.content` と `received` の両方を同じ
  内容に更新する(UX設計操作フロー1: 「本人が署名し直して送り直した
  状態」を体現)
- `updateReceivedContent(state, patch)`: 下ゾーン(ノード側で見えている
  内容)だけを更新する。`sent` には触れない(改ざんの想定。UX設計
  操作フロー2)
- `resignAsAttacker` / `resignAsAlice`: どちらも `sent = { content:
  state.received, signedBy: <鍵> }` とし `received` はそのまま
  (UX設計操作フロー3・4のとおり)
- 導出値(state に持たない): `messageHash(content) = keccak256Hex(
  "${ALICE_ADDRESS}|${content.to}|${content.amountEth}")`(`from` は
  常に Alice のアドレス固定。実際に署名した鍵が誰であっても「Aliceが
  送った」という主張内容自体は変わらない、という改ざん検知の要点を
  そのまま体現する)。`deriveSignature(state) = sign(secretKeyFor(
  sent.signedBy), messageHash(sent.content))`。
  `deriveRecoveredAddress(state) = recoverAddress(deriveSignature(state),
  messageHash(received))`。`isValid(state) = deriveRecoveredAddress(state)
  === ALICE_ADDRESS`
- 「攻撃者の鍵で署名し直しても無効なまま」「Alice が署名し直すと有効に
  戻る」は上記の合成だけで自然に導かれる(individual な特殊分岐を
  追加しない)

#### View 側のローカル UI 状態(ドメインロジックに持たせないもの)

- `lastAction: "attacker" | "alice" | null`: 直前に押した再署名ボタンの
  種類。`sigDemo.resignAttackerResult` / `sigDemo.resignAliceResult` の
  結果メッセージの表示条件にのみ使う(#401 の `hasInteracted` と同じ
  役割・同じ理由: 初期状態でも `isValid` は true になり得るため、
  「たった今何をしたか」は純粋ロジック側だけでは区別できない)。
  `updateWorkbenchContent` / `updateReceivedContent` / reset のいずれかを
  行うと `null` に戻す

#### 用語集アンカーの配置

- デモ末尾の「ほかの『検証』」説明文(`sigDemo.otherVerifications`)は
  地の文とし、その直後に `attestation` / `engine-api` を指す短い
  ラベルチップ(`GlossaryTerm` でラップした短い名詞。既存の
  `InfraPopover` 等が「ラベル全体を GlossaryTerm でラップする」パターンを
  踏襲。地の文中に GlossaryTerm を埋め込む形は既存コードに前例が無く、
  今回新設もしない)を並べて置く。これで Issue #124 の「アンカーの無い
  用語を作らない」を満たす
- validator→beacon エッジポップオーバーへの追加アンカーは見送る
  (UX設計§9の裁量どおり、デモ末尾のアンカーで教訓を満たせるため)

#### テスト方針(ファイル分割)

- `secp256k1.test.ts`: 参照ベクトル(秘密鍵=1→既知アドレス)、
  署名→復元のラウンドトリップ、改ざん(別メッセージ)で復元アドレスが
  変わること、決定性(同じ入力は同じ署名)
- `signatureDemo.test.ts`: 初期状態が有効であること、
  `updateWorkbenchContent` で署名が変わり有効なまま追従すること、
  `updateReceivedContent`(改ざん)で無効になること、
  `resignAsAttacker` 後も無効(復元アドレス=攻撃者アドレス)のまま
  であること、`resignAsAlice` で有効に戻ること、reset
- `signatureDemo.edgeCases.test.ts`: 空文字列・同一値への改ざん(実質
  無害)・改ざん後に元の値へ戻すと有効に戻ること等の境界値
  (#401 の `hashChainDemo.edgeCases.test.ts` に相当する分割)
- `SignatureDemoView.test.tsx` / `.i18n.test.tsx` / `.a11y.test.tsx`:
  #401 の `HashChainDemoView.*.test.tsx` 群と同じ3分割
- `SidePanelHost.signatureDemo.test.tsx`: kind 振り分け・排他制御・
  ダングリングガード対象外であることの確認(#401 の
  `SidePanelHost.hashChainDemo.test.tsx` に相当)
- `TxLifecyclePopover.sigDemoEntry.test.tsx` /
  `TransferForm.sigDemoEntry.test.tsx`: 各導線ボタンの存在・
  クリックでパネルが開くこと(#401 の `*.hashDemoEntry.test.tsx` に相当)

### 2026-07-19 Issue #402 実装完了報告

- 担当: frontend
- ブランチ: issue-402-signature-verification-viz
- 実装内容: 実装設計メモのとおりに実装した。差分の要点:
  - `@noble/curves`(secp256k1)を frontend の直接依存に追加
  - `crypto-demo/secp256k1.ts`(署名・ecrecover・アドレス導出の薄い
    ラッパー)と `crypto-demo/signatureDemo.ts`(状態・状態遷移の純粋
    ロジック)を新設
  - `crypto-demo/SignatureDemoView.tsx`(パネル本体)を新設し、
    `side-panel/sidePanelView.ts` / `SidePanelHost.tsx` に kind
    `"signatureDemo"` を追加
  - 導線2箇所: `TxLifecyclePopover.tsx` 末尾のボタン、
    `TransferForm.tsx` 送信ボタン直前の小リンク
  - 用語集: `attestation` を `a-infra.yaml` に新設し `validator` の
    近くに配置。既存 `signature` の定義文・`relatedTerms`(`hash`追加)を
    更新。デモ末尾の「ほかの検証」説明に `attestation`/`engine-api` の
    `GlossaryTerm` チップを設置(Issue #124 の教訓を満たす最小構成)
  - `docs/ARCHITECTURE.md` に §16 を新設(§15 ハッシュデモの次)
  - `packages/e2e` に UI-SIG-01 を追加(送金フォームの入口→改ざん→
    攻撃者再署名(なりすまし不成立)→Alice再署名→リセットの一気通貫)。
    `packages/e2e/SCENARIOS.md` にも対応節を追加
- 決めた点(worklogで「未決」としていた2点):
  - 送金フォームの入口リンクはフォーム下部・送信ボタンの直前に配置
    (「あなたが今からする送金の裏側」という文脈が最も強い位置。
    送信ボタンとの視覚的な競合は無し。`type="button"` を明示し誤って
    フォーム送信を起こさないことをテストで確認済み)
  - `attestation` 用語のアンカーは validator→beacon エッジポップオーバー
    には追加しなかった(デモ末尾のアンカーのみで Issue #124 の教訓を
    満たすため。UX設計の裁量どおり)
- 実装中に気づいた注意点:
  - `@noble/curves` は v2 系で API 形状が v1 系と異なる(`secp256k1`
    オブジェクトが `sign`/`recoverPublicKey`/`getPublicKey`/`Point` を
    直接 export する)。`recoverPublicKey`/`getPublicKey` の既定の戻り値は
    圧縮公開鍵(33byte)であり、Ethereum アドレス導出には
    `secp256k1.Point.fromBytes(pub).toBytes(false)` で非圧縮
    (65byte, 先頭 `0x04`)へ展開してから先頭1byteを除く必要がある
    (実装設計メモに詳細を記録済み)
  - `secp256k1.sign(...)` は既定で内部的にメッセージへ sha256 を
    かけてしまう(`prehash` 既定 `true`)。Ethereum は keccak256 済みの
    メッセージにそのまま署名するため、`sign`/`recoverPublicKey` の
    両方に必ず `{ prehash: false }` を渡す必要がある(渡し忘れると
    署名検証のラウンドトリップが静かに壊れる。secp256k1.test.ts の
    ラウンドトリップテストで担保)
  - `GlossaryTerm` は `GlossaryProvider` が無いとレンダー時に例外を
    投げる(`useOptionalSidePanel` のように任意化されていない)。
    `SignatureDemoView` は末尾で `GlossaryTerm` を使うため、単体テストは
    すべて `GlossaryProvider` でラップする必要がある(既存の
    `TxLifecyclePopover.test.tsx` 等と同じ制約)
- 検証: `pnpm lint && pnpm build && pnpm test` をリポジトリ全体
  （shared/collector/frontend/e2e の4パッケージ）に対して実行し、
  全てパス（frontend 235ファイル 2983テスト、shared 6ファイル75テスト、
  collector・e2e(unit)も既存分がすべてパス）。E2E の実ブラウザ実行
  （UI-SIG-01。docker-compose を伴う）はフロント担当の作業範囲外
  （CLAUDE.md: フロントは Docker に直接触れない）のため未実施。
  `chainviz-qa` での実行を想定
- 次の担当への申し送り: `chainviz-tester` によるテスト強化 →
  `chainviz-reviewer`(静的レビュー・テストコードの質) →
  `chainviz-qa`(UI-SIG-01 の実ブラウザ実行含む)の順で見てほしい。
  `docs/PLAN.md` のチェックボックスはレビュー・QA完了後に統括が更新する
  ため、このタスクでは更新していない
