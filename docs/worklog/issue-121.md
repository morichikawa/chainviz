# Issue #121 pnpm dev:upがdist/の古いビルドを検知せず気づかないまま起動してしまう

### 2026-07-06 Issue #121 バックログ登録のレビュー

- 担当: reviewer
- ブランチ: docs-plan-add-121-backlog
- 内容: Issue #121 の起票と `docs/PLAN.md` バックログへの追加（コミット
  5b40949、docs のみの変更）をレビューし、合格とした
- 確認したこと:
  - `gh issue view 121` で Issue が OPEN であり、タイトル
    「pnpm dev:upがdist/の古いビルドを検知せず気づかないまま起動してしまう」
    が PLAN.md のバックログ記載（未チェック項目）と一致すること
  - Issue 本文の技術的主張をコードで検証した。`scripts/dev-up.sh` の
    61行目は `[ ! -f "$ROOT_DIR/packages/collector/dist/index.js" ]` で
    ファイルの存在だけを見てビルド要否を判断しており、存在すれば古い
    dist のまま起動する。「存在チェックのみでビルドの鮮度を検知しない」
    という記載は正確
  - 実例として挙がっている `dist/adapters/ethereum/el-peers.js` の欠落も
    整合する。`el-peers.ts` は Issue #106 で collector に追加された
    ソースで、#106 マージ以前のビルド成果物には含まれない
  - `pnpm lint` が通ること（終了コード 0）
  - コミット粒度: docs のみの1コミットで問題なし
- 指摘（非ブロッキング）: Issue #121 のラベルが `frontend` になっているが、
  対象は `scripts/dev-up.sh`（リポジトリ直下のスクリプト）と collector の
  dist であり、frontend パッケージとは無関係。`collector` への付け替え、
  またはパッケージ外である旨の整理を推奨する（PLAN.md の記載自体には
  影響しないため合格判定は変えない）
- 決定事項・注意点: 実装時は「今観測できる値」への依存を避ける観点から、
  mtime 比較よりも Issue 本文の案にある「ビルド時に git commit hash を
  マーカーファイルへ書き込み、起動時に HEAD と比較する」方式のほうが
  worktree 間コピーや clock skew の影響を受けにくい
