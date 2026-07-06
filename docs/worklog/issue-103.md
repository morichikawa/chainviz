# Issue #103 作業記録

### 2026-07-06 Issue #103 compose起動ノードの削除ボタン改善のバックログ追加(docsのみ)をレビュー

- 担当: reviewer
- ブランチ: docs-plan-add-103-backlog
- 内容: `docs/PLAN.md` のバックログセクションに Issue #103(compose起動
  ノードの削除ボタンを押すと必ずエラーになる)を未着手項目 `[ ]` として
  追加する変更(コミット 8deb73e、PLAN.md のみ 3 行追加)をレビューし、
  合格と判定した
- 確認結果:
  - GitHub Issue #103 は OPEN。タイトル「compose起動ノードの削除ボタンを
    押すと必ずエラーになる(UIで防げていない)」が PLAN.md の記載と一致。
    ラベルは frontend
  - Issue 本文の前提が実装と一致することを確認した。
    `packages/collector/src/adapters/ethereum/node-lifecycle.ts` の
    `removeNode` は `addNode`(および起動時のラベル回収)で登録された
    ノードのみ削除でき、未登録なら
    `node <id> was not added via addNode and cannot be removed` を投げる。
    一方 `packages/frontend/src/entities/InfraNodeCard.tsx` は全ノード
    カードに無条件で削除(×)ボタンを表示しており、Issue の指摘どおり
  - 対応方針(`NodeEntity` に `removable: boolean` を追加し collector 側で
    設定、フロントは表示を出し分け)は境界原則と整合する。`removable` は
    チェーン非依存の語彙であり、フロントが Docker/ノードに直接触れず
    ワールドステート経由で判断できるため筋が良い。`packages/shared` の
    型変更を伴う旨も Issue 本文に明記済み
  - 既存バックログ項目と同じ書式(未解決は `[ ]`、Issue リンク併記)に
    揃っている。コミットは 1 件で関心事も 1 つ
  - `pnpm lint` 通過(exit 0)。docs のみの変更のため build/test への影響なし
- 決定事項・注意点: 実装時は `chainviz-reviewer` 経由で `packages/shared`
  の型変更を調整すること(Issue 本文にも記載あり)。ワークベンチは全て
  `addWorkbench` 経由で作られるため `removable` 相当のフィールドは
  `NodeEntity` 側だけで足りる見込み

### 2026-07-06 Issue #103 removable フラグの設計と shared 型定義

- 担当: designer(設計)
- ブランチ: issue-103-removable-node-flag
- 内容: 削除可否フラグの設計を確定し、`packages/shared` の型定義・テスト・
  `docs/ARCHITECTURE.md` §2 を更新した。collector/frontend の実装は行って
  いない(引き継ぎ内容は下記)。
  - `packages/shared/src/world-state/entities.ts`: `InfraEntity` に
    `removable?: boolean` を追加(JSDoc に意味論を明記)
  - `packages/shared/src/world-state/entities.test.ts`: removable あり/なし
    両ケースのテストを追加
  - `docs/ARCHITECTURE.md` §2: `InfraEntity` のスキーマに同フィールドを反映
  - 全パッケージで `pnpm build && pnpm test` 通過を確認(shared 8 件、
    frontend 411 件、collector 含め全緑)
- 決定事項・注意点:
  - **フィールドは `NodeEntity` 単独ではなく基底の `InfraEntity` に置く**。
    前回レビュー記録の「ワークベンチは全て addWorkbench 経由で作られる」
    という見立ては誤りで、`profiles/ethereum/docker-compose.yml` には
    `workbench` サービス(foundry)が定義されており、compose 起動の
    ワークベンチにもノードと同一の不具合(× ボタン表示 → `removeWorkbench`
    が拒否)が存在する。`InfraNodeCard.tsx` はノード/ワークベンチ共通の
    コンポーネントなので、基底型に置けば 1 箇所の修正で両方直る
  - **optional(`removable?`)にし、省略時は false(削除不可)と同義とする**。
    理由: (1) 設計フェーズの shared 変更だけで既存 collector/frontend の
    ビルドを壊さない、(2) フィールド未付与の旧スナップショット・リプレイを
    「削除不可」の安全側に倒せる(削除 UI は collector が明示的に true と
    言ったときだけ出る)。required にしないことによる曖昧さは JSDoc と
    ARCHITECTURE.md の「省略時は false と同義」で固定した
  - **値の導出はライフサイクルレジストリ(`this.nodes`)ではなく Docker の
    `com.chainviz.managed` ラベルから行う**。理由: (1) Issue #65 で「ラベルを
    単一の真実の情報源とする」方針が確定済みで、レジストリ自体もラベルから
    再構築される(両者は一致する)、(2) A 層ポーリング(`EthereumAdapter.
    pollInfra`)は `ContainerObservation.labels` を既に持っており、
    `EthereumNodeLifecycle` への新たな結合を作らずに済む。なお addNode の
    ロールバック失敗で生じるゴーストコンテナ(ラベルあり・レジストリ未登録)
    では removable=true だが removeNode が拒否する不整合が理論上残るが、
    これは既存のエラー経路であり本 Issue では扱わない
  - フロントの表示方針は「`removable === true` のときだけ削除ボタンを
    描画(それ以外は非表示)」とする。グレーアウト+理由表示も検討したが、
    (1) compose 起動ノードに削除操作はそもそも提供されない機能であり無効
    ボタンを見せる意味が薄い、(2) ja/en の理由文言追加と UI 調整で不具合
    修正の範囲を超える、ため非表示を採用。将来説明が必要になれば
    `InfraPopover` に理由を出す拡張で対応できる
  - collector 実装時の指定: `packages/collector/src/adapters/ethereum/` に
    `labels.ts` を新設してラベル定数(`com.chainviz.managed` 等)を一元化し、
    `node-lifecycle.ts` / `classify.ts` / `index.ts` の重複定義を寄せること。
    `EthereumAdapter.toEntity`(index.ts)の `infra` 組み立てで
    `removable: obs.labels[MANAGED_LABEL] === "true"` を設定する
  - frontend 実装時の指定: `InfraNodeCard.tsx` の削除ボタンを
    `entity.removable === true` のときだけ描画。既存テスト
    (`InfraNodeCard.test.tsx`)のフィクスチャは removable 未設定のため、
    ボタン存在を前提とするテストが落ちる。フィクスチャに `removable: true`
    を足し、false/未設定でボタンが出ないテストを追加すること
