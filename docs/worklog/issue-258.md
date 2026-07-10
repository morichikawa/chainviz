### 2026-07-11 Issue #258 describeSyncStageがObject.prototypeの継承メンバを漏らす可能性がある(describeNodeRoleと同種の穴)

#### 設計メモ(着手前)

- 対象: `packages/frontend/src/chain-profiles/ethereum/syncStageLabels.ts`
  の `describeSyncStage`
- 調査結果: `describeNodeRole`(Issue #215で修正済み、コミット`25c6d98`)が
  修正される前と全く同じパターンで、オブジェクトリテラル
  `SYNC_STAGE_LABELS` にガード無しブラケットアクセス
  (`SYNC_STAGE_LABELS[stage]`)をしていることを確認した。実際に
  `describeSyncStage("toString")` 等を素朴な再現スクリプトで実行すると
  `Object.prototype` の継承メンバ(関数や `Object` コンストラクタ自体)が
  真値として返ってきており、脆弱性が実在することを確認済み。
  - `toString` → `[Function: toString]`
  - `constructor` → `[Function: Object]`
  - `__proto__` → `[Object: null prototype] {}`
  - `valueOf` → `[Function: valueOf]`
- 修正方針: `describeNodeRole` と同じ方針で、`Object.hasOwn` により
  「`SYNC_STAGE_LABELS` 自身の列挙可能プロパティかどうか」を確認してから
  引くガードを追加する。`describeSyncStage` は元々 `stage: string`
  (undefined を受け付けない)ため、`describeNodeRole` にある
  `nodeRole === undefined` の早期リターンは不要(呼び出し側のシグネチャに
  変更を加える理由が無いため、パラメータ型はそのまま維持する)。
- テスト方針: `nodeRoles.test.ts` に追加された回帰テスト
  (`does not leak inherited Object.prototype members for
  prototype-pollution-like values`)と同種のケースを
  `syncStageLabels.test.ts` に追加し、`toString` / `constructor` /
  `__proto__` / `valueOf` / `hasOwnProperty` / `isPrototypeOf` が
  いずれも `undefined` を返すことを固定する。

#### 実施内容

- `describeSyncStage` に `Object.hasOwn(SYNC_STAGE_LABELS, stage)` ガードを
  追加し、自身の列挙可能プロパティでない場合は `undefined` を返すよう修正
  (修正前に素朴な再現スクリプトで問題を確認済み。修正後は
  `describeSyncStage("toString")` 等がすべて `undefined` を返すことを
  vitest で確認)
- `syncStageLabels.test.ts` に回帰テストを追加
  (`does not leak inherited Object.prototype members for
  prototype-pollution-like values`)
- `docs/PLAN.md` のバックログに本Issueの項目を追加しチェック済みにした

#### 決定事項・注意点

- `describeNodeRole` と異なり `describeSyncStage` は `undefined` 引数を
  受け付けないシグネチャのままなので、そこは変更していない
  (`Object.hasOwn` ガードのみ追加)
- 同じ「フロント表現セット」流儀のオブジェクトリテラル
  (`nodeInternals.ts` の `ENGINE_API_METHOD_LABELS` など)についても同種の
  懸念が無いか、将来的に横断確認する余地がある(本Issueのスコープ外の
  ため対応はしていない)
