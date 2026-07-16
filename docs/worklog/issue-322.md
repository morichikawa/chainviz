### 2026-07-16 Issue #322 slot time を 12 秒に戻す変更に伴う E2E テスト・collector コメントの追従（TypeScript 側）

- 担当: tester
- ブランチ: issue-322-slot-time-and-indicator-e2e
- 位置づけ: Issue #322 のうち node-env 側（`profiles/ethereum/values.env` の
  slot time を 2 秒 → 12 秒へ戻す・genesis 再生成）は別ブランチ
  `issue-322-slot-time-and-indicator` で並行実装。本ブランチは TypeScript 側
  （`packages/e2e` の待ち時間・タイムアウトの追従、`packages/collector` の
  コメント更新）に専念する。後で統括が cherry-pick で合流させる。

#### 設計メモ（着手前の判断）

- slot time を 2 秒前提で決め打ちしている待ち時間・タイムアウトが
  `packages/e2e` に複数あり、`SLOT_DURATION_SECONDS = 2` の重複定義も 2 箇所
  （`p2p-graph.spec.ts` / `chain-ribbon.spec.ts`）にあった。CLAUDE.md の
  「今この瞬間に観測できる状態に依存した固定値をロジックに埋め込まない」
  原則に沿って、slot time の出所を `profiles/ethereum/values.env` の
  `SLOT_DURATION_IN_SECONDS` に一元化し、各テストはそこから導出した
  `SLOT_DURATION_MS` を基に自分のタイムアウトを計算する構成にする。
- 値の性質で 2 系統に分ける:
  - slot 由来（tx のブロック取り込み・ブロック生成イベント）: slot 時間に
    比例させる。
  - ポーリング由来（A/C 層の 3 秒ポーリングで解決するカード出現など）: slot
    時間に依存しないので据え置く。

#### 実施内容（packages/e2e）

- `helpers/slot-time.ts`（新規）: `values.env` を読み `SLOT_DURATION_IN_SECONDS`
  をパースして `SLOT_DURATION_SECONDS` / `SLOT_DURATION_MS` を export する
  単一の出所。パース純関数 `parseSlotDurationSeconds` は
  `adapters/ethereum/mnemonic.ts` の流儀に合わせ、クォート有無いずれの記法にも
  対応。読めない・値が無い・0 以下のときは import 時に throw する（誤った
  既定値へ静かにフォールバックすると全タイムアウトが実チェーンとずれて flaky
  になるため、値が確定できないときは明示的に失敗させる）。
- `helpers/slot-time.unit.test.ts`（新規）: パース純関数の境界値・異常系
  （クォート有無、複数行・他キー混在、インデント、キー欠落、空文字列、
  非数値、0・負値、`SLOT_DURATION_MS` のような接頭辞一致の別キーに反応しない
  こと、小数）を 13 ケースで検証。
- `helpers/paths.ts`: `valuesEnvFile` を追加。
- `helpers/docker.ts`: チェーン進行観測窓の固定 `sleep(6_000)` を
  `SLOT_DURATION_MS * 2`（`PROGRESS_OBSERVATION_MS`）に変更。ブロックは slot
  ごとに 1 つなので、観測窓が 1 slot 以下だと slot 境界をまたがず「増えて
  いない」と誤判定しうる（固定 6 秒だと 12 秒 slot で約半分の確率で誤判定）。
  位相ずれ・遅延 slot への余裕を見て 2 slot 分待つ。
- `ui/p2p-graph.spec.ts` / `ui/chain-ribbon.spec.ts`: 重複していた
  `SLOT_DURATION_SECONDS = 2` を削除し `SLOT_DURATION_MS` を import。ブロック
  伝播パルス・チェーンリボンタイルの待ち上限を「次スロットまでの slot 比例分
  ＋コールドスタート等の固定オーバーヘッド」= `SLOT_DURATION_MS * 3 + 20_000`
  に変更（slot=2 秒で約 26 秒、12 秒で約 56 秒）。従来の「slot 秒 × 15 倍」は
  12 秒 slot で 180 秒となり Playwright のテスト単位タイムアウトを超えるため
  採らない。chain-ribbon の「表示窓（直近 8 タイル ≒ 16 秒）」コメントも
  slot time 依存である旨に更新。
- `ui/node-internals.spec.ts`: 15 秒固定だった 2 回目以降のパルス出現待ち
  `SECOND_PULSE_TIMEOUT_MS`（旧 `NODE_INTERNALS_POLL_INTERVAL_MS * 5`）を
  `SLOT_DURATION_MS + NODE_INTERNALS_POLL_INTERVAL_MS * 3` に変更。slot 時間が
  スクレイプ間隔（3 秒）より長くなると、Engine API 呼び出しの増分（=パルス）は
  毎スクレイプではなく slot ごと（最大 1 slot 間隔）にしか出ない。次パルスまでの
  worst case は「1 slot(12s) + スクレイプ位相ずれ(3s) = 15s」で、旧固定値 15 秒
  だと余裕ゼロで flaky。新値は 12 秒 slot で 21 秒となり 6 秒の余裕を確保。
  UI-D-02 の `test.setTimeout` はこの定数から算出されるため自動追従する。
