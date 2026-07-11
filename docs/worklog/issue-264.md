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
