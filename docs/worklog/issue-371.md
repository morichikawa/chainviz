# Issue #371 i18n translate()にObject.prototype由来キー(toString等)への防御が無い

### 2026-07-17 Issue #371 起票とバックログ追記のレビュー

- 担当: reviewer
- ブランチ: docs-issue-371-backlog
- 内容: Issue #341(p2p-legendの日英混在)のレビュー中に見つかった軽微な
  堅牢性の指摘について、統括が Issue #371 を起票し `docs/PLAN.md` の
  バックログに追記した。その内容をレビューした。
- レビュー結果: 合格
  - Issue #371 本文と PLAN.md の追記が過不足なく一致(発見経緯が
    Issue #341 のレビュー中であること・型 `MessageKey` により通常の
    コードから到達不能であること・#341 以前からの既存挙動であること・
    既存の `format()` と同様の `hasOwnProperty` ガードを追加するという
    期待対応・対象パッケージ frontend)
  - Issue 本文が参照する事実の実在確認: `packages/frontend/src/i18n/i18n.ts`
    の `translate()` (57-61行)は `messages[key]` を無ガードで参照しており
    プロトタイプ由来キーで契約(未知キーはキー文字列を返す)が破れる。
    同ファイルの `format()` (75行)には
    `Object.prototype.hasOwnProperty.call()` ガードが実在。production
    コードで `translate()` を呼ぶのは
    `packages/frontend/src/i18n/LanguageProvider.tsx` の1箇所のみ、という
    記述も grep で確認し正確
  - 追記フォーマットは既存バックログ項目(チェックボックス行+括弧書きの
    補足+末尾の Issue リンク行)と一貫。配置(バックログ節末尾)も適切
  - コミット粒度: #371/#373 追記と #346 記載更新が1コミットに
    まとまっているが、いずれも「Issue #346 の対応で判明した事項の
    バックログ反映」という単一の関心事であり妥当と判断
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
- 決定事項・注意点:
  - 実装着手は後日。`translate()` に `hasOwnProperty` ガードを追加する
    軽微な修正で、着手時は回帰テスト(プロトタイプ由来キーでキー文字列が
    返ること)もあわせて書く
  - docs 配下のみの変更のため、CLAUDE.md の例外規定に基づき
    chainviz-qa は省略(reviewer 合格のみ)

### 2026-07-18 Issue #371 実装設計メモ

- 担当: frontend
- ブランチ: issue-371-i18n-prototype-guard
- 方針:
  - `packages/frontend/src/i18n/i18n.ts` の `translate()` を、
    `messages[key]` への無ガードアクセスから
    `Object.prototype.hasOwnProperty.call(messages, key)` で自己プロパティを
    確認するガードに変更する。ガードが false のときは既存の「未知キーは
    キー文字列を返す」契約どおり `key` を返す。同ファイル内の `format()`
    (`params` に対する同種のガード)と実装パターンを揃える
  - `messages` はモジュールスコープの単一オブジェクトで再代入されないため、
    ガード対象は関数引数の `key`(`MessageKey` 型の文字列)のみでよい。
    `entry` を取り出した後に `entry[lang]` を読む処理自体は変更しない
  - 修正前に `translate("toString", "ja")` 等を実行し、実際に `undefined`
    が返る(契約違反)ことを手元で確認してから着手する。修正後は同じ入力で
    `"toString"` のようにキー文字列がそのまま返ることを確認する
- 影響範囲: `translate()` の呼び出し元は `LanguageProvider.tsx` の1箇所
  (レビュー時点で確認済み)のみで、通常の呼び出しは型 `MessageKey` により
  プロトタイプ由来キーを渡せないため、実装ロジック側への挙動変化はない
  (テストコードでの型キャスト経由の呼び出しのみ影響)

### 2026-07-18 テスト強化メモ

- 担当: tester
- ブランチ: issue-371-i18n-prototype-guard
- 既存テストの状況: `i18n.test.ts` の `translate` describe に
  `toString`/`constructor`/`hasOwnProperty` を渡す回帰テストが1件あり、
  `format` describe にも `{toString}` プレースホルダのガードテストがある。
  正常系(実在キーの引き)も `card.node` 等でカバー済み。
- 追加方針(依頼された3観点):
  1. `Object.prototype` 由来の他キー(`valueOf`/`isPrototypeOf`/
     `propertyIsEnumerable`/`toLocaleString`/`__proto__`/
     `__defineGetter__`)でも `translate()` がキー文字列を返すことを
     ja/en 両言語で確認する。`__proto__` は `messages["__proto__"]` が
     プロトタイプ(object)を返す特殊ケースだが `hasOwnProperty` は false
     のためガードで保護されることを別途確認する。
  2. 実在する `MessageKey`(複数)がガード追加後も ja/en を正しく引ける
     ことを回帰として確認する(既存の正常系が壊れていないことの担保)。
  3. `translate()` の新ガードと `format()` の既存ガードが、同一の
     プロトタイプ由来キー集合に対して同じ「素通し」挙動をすることを
     並べて比較する。
- ファイル分割: プロトタイプ汚染防御という単一の関心事のため、
  `i18n.test.ts` を肥大化させず専用ファイル
  `i18n.prototype-guard.test.ts` に追加する。既存の `i18n.test.ts` の
  該当テストはそのまま残す(削除・移動はしない)。
- 事前確認: 上記キー集合について実測し、いずれも
  `hasOwnProperty.call(messages, key) === false`、ガード無しでは
  `entry[lang] === undefined`(契約違反)になることを確認済み。

### 2026-07-18 静的レビュー

- 担当: reviewer
- ブランチ: issue-371-i18n-prototype-guard
- レビュー結果: 合格
  - `translate()` の修正内容: `Object.prototype.hasOwnProperty.call(messages, key)`
    で自己プロパティを確認し、false ならキー文字列を返す。既存 `format()`
    (`params` に対する同一パターン)と完全に一致していることを確認。
    シグネチャ `translate(key: MessageKey, lang: Language): string` は不変で、
    型契約(`MessageKey = keyof typeof messages`)への影響なし。ガード後の
    `as Localized` キャストも hasOwnProperty 通過後のみ到達するため安全
  - 専用テスト `i18n.prototype-guard.test.ts`(102行)の質:
    - プロトタイプ由来11キー + `__proto__`(値がオブジェクトになる特殊
      ケースを別テストで明示)を ja/en 両言語でカバー
    - 「キーが本当に継承プロパティである」前提の自己検証テストがあり、
      環境差で前提が崩れた場合に検出できる
    - 実在キー4件(`card.node` 等。`messages.ts` に実在することを確認)の
      正常系回帰、`translate()`/`format()` のガード挙動一致の比較テストあり
    - **ミューテーション確認を実施**: `i18n.ts` を修正前(main)の状態に
      一時的に戻して該当テストを実行し、24件が実際に失敗することを確認
      してから復元した。壊れたコードでも通る「意味のないテスト」ではない
  - エラー握りつぶし: 変更範囲に catch 節・汎用メッセージへのすり替え・
    偽の成功応答は無し
  - コミット粒度: fix / test / docs×2 の4コミットで、いずれも単一の
    関心事。Conventional Commits 形式に準拠
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
    (shared 75 / collector 1660 / e2e 179 / frontend 2770)
- 注意点(統括向け):
  - ブランチの分岐点(f3569cb)は main の先端よりやや古いが、ブランチの
    コミットが触るファイルは i18n 関連と worklog のみで、main 側の先行
    変更と競合しない。マージ時に特段の対応は不要の見込み
