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

### 2026-07-11 Issue #251 実装（chainviz-frontend）

- 担当: frontend
- ブランチ: issue-251-addnode-pair-hint

#### 実装方針の確認メモ（着手前）

UX設計メモ §5 の要件をそのまま採用する。技術的な補足のみ以下に残す。

- `ActionHint` の `hint` プロパティは既存の呼び出し元（addWorkbench側）が
  文字列を渡し続けるため、`string` から `ReactNode` への型拡張は非破壊的
  （文字列も `ReactNode` のサブセット）。`ActionHint` 自体の開閉ロジック・
  `useHoverPopover` は変更不要
- 2段目のみを持つ理由の文言は `CanvasToolbar` 内でノード追加ボタン用にのみ
  組み立てる。`resolveAddNodeHint` 自体（`commands/commandMessages.ts`）は
  1段目の文言のみを返す既存のまま変更しない。2段構成への組み立ては
  `CanvasToolbar.tsx` 側の責務とする（UX設計メモの実装要件どおり）
- `GlossaryTerm` は `useGlossary()` を無条件に呼ぶため、`CanvasToolbar` が
  レンダーされる時点で `GlossaryProvider` が必須になる。実アプリ
  （`App.tsx`）は既に `GlossaryProvider` で `AppShell`（`CanvasToolbar` を
  含む）をラップ済みなので実害はないが、`CanvasToolbar.test.tsx` は
  `GlossaryProvider` 無しでレンダーしていたため、テスト側の `renderToolbar`
  ヘルパーに `GlossaryProvider`（テスト用の最小 glossary データ）を追加する
  必要がある
- 各段を block 要素にする指定は、`span` に `display: block` を当てる
  `.action-hint__line` クラスを新設して満たす（`.action-hint__popover` 自体は
  既存の幅・line-height をそのまま使う）。2段目には区切り線
  （`.action-hint__line--secondary`）を追加し、視覚的に「予告」と「補足」を
  分ける

#### 実装内容

- `packages/frontend/src/canvas/ActionHint.tsx`: `hint` プロパティの型を
  `string` から `ReactNode` に拡張した。開閉ロジック・`PopoverPortal` への
  渡し方は変更していない
- `packages/frontend/src/canvas/CanvasToolbar.tsx`: ノード追加ボタンの hint
  のみ、1段目（既存の `resolveAddNodeHint` の結果）+ 2段目（新規の
  `action.addNode.hint.pair.*` 3キー + `GlossaryTerm termKey="el-cl-separation"`）
  の2段構成に組み立てるよう変更した。ワークベンチ追加ボタンの hint
  （`resolveAddWorkbenchHint`）は変更していない
- `packages/frontend/src/i18n/messages.ts`: `action.addNode.hint.pair.prefix` /
  `.term` / `.suffix` の3キーを ja/en で追加した（設計メモ §4 の文言のまま）。
  `internalEdge.pair.*` と同じ3分割パターンである旨をコメントに残した
- `packages/frontend/src/styles.css`: `.action-hint__line`（各段を block 化）
  と `.action-hint__line--secondary`（2段目の区切り線）を追加した
- テスト:
  - `packages/frontend/src/canvas/ActionHint.test.tsx`: `hint` に
    `ReactNode`（ネストした要素を含むフラグメント）を渡した場合でも
    正しくレンダーされることを確認するケースを追加した
  - `packages/frontend/src/canvas/CanvasToolbar.test.tsx`: `renderToolbar`
    ヘルパーに `GlossaryProvider`（テスト用の `el-cl-separation` エントリ
    のみを持つ最小 glossary）を追加した。既存の「generic 文言と完全一致」
    テスト（`toBe`）は2段目追加により壊れるため `toContain` に変更した。
    新規に以下を確認するテストを追加した:
    - 1段目・2段目が両方含まれること（generic hint 時 / 具体的なブート
      ノード名が解決できる hint 時の両方）
    - `data-testid="glossary-term-el-cl-separation"` のアンカーが存在すること
    - アンカーへネストしてホバーすると `glossary-popover-el-cl-separation`
      が開き、かつ外側のツールチップ（`role="tooltip"`）が2つ同時に存在する
      （閉じない）こと
    - ワークベンチ追加ボタンの hint には pair 説明・アンカーが出ないこと
    - 英語モードでの2段目の文言

#### 動作確認

- `pnpm --filter @chainviz/frontend build` / `pnpm --filter @chainviz/frontend test`
  （117ファイル・1824件）が通ることを確認した
- 実機（ブラウザ）での確認は、この環境に Chromium 実行に必要な共有ライブラリ
  （`libnspr4.so` 等）が無く `sudo apt-get install` の権限も無いため
  Playwright 経由の実ブラウザ確認ができなかった。代替として、実アプリと
  同じ `glossary/data.js`（本物の glossary データ、モックではない）を使い、
  `@testing-library/react` で `CanvasToolbar` を実際にレンダーしてホバー
  イベントを発火させ、以下を目視確認した（確認用の一時テストファイルは
  検証後に削除しコミットに含めていない）:
  - ツールチップの `outerHTML` に、1段目の文言・2段目の文言・
    `data-testid="glossary-term-el-cl-separation"` を持つ `GlossaryTerm`
    アンカーが期待どおりの構造で含まれていること
  - `GlossaryTerm` アンカーへホバーすると、本物の glossary 定義文
    （`glossary/ethereum/terms/d-internal.yaml` の `el-cl-separation`）が
    表示されること
  - このホバー後も `role="tooltip"` の要素が2つ（外側の ActionHint 用と
    内側の GlossaryTerm 用）同時に存在し、外側のツールチップが閉じて
    いないこと（ネストしたホバーが成立することの確認）

