### 2026-07-16 Issue #341 英語モードでp2p-legendの凡例文が日英混在になっている（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-341-backlog
- 内容: Issue #327のQA検証中に偶発的に発見された不具合のIssue起票と、
  `docs/PLAN.md` バックログへの追記（docsのみの変更）のレビュー。
  - 不具合の実在確認: 静的解析とビルド済みモジュールの実行の両方で再現を
    確認した。`node -e` でビルド済みの `packages/frontend/dist/i18n/i18n.js`
    を読み込み、`translate("legend.hint.suffix", "en")` が日本語
    「により時間とともに自動で増えます」を返すことを実測。英語モードの
    凡例文が「Peer connections grow over time via node discoveryにより
    時間とともに自動で増えます」という日英混在になることを確認した
  - **根本原因の特定（レビュー中に判明）**: Issue本文の推測
    「英語訳が日本語の断片を含んだまま保存されている可能性が高い」は
    不正確。実際の原因は次の2ファイルの意図の衝突:
    - `packages/frontend/src/i18n/messages.ts` の `legend.hint.suffix` は
      英語の語順の都合で `en: ""`（意図的な空文字。コメントで明記済み）
    - `packages/frontend/src/i18n/i18n.ts` の `pickLocale()` は
      「空文字も『値なし』として扱いデフォルト言語（ja）へフォールバック
      する」仕様（こちらもコメントで明記済み）
    - この結果、英語モードで suffix が日本語にフォールバックし混在が発生
      する。`glossary/` は無関係
  - 既存テストがこれを検出できない理由: `PeerNetworkLegend.test.tsx` の
    「localizes the hint to English」は英語断片の `toContain` のみで、
    日本語が混入していないことを検証していない。修正時は回帰テストとして
    「英語モードで日本語が含まれない」ことのアサーションを追加すべき
  - `docs/PLAN.md` の追記フォーマットは直前の #334 項目と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
- 決定事項・注意点:
  - レビュー結果は条件付き差し戻し（軽微）。バックログ追記自体は妥当だが、
    Issue #341 本文と PLAN.md 補足の「glossary/またはi18n/messages.tsの
    どちらが原因か特定が必要」という記述を、上記の特定済みの根本原因
    （`i18n.ts` の `pickLocale` の空文字フォールバックと `messages.ts` の
    意図的な空文字 en 訳の衝突）に更新するよう統括へ差し戻した。
    このままだと着手者が `glossary/` や「英訳データの保存ミス」を探して
    遠回りする
  - 修正方針は着手時の設計判断だが、候補は (a) `legend.hint.*` の3分割を
    やめ en では suffix を使わない構造にする、(b) `pickLocale` に
    「明示的な空文字はフォールバックしない」区別を導入する、のいずれか。
    (b) は glossary 側の空文字翻訳の扱い（i18n.ts コメント参照）に影響する
    ため影響範囲の確認が必要
  - コード修正は本ブランチでは行わない（docsのみ）。実装着手は後日

### 2026-07-17 Issue #341 設計（i18n 空文字フォールバックの仕様判断）

- 担当: designer
- ブランチ: issue-341-i18n-empty-string-fallback
- 内容: 案A（`pickLocale()` の仕様変更）と案B（`legend.hint.suffix` の
  文言側修正）を比較し、**案Aの範囲を `translate()` に限定した変形
  （案A'）** を採用する設計判断を行った。`packages/shared` の型変更は
  不要。実装は frontend 担当に引き継ぐ。設計内容は
  `docs/ARCHITECTURE.md` §5.1（多言語テキストの解決規則）にも反映済み。
- 決定事項・注意点: 以下の設計メモを参照。

## 設計メモ（2026-07-17 designer）

### 1. 現状の把握（実測）

- 意図的な空文字は `packages/frontend/src/i18n/messages.ts` の
  `legend.hint.suffix` の `en: ""`（133行目）**1箇所のみ**
  （`grep 'ja: ""\|en: ""'` で messages.ts・chain-profiles・glossary を
  確認。データ側に意図的な空文字は存在しない）。
- `pickLocale()`（`src/i18n/i18n.ts` 28-39行）の「空文字も『値なし』と
  して ja へフォールバック」は、コメントに明記されているとおり
  **glossary の parse がトリムのみで空文字を弾かないことへの防御**として
  存在する。`pickLocale` の直接の利用箇所（grep で全列挙）はすべて
  データ由来のテキスト（glossary の name/definition、チェーンプロファイル
  の label/description など）だった。UI 文言（`messages.ts`）は
  `translate()` → `pickLocale()` 経由で解決されており、ここで意図的な
  空文字が巻き込まれていた。
