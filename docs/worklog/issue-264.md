### 2026-07-11 Issue #264 glossaryのlookup/parseにプロトタイプ汚染的なガード漏れの可能性(describeNodeRole/describeSyncStageと同種)

#### 設計メモ(着手前)

- 対象:
  1. `packages/frontend/src/glossary/GlossaryProvider.tsx` の
     `lookup: (key) => glossary[key]`(読み取り側、ガード無しブラケット
     アクセス)
  2. `packages/frontend/src/glossary/parse.ts` の `parseGlossaryYaml` 内
     `glossary[key] = term`、および `mergeGlossaries` の
     `Object.assign({}, ...parts)`(書き込み側)
- 調査結果(素朴な再現スクリプトで確認済み):
  - 読み取り側: `Glossary` はオブジェクトリテラル(`{}`)で構築されるため
    `Object.prototype` を継承する。`lookup("toString")` は
    `[Function: toString]` を、`lookup("constructor")` は
    `[Function: Object]` を返してしまう(`describeNodeRole`/
    `describeSyncStage` と全く同じ穴)。`GlossaryTerm.tsx` は
    `const term = lookup(termKey); if (!term) {...}` という判定をしており、
    関数はtruthyなので「用語が見つかった」扱いになってしまう
    (`term.name` は `undefined` になり、以降のレンダリングが壊れる)。
  - 書き込み側: YAMLのマッピングキーが `__proto__` の場合、
    `glossary["__proto__"] = term` は
    「`glossary` に `__proto__` という名前の own property を作る」の
    **ではなく**、`glossary` オブジェクト自体の `[[Prototype]]` を
    `term` に差し替えてしまう(Annex B の `__proto__` アクセサの仕様)。
    実際に確認したところ、`Object.keys(glossary)` には現れない
    (`Object.hasOwn(glossary, "__proto__")` も `false`)にもかかわらず、
    `Object.getPrototypeOf(glossary)` が `term` そのものになり、
    `glossary.toString` 等の継承解決が壊れた状態になることを確認した。
    `glossary/ethereum/terms/*.yaml` はプロジェクト管理下でリスクは
    低いが、Issue #215/#258と同じクラスの穴として対応する。
- 修正方針:
  1. 読み取り側(`GlossaryProvider.tsx`)は `describeNodeRole`/
     `describeSyncStage` と同じ `Object.hasOwn` ガードを追加する。
     `glossary` プロップは外部(App.tsx・テスト)から任意のオブジェクトを
     注入できるため、`parse.ts` 側をどう直しても読み取り側で独立して
     ガードする必要がある。
  2. 書き込み側(`parse.ts`)は `Object.create(null)` ベースで
     `Glossary` を構築する(素の `{}` は `__proto__` という名前の
     アクセサを継承しているため、`Object.create(null)` でその継承自体を
     断つ)。`Object.create(null)` の戻り値は `any` になるため
     `as Glossary` で型を明示する。`mergeGlossaries` の合成先
     (`Object.assign` の第一引数)も同様に `Object.create(null)` にする
     (合成元がすでに `__proto__` という own property を持つケースで、
     `Object.assign` の書き込み先が素の `{}` のままだと、そちら側で
     同じ罠を踏んで汚染されるため。素朴なスクリプトで実際にこの2段階の
     罠を再現・確認済み)。
- テスト方針:
  - `GlossaryProvider.tsx` には既存のテストファイルが無いため
    `GlossaryProvider.test.ts` を新規作成し、`@testing-library/react` の
    `renderHook` + `useGlossary` で `lookup` を直接検証する
    (`toString`/`constructor`/`__proto__`/`hasOwnProperty` 等が
    `undefined` を返すこと、既存キーは通常どおり引けること)。
  - `parse.ts` の既存 `parse.test.ts` はすでに231行と大きく複数の関心事
    (基本パース・実データ回帰・マージ)が同居しているため、これ以上
    肥大化させないよう、プロトタイプ汚染ガードに関するケースは
    `parse.protoGuard.test.ts` に分離して追加する(CLAUDE.mdの「テストも
    関心事ごとに分割を検討する」方針)。

#### 実施内容

- `GlossaryProvider.tsx` の `lookup` に `Object.hasOwn` ガードを追加
  (`describeNodeRole`/`describeSyncStage` と同じ流儀)。修正前に
  `lookup("toString")` 等が継承メンバを返してしまうことを一時的に
  ガードを外して確認した上で、修正後は `undefined` を返すことを確認
- `parse.ts` の `parseGlossaryYaml`/`mergeGlossaries` を
  `Object.create(null)` ベースの構築に変更。修正前に `__proto__` という
  YAMLキーを持つ入力で `glossary` 自身の `[[Prototype]]` が書き換わって
  しまうことを一時的に修正を戻して確認した上で、修正後は
  `Object.hasOwn(glossary, "__proto__")` が `true` になり
  (通常の own property として扱われる)、`Object.getPrototypeOf(glossary)`
  が `null` のまま保たれることを確認