#### 決定事項・注意点

- `docs/PLAN.md` のチェックは #251（本実装）のみを完了に更新した。関連する
  #216（「なぜペアでしか追加できないのか」という疑問そのもの）は
  `docs/worklog/issue-216.md` で既に別 Issue として #251 に切り出し済みで
  あり、#216 自体のチェックボックス状態は本作業では変更していない
  （#216 側の完了判定は当該 Issue の担当・レビューに委ねる）

### 2026-07-11 Issue #251 テスト強化（chainviz-tester）

- 担当: tester
- ブランチ: issue-251-addnode-pair-hint
- 内容: 実装担当が書いた基本テスト（ハッピーパス中心）に、異常系・境界値・
  回帰・言語切り替えの観点でケースを追加した。新機能の実装は行っていない。

#### テストファイルの分割（1ファイル1責務）

- `CanvasToolbar.test.tsx` が肥大化していたため、Issue #251 の「なぜペアか」
  2段目ヒント（GlossaryTerm 埋め込み）に関する検証を
  `CanvasToolbarPairHint.test.tsx` に分離した。既存の pair hint テスト
  （6件）は挙動を変えずにこちらへ移動した。
- 両ファイルが必要とする共通のレンダーヘルパー（`renderToolbar` /
  `testGlossary` / `node`）を `canvasToolbarHarness.tsx` に切り出し、
  重複を避けた。`CanvasToolbar` はどのテストでも常に pair hint（GlossaryTerm）
  を構築するため、pair hint を直接検証しないテストでも `GlossaryProvider` が
  必須である点をハーネスのコメントに明記した。

#### 追加したテストの観点

- `ActionHint.test.tsx`（`hint: string` → `ReactNode` 拡張の異常系・境界）:
  - `hint={null}`（nullish な ReactNode）でクラッシュせず空のツールチップを開く
  - `hint={0}`（数値の ReactNode。falsy でも "0" として表示され欠落しない）
  - ホバー→離脱→再ホバーで毎回開き直せる（開閉が一度きりにならない回帰）
  - hint 内に置いた別の要素へマウスを移してもツールチップが閉じない
    （ネストしたホバーの単体レベル確認）
- `CanvasToolbarPairHint.test.tsx`:
  - 回帰: ノード追加ヒントには `.action-hint__line--secondary`（2段目）が
    ちょうど1つ、ワークベンチ追加ヒントには0（2段目が漏れていない）
  - 境界: entities が空・EL のみで CL 欠落といった部分的なブートノード解決
    でも、静的な2段目は常に付く
  - 言語切り替え（要件4）: 英語モードでも用語アンカーの `data-testid`
    （`glossary-term-el-cl-separation`）は言語非依存で安定し、ラベルのみ
    英語化される。英語モードのネストホバーで英語定義文が開く
  - ネストホバーの独立性（#221 `useHoverPopover`）: 用語から外側ツール
    チップ本体へカーソルが戻る（`relatedTarget` が外側を指す）場合、用語
    ポップオーバーの遅延クローズは外側に波及しない

#### 検討・注意点

- 要件2（ネストホバー時に外側ツールチップが閉じないこと）は、当初
  `fireEvent.mouseLeave(anchor)`（relatedTarget 省略）で用語から離れる想定の
  テストを書いたが、jsdom + React の合成イベントでは relatedTarget=null が
  「文書外へ離脱」と解釈され、React が祖先チェーン全体に mouseleave を発火
  させるため外側ツールチップまで閉じてしまい、実挙動を再現できなかった。
  実ブラウザで問題になるのは「用語から外側本体へ戻る」動きなので、
  `relatedTarget` に外側ツールチップを与えて「戻る」動きを模したテストに
  改めた。ActionHint と GlossaryTerm はそれぞれ独立した `useHoverPopover`
  を持つため、ActionHint 自体は #221 のホバー継続（遅延クローズ）を既に
  備えており、#221 の追加対応は不要であることを確認した。
- 要件3（`ReactNode` 拡張による他の呼び出し箇所への影響）: `ActionHint` の
  呼び出し箇所は `CanvasToolbar`（ノード追加=ReactNode / ワークベンチ追加=
  文字列）と `InfraNodeCard`（`resolveWorkbenchOperationsHint` の文字列）の
  3か所。`string` は `ReactNode` のサブセットで型拡張は非破壊であり、
  フロントの全テスト（118ファイル・1835件）が通ることで既存呼び出しに
  回帰がないことを確認した。
- 実装ロジックの変更が必要なバグは見つからなかった。

#### 動作確認

- `pnpm --filter @chainviz/frontend build`（tsc -b）が通ること
- `pnpm --filter @chainviz/frontend test`（118ファイル・1835件、テスト強化前は
  117ファイル・1824件。新規ファイル1・純増11件）が通ること
- `pnpm lint`（eslint）が通ること