- `messages.ts` の `Localized` は `Record<Language, string>`（全言語必須）。
  つまり UI 文言はコンパイル時に両言語の存在が保証されており、値が
  空文字であることは常に意図的（コードレビューを通る）。
- `pickLocale` の空文字フォールバック挙動には既存テストがある
  （`i18n.test.ts` 57行目）。この挙動自体は glossary 防御として正しい。

### 2. 案の比較と採用判断

- **案A（`pickLocale()` 自体を「空文字を尊重」に変更）**: glossary データ
  の空文字翻訳（データ不備）が英語モードで「何も表示されない」に化ける。
  防御を維持するには glossary parse 側で空文字を弾く変更も必要になり、
  影響範囲が glossary・チェーンプロファイル全体に広がる。**不採用**。
- **案B（`legend.hint.suffix` の文言側で回避）**: 文言全体を1キーに
  まとめると、文中に `GlossaryTerm`（ノード発見のアンカー）を挟めなく
  なるため不可。英語 suffix に `"."` を入れる等の回避は表示文言が変わる
  うえ、「意図的な空文字がフォールバックに巻き込まれる」罠が構造として
  残る。同じ prefix/term/suffix 3分割は `internalEdge.pair.*`・
  `action.addNode.hint.pair.*` 等でも使われており、将来の文言追加で
  同種の不具合が再発しうる。**不採用**。
- **案A'（採用）: `translate()` だけ空文字を尊重し、`pickLocale()` は
  現行維持**。根拠は「コード（型検査済み・全言語必須）とデータ（不備が
  ありうる）で信頼度が違う」という境界。UI 文言の空文字は常に意図的
  なのでフォールバック不要、データ由来は従来どおり防御する。
  - 影響範囲: `messages.ts` 内の空文字は `legend.hint.suffix.en` の
    1箇所だけなので、`translate()` の挙動変更が影響するのは不具合箇所
    そのもののみ。両言語が非空のキーの挙動は変わらない。
  - glossary・チェーンプロファイル経路（`pickLocale` 直接利用）は一切
    変わらない。既存の `pickLocale` テストもそのまま有効。

### 3. 実装担当（frontend）への引き継ぎ

変更対象は以下の3ファイル。`packages/shared` の変更なし。

1. `packages/frontend/src/i18n/i18n.ts`
   - `translate()` を `pickLocale()` 経由から `entry[lang]` の直接参照に
     変える（未知キーが `key` をそのまま返す既存挙動は維持）。
     `Localized = Record<Language, string>` により `entry[lang]` は常に
     string なので追加の防御は不要。
   - docstring を更新: 「messages.ts は全言語必須の型付きコードのため、
     空文字は意図的な値としてそのまま返す（フォールバックしない。
     Issue #341）」。`pickLocale()` 側のコメントにも「UI 文言
     （translate）はここを通らない」旨を一言添える。
2. `packages/frontend/src/i18n/i18n.test.ts`
   - `translate("legend.hint.suffix", "en")` が `""` を返す（ja へ
     フォールバックしない）テストを追加。
3. `packages/frontend/src/entities/PeerNetworkLegend.test.tsx`
   - 英語モードテスト（「localizes the hint to English」）に日本語不在の
     アサーションを追加:
     `expect(legend.textContent).not.toContain("により時間とともに自動で増えます")`。
     既存の `toContain` による英語断片の検証は残す。

#### 実装順序の推奨（「直したはず」防止）

先にテスト（上記2・3）を追加し、修正前の `i18n.ts` で失敗する（不具合を
検出できる）ことを確認してから、`translate()` を修正してテストが通ることを
確認する。

#### 決定済みとして前提にしてよいこと

- `pickLocale()` の仕様・既存テストは変更しない
- `messages.ts` の `legend.hint.suffix` は空文字のまま維持する
  （文言・キー構成の変更は不要。既存コメントも正しいまま）
- `docs/ARCHITECTURE.md` §5.1 に translate / pickLocale の使い分け規則を
  記載済み（この設計で追記）

#### 実装時に判断してよいこと

- `translate()` 内部の書き方（`entry[lang]` を直接返すか、明示的な
  ローカル変数を挟むか等）
- コメント・docstring の文面の細部

### 2026-07-17 Issue #341 実装（frontend）

- 担当: frontend
- ブランチ: issue-341-i18n-empty-string-fallback（worktree上の作業ブランチ名は
  issue-341-impl-worktree）