- 回帰テストを追加:
  - `GlossaryProvider.test.tsx`(新規): `useGlossary` の `lookup` を
    `renderHook` で直接検証。既存キーの解決・未登録キーのフォールバック・
    継承メンバ名(`toString`/`constructor`/`__proto__`/`valueOf`/
    `hasOwnProperty`/`isPrototypeOf`)での undefined フォールバックを固定
  - `parse.protoGuard.test.ts`(新規、`parse.test.ts` からプロトタイプ
    汚染ガードの関心事を分離): `__proto__` というキーを持つYAMLの
    パース結果が own property として扱われること、`glossary`/`merged`の
    プロトタイプが書き換わっていないことを固定
  - いずれのテストも、修正前のコード(ガード無し版)に一時的に戻した状態で
    実行すると確実に失敗することを確認済み(テストが元の不具合を実際に
    検出できることの裏取り)
- `docs/PLAN.md` のバックログに本Issueの項目を追加しチェック済みにした

#### 決定事項・注意点

- `parse.test.ts` の既存アサーション`expect(parseGlossaryYaml("")).toEqual({})`
  は、`Object.create(null)` に変更した後も通ることを確認済み(vitest/jestの
  `toEqual` はプロトタイプの厳密一致までは見ないため。プロトタイプまで
  含めた厳密比較が必要な場面では `toStrictEqual` を使う必要があるが、
  今回はそこまでは求めていない)
- `mergeGlossaries` の合成先も `Object.create(null)` にした理由: 合成元
  (`parseGlossaryYaml` の出力)がすでに `"__proto__"` を own property として
  持つケースで、`Object.assign` の書き込み先が素のオブジェクトリテラルの
  ままだと、そちらの `__proto__` アクセサに引っかかり同じ罠を踏むため
  (2段階の罠。素朴なスクリプトで実際に再現・確認済み)
- Issue #258 のレビューで申し送りのあった2箇所(`GlossaryProvider.tsx`と
  `parse.ts`)にはこれで対応済み。`chain-profiles/ethereum` 配下の他ファイル
  は #258 の時点で確認済み(該当なし)のため、本Issueでは再確認していない

#### テスト強化(異常系・境界値)

実装担当が書いた基本テストに対し、以下の観点でケースを追加した。

- `GlossaryProvider.test.tsx`(lookup の読み取り側):
  - `Object.prototype` の全メンバ名を総当たりで lookup し、いずれも
    `undefined` を返すことを固定(`toString`/`constructor` 等の代表例だけ
    でなく、`Object.getOwnPropertyNames(Object.prototype)` + `__proto__` を
    網羅。将来 lookup が個別キーの名指しブラックリストに退化しても検知
    できるようにする)
  - ガードが過剰に弾かないことの確認: `Object.create(null)` ベースの
    glossary に正当な own property として `__proto__` キーの用語を格納した
    場合、lookup がそれを(undefined ではなく)返すこと。継承メンバの漏れ
    防止と、正当な own property の解決を両立していることを固定
- `parse.protoGuard.test.ts`(書き込み側・マージ・下流互換):
  - `mergeGlossaries` で `__proto__` キーの用語が後勝ちの own property
    上書きになること、上書き後も列挙に1回だけ現れることを固定
  - `Object.create(null)` 化が通常マージを壊していないこと: 先行 part の
    エントリ保持、3 part 以上での後勝ち、空 glossary を挟んでも他が消えない
    こと、Object.assign による浅いコピー(結果を破壊しても元 part に波及
    しない)、単一 part のマージ
  - `Object.create(null)` 化の下流互換(継承メソッドが無いことで既存
    コードを壊していないか): 実データをマージした glossary が
    `Object.entries`/`Object.keys`/`Object.values`/`for...in`/
    `JSON.stringify`/オブジェクトスプレッドで正しく扱えること
- 追加した回帰テストは、実装を修正前(素の `{}` ベース・ガード無し)に
  一時的に戻すと失敗することを確認済み(8件が失敗し、元の不具合を実際に
  検出できることを裏取り。確認後に実装を修正版へ復元)
- `packages/frontend` の `pnpm build`・`pnpm test`(119ファイル1837件)が
  全て通ることを確認済み

#### レビュー(chainviz-reviewer)

