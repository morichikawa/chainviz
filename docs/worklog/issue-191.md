# Issue #191 作業記録

### 2026-07-08 Issue #191 D層のプロトコル層E2Eテストを追加する

- 担当: collector
- ブランチ: issue-191-d-layer-e2e

#### 内容

Phase5（D層: ノード内部可視化）の実装Issue（#184〜#190）がマージ済みの
状態で、プロトコル層E2E（`packages/e2e/`）にD層の検証を追加した。
`packages/e2e/SCENARIOS.md` §3 の `PROTO-D-01`（「NodeEntity.internals /
drivesNodeId が反映され nodeLinkActivity が受信できる」）に対応する。

- `packages/e2e/src/d-layer.test.ts` を新規作成し、既存の
  `a-b-layer.test.ts` と同じパターン（`setupHarness`/`teardownHarness`、
  `harness.client.waitForState` によるポーリング待ち）で以下を検証した。
  1. beacon1 の `NodeEntity.drivesNodeId` が対の reth1 の id を指すこと
  2. reth1 の `NodeEntity.internals`（`syncStages` の各要素の型・値、
     `mempool.pending`/`queued`）が反映されること
  3. `nodeLinkActivity` イベント（`fromNodeId`=beacon1、`toNodeId`=reth1、
     `calls` が1件以上）が実際に配信されること
- `packages/e2e/src/helpers/ws-client.ts`（`CollectorTestClient`）に
  `nodeLinkActivity` の受信履歴を蓄積する機能を追加した。
  `nodeLinkActivity` は `operationObserved` と同じく揮発性でワールド
  ステート（entities/edges）には畳み込まれない設計（ARCHITECTURE.md
  §7.3）のため、既存の `applyDiff`（entities/edges の畳み込み）とは別に
  蓄積する経路が必要だった。純粋な抽出ロジックは
  `extractNodeLinkActivities(events: DiffEvent[]): NodeLinkActivity[]`
  という exported 関数に切り出し、`packages/frontend/src/world-state/
  store.ts` の同名関数と同じ抽出方針にした。`CollectorTestClient` は
  この関数を使って `diff` メッセージ受信のたびに `linkActivities` 配列へ
  追記し、`getLinkActivities()` で取得できるようにした。
- `extractNodeLinkActivities` のユニットテストを
  `packages/e2e/src/helpers/ws-client.unit.test.ts` に新規追加した
  （docker非依存。`pnpm test`＝`vitest.unit.config.ts` で回る）。

#### 決定事項・注意点

- beacon→reth のペアリング（beacon1↔reth1、beacon2↔reth2）は
  `profiles/ethereum/docker-compose.yml` の `EXECUTION_ENDPOINT` 固定設定に
  由来する。プロファイル側でペアリングを変更した場合はテスト内の
  `DRIVING_BEACON`/`DRIVEN_RETH` 定数も見直す必要がある（コード内コメント
  にその旨を明記済み）。
- 待ち時間の固定値について: D層メトリクスのポーリング間隔は
  `NODE_INTERNALS_POLL_INTERVAL_MS`（既定3000ms、
  `packages/collector/src/adapters/ethereum/reth-metrics-tracker.ts`）、
  スロット時間は `SLOT_DURATION_MS`（既定2000ms、
  `profiles/ethereum/values.env`）。1ポーリング間隔内に必ず1回以上の
  Engine API呼び出しが増分として乗る計算になるため、タイムアウトは
  他のA/D層の初回反映待ちテスト（`waitForInfra`等）と同程度の桁数
  （60秒）に設定した。これらの前提が変わる場合（スロット時間を大きく
  伸ばす等）はタイムアウト値も見直すこと（コード内コメントに前提条件を
  明記済み）。
- 既存のA〜C層プロトコル層テストとの重複は無い。UI層のD層シナリオ
  （UI-D-*、`docs/PLAN.md`ステップ10・Issue #203で別途実装予定）とは
  異なり、こちらはワールドステートのフィールドの生の値（`internals`の
  中身・`nodeLinkActivity`のcalls配列の中身）を直接検証する、UIからは
  到達できない観点（ARCHITECTURE.md §8.1）。