- 内容: designerの設計メモ（案A'）どおり、以下3ファイルを変更した。
  1. `packages/frontend/src/i18n/i18n.test.ts` — `translate("legend.hint.suffix",
     "en")` が `""` を返す（jaへフォールバックしない）テストを追加。
  2. `packages/frontend/src/entities/PeerNetworkLegend.test.tsx` —
     「localizes the hint to English」テストに
     `not.toContain("により時間とともに自動で増えます")` を追加。
  3. `packages/frontend/src/i18n/i18n.ts` — `translate()` を `pickLocale()`
     経由から `entry[lang]` の直接参照に変更。`pickLocale()` 自体は
     glossaryデータ向けの防御として変更していない。両関数のdocstringに
     使い分けの理由（コードは型検査済みで空文字が常に意図的、データは
     不備がありうる）を追記した。
  - 実装順序は設計メモの推奨どおり、先にテスト1・2を追加し、修正前の
    `i18n.ts` で実際に失敗する（不具合を検出できる）ことを確認してから
    `translate()` を修正した。修正前は
    `translate("legend.hint.suffix", "en")` が
    `"により時間とともに自動で増えます"` を返し、
    `PeerNetworkLegend.test.tsx` の英語モードテストも日本語混入で失敗する
    ことを確認済み。修正後は両テストとも成功する。
  - `pnpm --filter @chainviz/frontend build` / `test`（198ファイル・2593
    テスト全通過）/ 変更ファイルへの `pnpm eslint` を実行し、いずれも
    問題なし。
- 決定事項・注意点:
  - `packages/shared` の型変更は不要（設計メモどおり）。
  - `pickLocale()` の既存挙動・既存テストは変更していない。glossaryや
    チェーンプロファイル側の空文字フォールバック防御は引き続き有効。
  - `docs/ARCHITECTURE.md` §5.1 は設計担当が既に更新済みのため、実装側
    での追加変更は行っていない。

### 2026-07-17 Issue #341 テスト強化

- 担当: tester
- ブランチ: issue-341-i18n-empty-string-fallback（worktree 上の作業ブランチ名は
  issue-341-impl-worktree）
- 内容: 実装担当が追加した基本テスト（`translate("legend.hint.suffix",
  "en")` が空文字を返す・英語ヒントに特定の日本語断片が混入しない）を土台に、
  異常系・境界値・不変条件の観点で以下を追加した。
  1. `packages/frontend/src/i18n/i18n.empty-string.test.ts`（新規）
     - translate と pickLocale の空文字境界を対比で固定する。同じ
       `{ja, en:""}` エントリに対し translate は空文字を尊重し、pickLocale は
       ja へフォールバックすること、両者が異なる結果になること（将来
       translate を再び pickLocale 経由へ戻す変更の検出）、translate の ja 側は
       非空値を素通しすることを検証。
     - messages.ts の意図的な空文字が `legend.hint.suffix.en` の1箇所だけで
       あるという設計メモ §1 の前提を不変条件テストとして固定
       （全キー×全言語を走査し、空文字ペアが `[["legend.hint.suffix","en"]]`
       と一致することを assert）。別キーで空文字を足すとこのガードを踏むため、
       追加時に意図の確認と回帰テスト追加を促せる。
     - translate の「未知キーはキー文字列を返す」契約が #341 の内部実装変更
       （pickLocale 経由 → entry[lang] 直接参照）後も両言語で保たれること、
       空文字キーでも例外を投げないことを確認。
  2. `packages/frontend/src/entities/PeerNetworkLegend.test.tsx`（追記）
     - 英語ヒント（`.p2p-legend__hint`）に、特定の語句ではなく文字種
       （ひらがな・カタカナ・CJK 漢字）で日本語が一切混入しないことを検証する
       広い回帰ガードを追加。将来 suffix の文言が変わっても ja フォールバック
       の再発を捕まえられる。
  - 「直したはず」防止として、修正前の実装（translate を pickLocale 経由に
    戻した状態）で新規テストが実際に失敗すること（境界テスト・CJK ガード・
    既存 #341 テストの計5件が FAIL、messages.ts の不変条件テストは実装非依存の
    ため PASS のまま）を確認してから実装を元に戻した。
  - `npx eslint`（変更2ファイル）・`pnpm --filter @chainviz/frontend build`・
    `pnpm --filter @chainviz/frontend test`（199 ファイル・2602 テスト全通過）を
    実行し、いずれも問題なし。
