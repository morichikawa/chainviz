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