#### 確認したこと

- `pnpm --filter @chainviz/shared build`、`pnpm --filter @chainviz/e2e
  build`（`tsc --noEmit`）が成功すること。
- `pnpm --filter @chainviz/e2e test`（docker非依存ユニットテスト、
  `ws-client.unit.test.ts`含む4ファイル38テスト）が成功すること。
- 実Docker環境（このworktree専用に起動したスタック）に対し
  `pnpm --filter @chainviz/e2e test:e2e` を実行し、新規追加の
  `d-layer.test.ts`（3テスト）を含む全24テストが成功することを確認した
  （所要約3分。稼働中の別スタックには触れず、`helpers/e2e-lock.ts` の
  排他ロック機構で独立に起動・後片付けされる）。
- `pnpm build`（リポジトリ全体）も成功することを確認した。

### 2026-07-08 レビュー（chainviz-reviewer）

- 担当: reviewer
- 判定: **合格**

#### 確認したこと

- **SCENARIOS.md との整合**: §1 の棚卸し表で「D層 internals /
  nodeLinkActivity の受信」は「残す（スキーマレベル）= PROTO-D-01」と
  設計されており、本Issueはそれに対応する。UI-D-01〜03（ステップ10・
  Issue #203、Playwright）とは観点が別（UIの見た目 vs フィールドの生の値）
  で、ARCHITECTURE.md §8.1 の「プロトコル層に残す検証」リストにも
  「D層 E2E（Issue #191）」が明記済み。両方実装する設計が正しく反映
  されている。§3 の一覧で PROTO-D-01 が `d-layer.test.ts` / 「済」に
  更新されていることも確認した
- **既存パターンとの一貫性**: `d-layer.test.ts` は `a-b-layer.test.ts` と
  同じ構成（`setupHarness`/`teardownHarness`、`PROJECT`/`id` ヘルパー、
  `waitForState` によるポーリング待ち、beforeAll 300秒）で書かれている
- **タイムアウトの妥当性**: 60秒の前提条件（poll 3000ms =
  `NODE_INTERNALS_POLL_INTERVAL_MS`、slot 2000ms = `SLOT_DURATION_MS`）が
  コード内コメントと本 worklog の両方に明記されており、参照先の実値とも
  一致する（CLAUDE.md の固定値ルールに適合）。値自体も既存テストの
  待ち時間（30〜90秒）と同じ桁で、チェーンの稼働時間に依存しない
  「初回反映待ち」なので稼働が延びても壊れない
- **extractNodeLinkActivities の設計**: nodeLinkActivity は store 反映
  なしの passthrough 配信（ARCHITECTURE.md §7.3）のため、テスト
  クライアント側で受信履歴を蓄積する設計は妥当。実装は
  `packages/frontend/src/world-state/store.ts` の同名関数とロジックが
  一致しており、frontend パッケージに依存せず複製する方針は ws-client.ts
  の既存方針（畳み込みロジックの独立実装）とも一貫している
- **テストの質**: `ws-client.unit.test.ts` の10件は空配列・他イベントの
  無視・順序保持・混在・不正イベント耐性・参照同一性・入力非破壊を
  カバーし、壊れた実装（フィルタ漏れ・順序崩れ・複製）を検出できる
- **エラー握りつぶし・境界**: catch して無視する箇所なし。e2e クライアント
  はチェーン固有語彙を含まず shared の型のみに依存（テスト本体が
  beacon/reth を参照するのはプロファイル固有 E2E として既存テストと同様）
- **品質ゲート**: `pnpm lint` / `pnpm build` / `pnpm test`（shared 58・
  e2e 44（新規10含む）・collector 1084・frontend 1350）すべて成功