- 決定事項・注意点:
  - 新機能の実装・既存実装ロジックの変更は行っていない。テスト追加のみ。
  - `legend.hint.suffix` を参照するコンポーネントは `PeerNetworkLegend.tsx`
    の1箇所だけであることを grep で確認済み。他コンポーネント向けの追加
    回帰テストは不要。
  - 報告事項（軽微な堅牢性ギャップ、実装変更は保留）: `translate()` に
    `Object.prototype` 由来のキー（`"toString"` / `"constructor"` /
    `"hasOwnProperty"` 等）を渡すと、`messages[key]` がプロトタイプチェーン
    経由の関数を拾い `entry[lang]` が `undefined` を返す（「未知キーは
    キー文字列を返す」契約から外れる）。型 `MessageKey` により通常のコード
    からは到達不能で、#341 が新たに生んだ問題でもない（従来は pickLocale
    経由で空文字を返していた）ため今回は修正・失敗テストの追加を見送った。
    恒久対応するなら `format()` と同じく
    `Object.prototype.hasOwnProperty.call(messages, key)` で自己プロパティを
    確認する防御が考えられる。

### 2026-07-17 Issue #341 レビュー

- 担当: reviewer
- ブランチ: issue-341-i18n-empty-string-fallback（worktree 上の作業ブランチ名は
  issue-341-impl-worktree）
- 内容: frontend 実装（案A': `translate()` を `pickLocale()` 経由から
  `entry[lang]` の直接参照に変更）と tester のテスト強化に対する静的レビュー。
  結果は**合格**。
  - `packages/shared` の変更なしを diff で確認（変更は
    `packages/frontend/` 4ファイル + `docs/` 4ファイルのみ）。設計メモ
    どおり frontend で完結している
  - `pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で実行し
    全通過（shared 74 / collector 1563 / e2e 171 / frontend 2602 テスト）
  - テストが実際に不具合を検出できることを変異テストで再確認: `translate()`
    を修正前の `pickLocale(entry, lang)` に戻した状態で対象3ファイルを実行し、
    worklog の記載どおり**5件がちょうど失敗**（空文字境界2件・i18n.test.ts の
    #341 テスト1件・PeerNetworkLegend の英語モード2件）、messages.ts の
    不変条件テストは実装非依存のため PASS のままであることを実測。確認後に
    `git checkout` でファイルを復元し、worktree がクリーンであることを確認済み
  - テストコードの質: 「translate と pickLocale が同じ入力で意図的に異なる
    結果を返す」境界そのものを対比で固定するテスト、意図的空文字が
    `legend.hint.suffix.en` の1箇所だけという設計前提の不変条件テスト、
    特定語句に依存しない文字種（ひらがな・カタカナ・CJK漢字）ベースの
    広い回帰ガードのいずれも、実装の詳細をなぞるだけでない実質的な検証に
    なっている。正規表現の文字範囲（U+3040-30FF, U+4E00-9FFF）はコメントの
    説明と一致
  - エラー握りつぶし・環境依存の決め打ち定数: 該当なし（純粋関数の1行変更と
    テスト・docs のみ。タイムアウト等の時間依存値は登場しない）
  - コミット粒度: 設計docs / 修正+基本テスト / 境界テスト追加 / 回帰ガード
    追加 / worklog がそれぞれ分かれており、1変更1コミットを満たす。
    d14950e に i18n.ts とテスト2ファイルが同居しているのは「修正とその修正を
    検証する回帰テスト」で1つの関心事のため妥当
  - docs 整合: `docs/ARCHITECTURE.md` §5.1（translate/pickLocale の使い分け
    規則）が実装・コメントと一致。`docs/PLAN.md` の #341 チェックボックスは
    実装担当が更新済み（修正方針の要約付き）で記述も実装と一致。
    `docs/WORKLOG.md` 索引の #341 行も更新済み
- 決定事項・注意点:
  - **tester 申し送り（`Object.prototype` 由来キーの問題）は #341 スコープ外
    として見送りと判断**。根拠:
    - `translate()` の呼び出し口は `LanguageProvider` の
      `t: (key: MessageKey) => string` の1箇所のみで、production コードに
      `MessageKey` へのキャストや動的キー生成は存在しないことを grep で確認。
      型により到達不能
    - #341 以前も `pickLocale(関数, lang)` 経由で「未知キーはキー文字列を
      返す」契約は破れていた（`""` を返していた）ため、#341 が新規に生んだ
      問題ではない。#341 後は戻り値が `""` から `undefined` に変わったが、
      到達不能である点は同じ
    - 恒久対応（`format()` と同様の `Object.prototype.hasOwnProperty.call`
      ガード1行）は価値があるが、到達不能な理論的経路のために実装差し戻し・
      再テスト・再レビューの1サイクルを回すのは過剰。対応するなら別Issue
      （バックログの軽微な堅牢性項目）として起票するのが妥当。起票の要否は
      統括に委ねる
