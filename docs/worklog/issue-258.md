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

#### レビュー記録(chainviz-reviewer、2026-07-11)

- 判定: **合格**
- 確認内容:
  - 修正方針は `describeNodeRole`(Issue #215)と一貫している
    (`Object.hasOwn` ガード。`stage: string` は `undefined` を受け付けない
    シグネチャのため早期リターン省略も妥当)
  - 回帰テストの実効性をミューテーション確認で検証した。ガード行を
    一時的に削除した状態で `syncStageLabels.test.ts` を実行すると
    追加テストが失敗し、復元すると通ることを確認(テストが実際に元の
    不具合を検出できる)
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ合格
    (shared 62 / collector 1154 / frontend 1733 / e2e 97)
  - コミット粒度(fix+テストで1コミット、docsで1コミット)・
    Conventional Commits 準拠を確認
  - docs(worklog/PLAN.md/WORKLOG.md 索引)が実装を正しく反映している
- 申し送り(別途Issue化を推奨):
  - `chain-profiles/ethereum` 配下の他ファイルに同種の穴は無い
    (`nodeInternals.ts` は配列+前方一致、`operationCatalog.ts` は配列)
  - ただし `packages/frontend/src/glossary/` に類似パターンが2箇所ある:
    (1) `GlossaryProvider.tsx` の `lookup: (key) => glossary[key]` が
    ガード無しブラケットアクセス(キーが `"toString"` 等のとき継承メンバを
    返しうる)、(2) `parse.ts` の `glossary[key] = term` は YAML のキーが
    `"__proto__"` の場合にプロトタイプ汚染書き込みになりうる。いずれも
    キーの供給源はコード内定数・プロジェクト管理下の YAML であり実害の
    リスクは低いが、#215/#258 と同じクラスの穴のため別Issueでの対応を推奨

#### QA検証記録(chainviz-qa、2026-07-11)

- 判定: **合格**（完了条件「修正がUIの通常動作に悪影響を与えていない」を満たす）
- 検証環境: worktree `wt-issue-258`（ブランチ `issue-258-syncstage-proto-guard`）
- 実施内容:
  1. `syncStageLabels.test.ts`（ユニット5件）が全て合格することを確認。
  2. 実際の UI コンポーネント `InfraPopoverSyncStages` /
     `InfraNodeCardSyncProgress` を testing-library でレンダリングする
     一時的なQAテストを作成し、以下を実UIレンダリングで確認した
     （検証後にファイルは削除、ツリーはクリーン）:
     - 回帰確認: 既知ステージ（`Headers`→「ヘッダ取得」、`Execution`→
       「実行」）が従来通り和訳表示される。
     - 未知ステージ（`MerkleUnwind` 等）が生名のままフォールバック表示
       される（元からの縮退動作が維持されている）。
     - 異常系: collector から `toString` / `constructor` / `__proto__` の
       ような継承メンバ名が送られてきた場合でも、生名がそのまま表示され、
       DOM に関数（`function` / `[object ...]`）が漏れ出さないことを確認。
  3. 回帰検出力の裏取り: `Object.hasOwn` ガード行を一時的に削除した
     修正前状態で同じQAテストを実行すると、UI描画で2件が失敗する
     （継承メンバの関数が `pickLocale` に渡り生名フォールバックに倒れない）
     ことを確認。ガードを復元すると全件合格に戻ることも確認した。
- 結論: ガード追加は通常のステージ表示（syncing/synced 系）に悪影響を
  与えておらず、異常系のフォールバックも正しく機能する。