- 担当: reviewer
- ブランチ: issue-264-glossary-proto-guard
- 判定: **合格**
- 確認内容:
  - `Object.create(null)` 化の下流影響の横断確認: `parseGlossaryYaml`/
    `mergeGlossaries` の戻り値を使うのは `data.ts`(モジュールレベルの
    マージ)と `App.tsx`(GlossaryProvider へのプロップ渡し)のみで、
    glossary オブジェクトに対する `instanceof` チェックや
    `glossary.hasOwnProperty(...)` のような継承メソッドの直接呼び出しは
    frontend 全体に存在しないことを grep で確認した。`index.ts` で
    parse.js が再エクスポートされているが、他パッケージ
    (collector/shared/e2e)からの利用は無い。lookup 経由の消費者は
    `GlossaryTerm.tsx` のみ
  - 2方針の使い分けの妥当性: 読み取り側(`lookup`)は #215/#258 と同じ
    `Object.hasOwn` ガード、書き込み側(`parse.ts`)は `Object.create(null)`。
    書き込み側は動的キーの代入時に `__proto__` アクセサ経由の
    `[[Prototype]]` 書き換えを防ぐ必要があり、読み取りガードでは
    防げないため、この使い分けは妥当。読み取り側を parse 修正後も
    残す理由(glossary プロップは外部から任意のオブジェクトを注入
    できる)も worklog に明記されており妥当
  - テストが元の不具合を検出できることの裏取り: `parse.ts` と
    `GlossaryProvider.tsx` を一時的に main 版へ戻して新規テスト2ファイルを
    実行したところ、worklog の記述どおり8件が失敗することを確認した
    (確認後に完全復元、`git status` クリーンを確認)
  - リポジトリ全体で `pnpm build`(exit 0)・`pnpm lint`(exit 0)・
    `pnpm test`(exit 0、shared 62 / e2e 108 / collector 1167 /
    frontend 1837 件すべて合格)を確認した
  - コミット粒度: 読み取り側修正・書き込み側修正・テスト強化・docs で
    計5コミットに分かれており、いずれも Conventional Commits 準拠。
    各 fix コミットに対応するテストが同じコミットに含まれている
  - docs: `docs/PLAN.md` のバックログ項目チェック+Issueリンク、
    `docs/WORKLOG.md` 索引の1行追加、本ファイルの記録が実装と一致
- 軽微な指摘(差し戻しはしない): `GlossaryProvider.tsx` のコメント
  「App.tsx の既定値・テストのモックともに `Object.prototype` を継承する」
  は、同ブランチ内の parse.ts 修正後は前半が事実と異なる(App.tsx の
  既定値 = `data.ts` の `mergeGlossaries` 出力は現在プロトタイプが null)。
  ガードの必要性(プロップは外部注入可能)は変わらないため動作上の問題は
  無いが、次にこのファイルへ触れる際にコメントを「テストのモック等、
  外部から注入される glossary は `Object.prototype` を継承しうる」の
  趣旨へ直すとよい

#### QA検証記録(chainviz-qa)

- 担当: qa
- ブランチ: issue-264-glossary-proto-guard
- 判定: **合格**(完了条件を満たしている)
- 主眼: 修正がUIの通常動作(用語解説機能)に悪影響を与えていないことの
  正常系回帰確認。実際に実データ(`glossary/ethereum/terms/*.yaml` 全4
  ファイル)を本物の `parse.ts`(`parseGlossaryYaml`/`mergeGlossaries`)と
  `GlossaryProvider` の `lookup` 実装に流して、UI表示までの経路を実機で
  確認した。
- 実施内容と結果:
  1. glossary関連の既存テスト一式(`parse.test.ts`/`parse.protoGuard.test.ts`/
     `GlossaryProvider.test.tsx`/`GlossaryTerm.test.tsx`/
     `GlossaryTerm.testid.test.tsx`)を実行し、51件全て合格。
  2. 実データ end-to-end マージ+lookup確認(一時テストで実測、確認後削除):
     4ファイルを `mergeGlossaries(parseGlossaryYaml(...))` でマージ。
     マージ後の総用語数は33語(a-infra 7 + b-network 7 + c-transaction 15
     + d-internal 4)で、各ファイルの用語がマージ後も1件も欠落しないこと、
     全33語が `lookup` で解決し `name`/`definition` が ja/en 両言語とも
     非空であることを確認。`Object.getPrototypeOf(merged)` が `null` の
     まま保たれること(汚染なし)も確認。
  3. 実データ注入のUI回帰(一時テストで実測、確認後削除):
     実マージ済み glossary を `GlossaryProvider` に注入した状態で
     `GlossaryTerm` をレンダリングし、既知の用語(先頭キー `container`)が
     下線付き(`glossary-term--unknown` が付かない)で表示され、
     `mouseEnter` でポップオーバーに用語名+定義(+関連語)が正しく
     表示されることを確認。あわせて継承メンバ名 `toString` を termKey に
     渡すと `glossary-term--unknown` 扱い(下線なし)になり、ガードが
     通常表示を壊さず異常系だけを弾いていることを確認。
  4. `packages/frontend` の `pnpm build`(tsc -b)が exit 0 で成功。
     検証で作成した一時テストは全て削除し、`git status` がクリーンで
     あることを確認済み。
- 結論: 用語解説(GlossaryTerm ホバー表示)の通常動作は従来どおり正常で、
  複数glossaryファイルのマージ・全用語のlookup解決に回帰は無い。
  完了条件を満たす。
