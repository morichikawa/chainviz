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