- `ui/support/operations.ts`: `OPERATION_EFFECT_TIMEOUT_MS` を
  `Math.max(30_000, SLOT_DURATION_MS * 2 + 20_000)` に変更（`cast`/`forge` は
  receipt を待つため tx 取り込み = slot 依存。最大 2 slot 分を比例させ、WS 配信
  等の固定オーバーヘッドを加算。ポーリング由来の 30 秒実績値を下限に据えて
  slot を短くしても割り込まないようにする。slot=2 秒で 30 秒、12 秒で 44 秒）。
- `playwright.config.ts`: テスト単位の既定タイムアウトを
  `Math.max(60_000, SLOT_DURATION_MS * 6 + 30_000)` に変更（操作系テストは tx
  取り込み待ちが支配的で slot 依存。slot=2 秒で 60 秒、12 秒で約 102 秒）。
  多段操作のテストは従来どおり各 `test.setTimeout` で更に緩める。
- `d-layer.test.ts`: コメントの前提（「1 ポーリング間隔に必ず 1 回以上の
  Engine 呼び出しが乗る」）を更新。12 秒 slot ではスクレイプ間隔より slot が
  長いため、増分は数回に 1 回のスクレイプでまとまって観測される。ここで待つ
  のは「初回反映」であり、待ち上限 60 秒の中で複数 slot 分が経過するため十分
  間に合う（値自体は変更なし）。

#### 実施内容（packages/collector、コメントのみ・ロジック変更なし）

- `adapters/ethereum/reth-metrics-tracker.ts`: `NODE_INTERNALS_POLL_INTERVAL_MS`
  の前提コメントを更新。slot time（12 秒）がスクレイプ間隔（3 秒）より長いため
  1 スクレイプ間隔に必ずしも Engine 呼び出しが乗らず、数回に 1 回のスクレイプで
  slot 分の増分をまとめて観測する（差分ベースなので増分ゼロのスクレイプが
  混じっても正しく動く）。逆に slot を大幅に短くする場合は取りこぼし防止に
  見直しが必要、という向きに書き換え。
- `adapters/ethereum/sync-status.ts`: `SYNCED_TOLERANCE_BLOCKS` の前提コメントを
  更新。slot time が長いほど単位時間あたりのブロック生成が減り、並行スクレイプ
  のタイミングずれで生じるブロック差はむしろ小さくなるため、5 ブロックの許容量
  はより安全側に働く。逆に slot を大幅に短くする場合は見直しが必要、という
  向きに書き換え。

#### 検証

- `pnpm --filter @chainviz/e2e build`（tsc --noEmit）通過。
- `pnpm --filter @chainviz/collector build` 通過。
- `pnpm --filter @chainviz/e2e test`（vitest ユニット）171 件通過（新規
  `slot-time.unit.test.ts` の 13 件含む）。
- `pnpm --filter @chainviz/collector test` 1458 件通過。
- 実 Docker が必要な UI 層 E2E（`playwright test`）はこの場では実行せず、
  導出タイムアウトの値と worst case の関係を数値で確認した。特に
  `SECOND_PULSE_TIMEOUT_MS` は 12 秒 slot で 21000ms > worst case 15000ms
  （旧固定値 15000ms は worst case と同値で余裕ゼロ = 元の flaky の原因）で、
  6 秒の余裕を確保できることを確認。

#### 注意点・申し送り

- 本ブランチの `values.env` はまだ slot time = 2 秒のまま（node-env 側の変更は
  別ブランチ）。そのため本ブランチ単体でビルド/ユニットテストを走らせると
  `SLOT_DURATION_MS` は 2000 になる。ロジックは値の出所を values.env に一元化
  しているため、統括が node-env 側（12 秒）を cherry-pick で合流させた時点で
  自動的に 12 秒基準のタイムアウトに切り替わる。
- catch-up 系（`commands.test.ts` の `MIN_PROGRESS_BLOCKS` / `catch-up.ts` の
  動的タイムアウト）は追加ノードの履歴バックフィル速度（slot 非依存、実測
  9〜10 ブロック/秒）に基づくため、slot time を変えても影響しないと判断し
  変更していない。12 秒 slot ではチェーンの head 成長が遅くなるが、
  `resolveCatchUpTarget` が head 未達分を head 到達にフォールバックするため
  既存ロジックのまま成立する。
