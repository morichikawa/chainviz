# Issue #251 作業記録

### 2026-07-11 Issue #251 ノード追加ボタン付近に「reth+beaconのペアで追加される」ことの説明を添える（UX設計）

- 担当: ux
- ブランチ: issue-251-addnode-pair-hint
- 内容: ノード追加ボタン近傍の説明の見せ方・文言を UX 設計として確定した。
  実装コードの変更はない（実装は chainviz-frontend へ引き継ぐ）。

#### 1. 実機確認で分かった現状（前提の修正）

Issue #251 本文（および `docs/worklog/issue-216.md` の残ギャップ記述）は
「ペアの説明は内部リンクエッジのポップオーバーにしかなく、ツールバー付近には
無い」としているが、実機確認（`pnpm --filter @chainviz/frontend dev` の
モックモード + Playwright、2026-07-11）の結果、**Issue #123 で導入済みの
押下前ツールチップ（`ActionHint`）に「ペアである」という事実は既に書かれて
いる**ことを確認した。

- 「+ ノードを追加」ホバー時の実表示（ja）:
  「フォロワーノード(reth + beacon のペア、カード2枚)を起動します。
  chainviz-reth-1 と chainviz-lighthouse-1 を入口(ブートノード)に
  既存ネットワークへ参加し、同期後は他のノードとも自動で繋がります」
- Issue #123 のマージは 2026-07-06、Issue #216（ユーザーの疑問）の起票は
  2026-07-08。つまり**このツールチップが存在する状態でもなお「ペアでしか
  追加できないのは一般的ではないのでは」という疑問が出た**。

ここから、伝わっていないのは「ペアで追加される」という事実（What）では
なく、**「なぜペアなのか」（Why）＝これは chainviz 側の制約ではなく
The Merge 以降の Ethereum の標準構成である、という一言**だと判断した。
現行ツールチップは挙動の予告に徹していて、挙動の正当性（一般的な構成で
あること）を語っておらず、用語 `el-cl-separation` への導線も無い。

#### 2. 見せ方の決定: 既存ツールチップの拡張（常設テキストは不採用）

Issue 本文で chainviz-ux に委ねられた「ツールチップか常設の補足テキストか」
は、**既存の押下前ツールチップ（ActionHint）に Why の一文を追記し、文中に
GlossaryTerm アンカー（el-cl-separation）を埋め込む**方式に決定した。

理由:

- 押下前の予告情報は ActionHint ツールチップに置く、という設計言語が
  Issue #123 で確立済み。同じ情報を別の場所（常設キャプション）に分散
  させると、どこを読めば良いかがかえって不明瞭になる
- 常設テキストはツールバー直下のキャンバス（カード表示域）を恒久的に
  占有する。初回にだけ必要な説明のために常時スペースを払うのは過剰
  （CLAUDE.md「先回り実装をしない」の UX 版）
- ツールチップはホバーで即時表示（`useHoverPopover` は開くのは遅延なし）
  であり、押下前に読める到達性は十分。ペアという事実自体は押下後も
  ゴーストカード2枚（reth / beacon のラベル付き）と内部リンクエッジで
  繰り返し提示されるため、ボタン付近で担うべきは Why の一文に絞れる
- ポップオーバー文中に GlossaryTerm を埋め込むパターンは
  `InternalLinkEdgePopover`（`internalEdge.pair.prefix/term/suffix` の
  3分割）で実装済みの前例がある

検討して不採用にした案:

- **常設の補足キャプション（ボタン下の小さな文字）**: 上記のとおり恒久的な
  画面占有と情報の分散がデメリット。不採用
- **ボタンラベル自体の変更**（例: 「ノードを追加(ペア)」）: ラベルが肥大する
  うえ、「ペア」という語だけでは #216 の疑問（一般的なのか？）を解けない。
  不採用

#### 3. 操作フロー（この設計で成立させたい体験）

1. ユーザーが「+ ノードを追加」にホバー（またはキーボードフォーカス）する
2. ツールチップに (a) 何が起きるか（既存文言のまま）と (b) なぜ2枚1組
   なのか（新規の一文）が2段で表示される
3. さらに知りたいユーザーは、(b) の文中の下線付き用語「EL/CL分離」へ
   カーソルを移すと、用語解説ポップオーバー（glossary の定義文）が開く
   - ツールチップから用語へのマウス移動で閉じないことは実機で確認済み
     （ポップオーバーは React の portal であり、React ツリー上はアンカーの
     子のため、ポップオーバー内へのホバーで mouseleave が発火しない）
4. ここまで読めば「2枚のカード＝1つのノード。ペアなのは chainviz の都合
   ではなく実際の Ethereum の標準構成」と理解した上でボタンを押せる

#### 4. 文言案（{ja, en}）