- **E2E 実測**: この worktree 自身のスタック（他の稼働環境には非接触）で
  `pnpm --filter @chainviz/e2e test:e2e` を2回実行。新規 `d-layer.test.ts`
  3件は2回とも合格。1回目に既存の `commands.test.ts`（PROTO-CMD-01、
  addNode 後のブロック追従）が「高さ 0 のまま 46 秒停止」で1件失敗したが、
  2回目は全24件合格。失敗箇所は本ブランチの差分（e2e ヘルパーの受信履歴
  蓄積・読み取り専用の新規テスト・docs のみ）と無関係な既存テストであり、
  一時的な EL 間バックフィル開始遅延によるフレークと判断した

#### 申し送り（本Issueのブロッカーではない）

- PROTO-CMD-01 は稀に「追加 reth の高さが 0 のまま停止検出（45秒級）に
  かかる」フレークが起き得る。バックフィル開始までの遅延が停止検出の
  しきい値を超えるケースと思われる。再発するようなら別Issueとして
  停止検出しきい値（`stallTimeoutMs`）の見直しを検討すること
- `packages/e2e/src/helpers/ws-client.ts` は edgeKey の区切り文字に
  NUL 文字（\x00）を使っている（main 由来・本Issueの変更ではない）ため、
  git が diff をバイナリ扱いする。レビュー時は `git diff --text` が必要

### 2026-07-08 QA検証（chainviz-qa）

- 担当: qa
- 判定: **合格**

#### 検証方法と結果

- 静的ゲート: `pnpm lint`（eslint、エラーなし）、`pnpm build`
  （shared/collector/e2e/frontend すべて成功）、`pnpm test`（ユニット
  テストのみ。shared 58・e2e 44〈新規 `ws-client.unit.test.ts` 10件含む〉・
  collector 1084・frontend 1350、全て成功）を独立に実行し全て通ることを
  確認した。
- 実環境E2E: 稼働中の Ethereum スタック（`chainviz-ethereum`、
  ブロック進行中）に対し `pnpm --filter @chainviz/e2e test:e2e d-layer` を
  実行し、`d-layer.test.ts` の3件が全て合格することを確認した（所要約20秒）。
  - beacon1 の `drivesNodeId` が対の reth1 を指す → 合格
  - reth1 の `internals`（`syncStages` の各要素の型・値、`mempool` の
    pending/queued）が反映される → 合格
  - beacon1 → reth1 の `nodeLinkActivity`（Engine API 呼び出し活動）が
    実際に配信される → 合格
  - このテストはコマンドを送らず状態を読むだけの非破壊テストであり、
    実行前後で `chainviz-ethereum` プロジェクトのコンテナ数（8個）に
    変化がないことを確認した。
- 完了条件の照合:
  - `d-layer.test.ts` が実 Docker + 実 collector に対して実行でき、3観点を
    検証する → 満たす
  - `SCENARIOS.md` の PROTO-D-01 が「済」→ §3 の一覧で `d-layer.test.ts` /
    「済」になっていることを確認
  - ステップ9（Phase5）の全項目完了 → `docs/PLAN.md` ステップ9の全
    チェックボックス（#183〜#191）が `[x]` であることを確認

#### 申し送り

- 今回のE2Eは、フル `test:e2e`（addNode/removeNode 等でスタックを変更する
  commands/error-paths を含む）ではなく、#191 の対象である `d-layer.test.ts`
  のみを対象に実行した。稼働中の共有スタックを非破壊で検証するため。
  フル24件のグリーンは chainviz-reviewer が独立に2回実行して確認済み
  （2回目で全24件合格。既存 PROTO-CMD-01 の1回フレークは本ブランチの
  差分と無関係）。
- E2Eハーネス（`helpers/docker.ts`）は独立プロジェクト名で新規起動する
  のではなく、進行中であれば既存の `chainviz-ethereum` スタックを再利用
  する設計である（`ensureChainRunning` は freshStart 未指定時 down -v
  しない）。collector は専用ポート 4123 の子プロセスとして分離される。
  「独立プロジェクト名で起動する」わけではない点に留意（#191 の検証結果
  には影響しない）。