既存の1文目（`action.addNode.hint` / `action.addNode.hint.generic`）は
**変更しない**。その後ろに、ブートノード解決の成否に依存しない静的な
2文目（改行して2段目）を常に追加する。

GlossaryTerm を文中に埋め込むため、`internalEdge.pair.*` と同じ
prefix / term / suffix の3分割で新規キーを追加する:

- `action.addNode.hint.pair.prefix`
  - ja: `2枚で1つのノードです。実行(EL)と合意(CL)を別々のクライアントが担うのは The Merge 以降の Ethereum の標準構成(`
  - en: `The two cards form one node — running execution (EL) and consensus (CL) as separate clients has been the standard shape of an Ethereum node since The Merge (`
- `action.addNode.hint.pair.term`（GlossaryTerm の表示ラベル。
  `termKey="el-cl-separation"`）
  - ja: `EL/CL分離`
  - en: `EL/CL separation`
- `action.addNode.hint.pair.suffix`
  - ja: `)です`
  - en: `).`

組み立て後の全文:

- ja: 「2枚で1つのノードです。実行(EL)と合意(CL)を別々のクライアントが
  担うのは The Merge 以降の Ethereum の標準構成(EL/CL分離)です」
- en: "The two cards form one node — running execution (EL) and consensus
  (CL) as separate clients has been the standard shape of an Ethereum node
  since The Merge (EL/CL separation)."

用語との一貫性の確認:

- `glossary/ethereum/terms/d-internal.yaml` の `el-cl-separation` の
  用語名は ja「EL/CL分離」/ en「EL/CL separation」で、term ラベルと一致
- 同定義文の「The Merge 以降の標準構成」（en: "the standard shape since
  The Merge"）と同じ言い回しを使い、ツールチップ→用語解説と読み進めた
  ときに表現が揃うようにした
- `internalEdge.pair.*`（内部リンクエッジ）の「合意（beacon）と実行
  （reth）を分担する1つの Ethereum ノード」とも「2枚（2コンテナ）=
  1ノード」という骨子が揃っている
- 括弧は messages.ts の既存 UI 文言に合わせて半角

#### 5. 実装要件（chainviz-frontend への引き継ぎ）

- `packages/frontend/src/canvas/ActionHint.tsx`: `hint: string` を
  `hint: ReactNode` に広げる（既存の文字列呼び出しはそのまま通る）。
  開閉挙動・portal 描画は変更しない
- `packages/frontend/src/canvas/CanvasToolbar.tsx`: ノード追加ボタンの
  hint を「1段目 = 既存の `resolveAddNodeHint(entities, t)` の結果 /
  2段目 = prefix + `<GlossaryTerm termKey="el-cl-separation">` +
  term + `</GlossaryTerm>` + suffix」の2段構成の ReactNode にする。
  各段は block 要素（display:block の span 等）で改行し、1段の長文に
  しない。ワークベンチ追加ボタン側は変更しない
- `packages/frontend/src/i18n/messages.ts`: 上記3キーを追加
  （`internalEdge.pair.*` の3分割の前例をコメントで参照する）
- `packages/shared` の型変更: **不要**。collector・glossary データの変更も
  不要（`el-cl-separation` の定義は既にペア挙動を織り込み済み）
- テスト観点（実装時・テスト強化時）:
  - ノード追加ボタンのツールチップに pair 説明の文言が含まれること
  - ツールチップ内に `data-testid="glossary-term-el-cl-separation"` の
    アンカーが存在すること（`GlossaryProvider` をテストレンダーに含める）
  - ワークベンチ追加ボタンのツールチップには pair 説明が**出ない**こと
  - ja / en 両言語での表示

#### 決定事項・注意点

- **キーボード操作の既知の制約**: ツールチップはボタンのフォーカス中のみ
  表示され、Tab で用語側へフォーカスを移そうとするとボタンの blur で閉じる
  ため、ネストした用語解説まではキーボードで辿れない。2段目の文言自体は
  ツールチップ内に全文表示される（読める）ため、用語アンカーはマウス
  ユーザー向けの追加導線と割り切る。既存のエッジポップオーバー内
  GlossaryTerm と同等の制約であり、本 Issue では解決しない
- ツールチップからポップオーバー内へのマウス移動で閉じないことは実機で
  確認済み（上記 §3）。ネストしたホバーが成立する前提は検証済み
- `docs/CONCEPT.md` の更新は不要（「画面上の専門用語はホバーでその場に
  解説が出る」という既存の体験イメージの範囲内の具体化であり、決定事項の
  変更を伴わない）
- Issue #251 本文の「説明はツールバー付近に無い」という前提は §1 のとおり
  半分だけ正しい（事実の説明はあるが理由の説明が無い）。実装時は「文言の
  新規追加」ではなく「既存ツールチップへの2段目追記」である点に注意
