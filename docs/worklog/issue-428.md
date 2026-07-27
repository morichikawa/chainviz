# Issue #428 ブロック詳細パネルでブロック番号を直接指定して遡れるようにしたい

### 2026-07-26 Issue #428 実装方針の設計（designer）

- 担当: designer
- ブランチ: issue-428-block-detail-number-jump
- 前提: Issue #409（ブロック詳細パネル。ARCHITECTURE.md §18）の既存スコープ
  判断（保持窓 `BLOCK_RETENTION` 内を辿るに限定し、保持窓外への新規 RPC
  遡及取得・全チェーン検索 UI は対象外）を踏襲する、というユーザーからの
  明示的な前提のもとで設計した。今回の要望はこのスコープを変更するもの
  ではなく、保持窓内での移動手段に「番号直接指定」を追加するだけ。

## 既存実装の把握

- `packages/frontend/src/side-panel/BlockDetailView.tsx`: サイドパネル
  `kind: "blockDetail"` の中身。前後ナビゲーションボタン
  （`block-detail-view__nav`）はパネル最下部にあり、`navigation`
  （`resolveBlockNavigation` の出力）と `onNavigate` prop を受け取るだけの
  純表示コンポーネント。
- `packages/frontend/src/entities/blockDetail.ts`: 対象ブロック・前後
  ナビゲーション・tx 一覧を `BlockEntity[]` から導出する純粋関数群。
  `findChildBlock` は同一番号に複数ブロック（フォーク）が観測された場合の
  tie-break（最新受信時刻が遅い方、同時刻なら hash 辞書順）を持つ。この
  tie-break は `chainRibbon.ts` の `pickCanonicalPerNumber` と意図的に
  重複実装されている（コメントに明記あり）。
- `packages/frontend/src/side-panel/SidePanelHost.tsx`: `blocksByHash`
  （`BlockEntity` の hash 索引。Canvas.tsx がチェーンリボンノードの
  `data.blocks` から算出）・`latestBlockHash`・`transactions` を
  `BlockDetailView` へ渡す前段。ダングリングガード（対象ブロックが保持窓
  から外れたらパネルを自動的に閉じる）もここが持つ。
- `packages/shared/src/world-state/entities.ts` の `BlockEntity.number` は
  素の `number` 型。チェーン固有の語彙は含まれておらず、番号での検索に
  型変更は不要と確認した。

## 決定した設計方針

詳細は `docs/ARCHITECTURE.md` §18.3.1 に記載した。要点:

- **スコープ**: 保持窓（`blocksByHash`）内の番号検索のみ。範囲外は
  新規 RPC 取得をせず「見つからない」エラーとして扱う。
- **`packages/shared`・collector の変更なし**: §18.2 と同じく、既にフロント
  へ届いている `BlockEntity` 群の中で完結する。番号での検索・フォーク時の
  tie-break・エラー時の範囲提示は全てフロント側の純粋関数で処理できる。
- **UI配置**: 前後ナビゲーションのボタン列のすぐ上に置く（別の場所や
  ヘッダーには置かない）。理由は2つ: (1) 番号ジャンプは前後移動と同じ
  「保持窓内を移動する」関心事であり、`SidePanel`（汎用シェル）のヘッダーに
  `blockDetail` 固有の要素を割り込ませたくない、(2) 「前のブロック」が
  保持期間外で disabled になった場面のすぐ近くにジャンプ欄があることで、
  「保持窓内の別の番号になら移動できる」という代替手段への気づきになる。
- **入力欄**: `type="text"` + `inputMode="numeric"`
  （`operations/TransferForm.tsx` の金額欄と同じ流儀。`type="number"` は
  ブラウザ間でバリデーション UI の挙動が揃わないため避けた）。`<form
  onSubmit>` で Enter 送信とボタンクリックを1つのハンドラに揃える。
- **バリデーション**: 入力を trim して `^\d+$` にマッチするかで判定し、
  `Number.isSafeInteger` を超えるものも無効とする。無効な入力と
  「保持窓内に見つからない」は別のエラーメッセージに出し分ける。見つから
  ない場合は `blocksByHash` の `number` の最小値・最大値を使い、具体的な
  範囲（例:「現在保持しているのは #100〜#131 です」）を提示する。パネルは
  対象ブロックが存在する場合にのみ描画されるため、この範囲は常に求まる。
- **フォーク時の解決**: 同一番号に複数ブロックが観測された場合は、
  `findChildBlock` と同じ tie-break を新規関数 `findBlockByNumber` に
  持たせる（意図的な重複。既存パターンを踏襲）。
- **新規関数（`entities/blockDetail.ts` に実装担当が追加）**:
  `parseBlockNumberInput` / `findBlockByNumber` / `blockNumberRange` /
  それらを束ねる `resolveBlockJump`。設計時点ではシグネチャのみ提示し、
  実装ロジック自体は書いていない（designer の役割範囲を超えるため）。
- **コンポーネント分割**: `BlockDetailView.tsx`（既に約240行）へ直接書き
  足さず、新規ファイル `side-panel/BlockJumpForm.tsx` に分離する。
  `BlockDetailView.tsx` に `blocksByHash` を新しい prop として追加し
  （`SidePanelHost.tsx` からは既にこの索引が渡ってきている）、
  `BlockJumpForm` へそのまま渡す。
- **入力欄の値の同期**: 表示中のブロックが変わるたび（前後ボタン・ジャンプ
  いずれでも）入力欄の値を表示中のブロック番号に同期する
  （`GlossaryPanelView.tsx` が `termKey` prop の変化に応じて展開し直す
  既存パターンと同種の `useEffect`）。
- **i18n（初稿。ja/en）**: `blockDetail.jump.label` / `.submit` /
  `.invalid` / `.notFound`（`{min}`/`{max}` 埋め込み）。具体文言は
  ARCHITECTURE.md §18.3.1 参照。
- **E2E**: `packages/e2e/SCENARIOS.md` の UI-B-07（Issue #409）に隣接する
  シナリオとして、(1) 保持窓内の番号でジャンプできる、(2) 保持窓外・
  存在しない番号でエラー表示、(3) 数値以外の入力で送信ボタンが disabled、
  の3点を実装担当が追記・実装する。

## UX面の判断（chainviz-ux への引き継ぎ要否）

入力欄の見せ方・エラーフィードバックについて検討したが、以下の理由で
chainviz-ux への正式な引き継ぎは不要と判断した:

- 「番号を入力してジャンプする」「見つからなければ範囲を示してエラーに
  する」は PDF ビューアのページ番号欄・動画プレイヤーのシーク欄などで
  広く確立された標準的な操作パターンであり、新規に情報設計を要する UX
  課題ではない。
- 配置・バリデーションの流儀は、既存の `TransferForm.tsx`（送金フォーム）・
  `GlossaryPanelView.tsx`（prop 変化での再同期）という、この codebase に
  既に確立されたパターンをそのまま踏襲できる。
- 実装後に QA・実機確認で「わかりにくい」と判明した場合は、Issue #409
  のダングリングガード同様、その時点で改めて検討すればよい（先回りして
  UX 設計フェーズを挟まない）。

## 未確定のまま実装時の判断に委ねた点

- 入力欄の初期値をブロック番号の桁数に応じて幅を可変にするか等、細かい
  見た目の調整は実装時の判断とする。
- `blockNumberRange` を `blockDetail.ts` に置くか `BlockJumpForm.tsx` の
  ローカル計算に留めるかは、実装時にテスト容易性を見て判断してよい
  （設計としては前者を推奨したが、パネル内でしか使わないなら後者でも
  1ファイル1責務は崩れない）。

### 2026-07-26 Issue #428 実装（frontend）

- 担当: frontend
- ブランチ: issue-428-block-detail-number-jump
- 設計メモ（実装前の方針）: 上記の設計内容にほぼ沿って実装した。実装
  着手前に立てた判断は以下:
  - `blockNumberRange` は設計の推奨どおり `entities/blockDetail.ts` に置いた
    （`resolveBlockJump` から使う共通ロジックであり、単体でもテストしやすい
    ため）。
  - `resolveBlockJump` の `notFound` ケースで `blocksByHash` が空
    （`blockNumberRange` が undefined を返す）場合は、設計メモの想定
    （パネルは対象ブロックが存在する場合にのみ描画されるため通常発生
    しない）どおり呼び出し側では起こらないが、純粋関数として例外を
    投げず落ち着いた値を返すため、入力番号自身を範囲として代用する
    フォールバックを入れた（コード内コメントに理由を明記）。
  - `BlockJumpForm` のエラー表示は `TransferForm.tsx` の「入力のたびに
    導出し、非空かつ無効なときだけエラー文を出す」流儀に厳密に合わせ、
    送信ボタンクリック時にだけ結果を確定させるような追加の state は
    持たせなかった（`resolveBlockJump` を毎レンダー呼ぶだけの単純な
    実装にした）。

#### 実施内容

- `entities/blockDetail.ts`: `parseBlockNumberInput` / `findBlockByNumber`
  （`findChildBlock` と同じフォーク tie-break を意図的に重複実装）/
  `blockNumberRange` / `resolveBlockJump` を追加。
- 新規ファイル `side-panel/BlockJumpForm.tsx`: ジャンプ欄の表示・入力保持・
  結果に応じたエラー表示を持つコンポーネント。`block.hash` の変化を
  トリガーに入力欄の値を表示中のブロック番号へ同期する `useEffect`
  （`GlossaryPanelView.tsx` の `termKey` 同期と同じパターン）。
- `side-panel/BlockDetailView.tsx`: `blocksByHash` prop を追加し、前後
  ナビゲーションのボタン列（`block-detail-view__nav`）のすぐ上に
  `BlockJumpForm` を配置。
- `side-panel/SidePanelHost.tsx`: 既に保持している `blocksByHash` を
  `BlockDetailView` へそのまま渡すよう1行追加（新しい prop の受け渡しの
  みで、`SidePanelHostProps` 自体の変更は不要だった）。
- `i18n/messages.ts`: `blockDetail.jump.label` / `.submit` / `.invalid` /
  `.notFound`（`{min}`/`{max}` 埋め込み）を ja/en で追加。
- `styles.css`: `.block-jump-form` 系のスタイルを `block-detail-view__nav`
  の直前に追加（既存の `.operation-form__error` を流用し、独自のエラー
  色定義は増やしていない）。
- `packages/e2e/SCENARIOS.md`: UI-B-07 の直後に UI-B-07a として3ケース
  （保持窓内ジャンプ成功／範囲外エラー／数値以外でボタン disabled）を
  追記。
- `packages/e2e/src/ui/block-detail-jump.spec.ts`（新規ファイル）: 上記
  3ケースを Playwright で実装。既存の `block-detail.spec.ts`
  （UI-B-07）とは 1 ファイル 1 責務のため分離した。範囲外エラーの
  テストは、絶対的なブロック番号を決め打ちにせず「現在表示中の番号 +
  1,000,000」という相対オフセットで保持窓の外を作っている
  （CLAUDE.md の固定値ルール対応）。**実機（docker compose 環境）での
  実行は行っていない**（frontend 担当は Docker に直接触れない制約のため。
  QA 担当が実機確認時に必ず実行し、`test:e2e:ui` の合否を確認すること）。

#### テスト

- `entities/blockDetail.jump.test.ts`（新規）: `parseBlockNumberInput` /
  `findBlockByNumber` / `blockNumberRange` / `resolveBlockJump` の単体テスト
  （境界値: `Number.MAX_SAFE_INTEGER` ちょうど・空 Map・フォーク tie-break
  の相互一致性など）。既存の `entities/blockDetail.test.ts` はブロック詳細
  パネルの前後ナビゲーション・tx 一覧側の関心事のみを保つため、新規関数は
  ここに含めず分離した。
- `side-panel/BlockJumpForm.test.tsx`（新規）: 入力欄の初期値・表示中
  ブロックが変わったときの再同期・送信ボタンの活性制御・Enter 送信・
  エラー文の出し分けをテスト。
- `side-panel/BlockDetailView.test.tsx`: 新しい `blocksByHash` prop の
  既定値をテストヘルパーに追加（対象ブロック自身のみを含む最小索引。
  ジャンプ欄自体の詳細は `BlockJumpForm.test.tsx` に委ねる）。
- `side-panel/SidePanelHost.blockDetail.test.tsx`: ジャンプ欄経由の
  ナビゲーションが実際に `SidePanelHost` のパネル差し替えまで到達する
  ことを確認する統合テストを1件追加。

#### 確認

- `pnpm build`（ルート、全パッケージ）: 成功。
- `pnpm lint`（ルート）: エラーなし。
- `pnpm --filter @chainviz/frontend test`: 314ファイル / 3968テスト全て
  成功（新規追加分を含む）。
- `pnpm --filter @chainviz/e2e typecheck`: 成功（`@chainviz/shared` を
  先にビルドする必要があった。既存の他 e2e ファイルの型エラーは今回の
  変更と無関係な既知の状態で、`@chainviz/shared` のビルド成果物が無い
  ローカル環境で `tsc --noEmit` を単独実行すると再現するだけであり、
  `pnpm build`（ルート、依存順ビルド）を経由すれば発生しない）。

#### 次の担当への申し送り

- `findBlockByNumber` は `findChildBlock` とフォーク tie-break ロジックを
  意図的に重複実装している（既存のコードコメントの方針を踏襲）。今後
  tie-break の規則を変える場合は `findChildBlock` / `findBlockByNumber` /
  `chainRibbon.ts` の `pickCanonicalPerNumber` の3箇所を同時に見直す必要が
  ある。
- `block-detail-jump.spec.ts` は実機での実行を行っていないため、QA が
  docker compose 環境で `pnpm --filter @chainviz/e2e test:e2e:ui`
  （または対応するコマンド）を実際に走らせ、UI-B-07a の3ケースが green に
  なることを確認してほしい。特に「保持窓内ジャンプ成功」のケースは
  チェーン進行を1ブロック分待つ実時間依存のステップを含む。

### 2026-07-26 Issue #428 テスト強化（tester）

- 担当: tester
- ブランチ: issue-428-block-detail-number-jump
- 方針: 実装担当が書いた基本テスト（ハッピーパス + 主要な境界値）を土台に、
  異常系・境界値・ライブ更新中の遷移を追加した。実装ロジックの変更は
  行っていない（後述の e2e の修正はテストコード側の誤りの修正）。

#### 追加・強化したテストの観点

- `entities/blockDetail.jump.test.ts`（既存ファイルへ追加）
  - `parseBlockNumberInput` の異常系・境界値: `Number.MAX_SAFE_INTEGER + 1`
    ちょうど / 丸められて安全でない整数になる値（`9007199254740993`）/
    `Number()` が Infinity になる長大な桁数 / 先頭ゼロ（`007`・`0000`・
    ゼロ30個 + `42`）/ タブ・改行の trim と桁の途中の改行 / ノーブレース
    ペース（リッチテキストからの貼り付け）/ 全角数字・アラビア数字 /
    16進表記・桁区切り（`1_000`・`1,000`）/ `Infinity` / UI 表記の `#42`
  - `blockNumberRange`: ブロック番号 0 を最小値として扱えること
    （falsy 判定で書くと 0 が捨てられるため、その退行を検出する）/
    挿入順非依存 / 同一番号のフォークがあっても範囲が広がらないこと
  - `resolveBlockJump`: 「数字のみだが安全な整数を超える」は notFound
    ではなく invalid に振り分けること（出し分けの要）/ 空文字・空白のみ /
    前後空白 + 先頭ゼロでの成功 / 番号 0 の検索 / 保持範囲の内側の
    欠番（観測の取りこぼし）でも notFound になり範囲は窓全体を示すこと /
    保持1件のときの min === max / フォーク時に tie-break の勝者を返すこと
- `entities/blockDetail.jumpTieBreak.test.ts`（新規）
  - フォーク tie-break の**3実装（`findBlockByNumber` /`findChildBlock` /
    `chainRibbon.ts` の `pickCanonicalPerNumber`）が同じ勝者を選ぶ**という
    不変条件そのものを固定する相互チェック。`pickCanonicalPerNumber` は
    非公開のため `deriveRibbonTiles` 経由で観測する
  - 受信時刻優先（hash 辞書順だけに退化していないことを区別できる
    組み合わせを含む）/ 複数ノードの最遅受信を使うこと / 未受信ブロックの
    扱い / 非有限な受信時刻（NaN・Infinity）を未受信として無視すること /
    3分岐フォーク / 複数番号の同時フォーク / 走査順（Map の挿入順）非依存
  - 「次のブロック」と番号ジャンプが**別の答えを返してよい**ケース
    （番号が飛んだ子ブロック）も、規則の不一致ではないことを明示して固定
- `side-panel/BlockJumpForm.test.tsx`（既存ファイルへ追加）
  - 保持窓外の番号では送信ボタンが disabled になり、フォーム送信しても
    移動しないこと（UI-B-07a シナリオ2の分岐）
  - 空白のみの入力は空欄と同じ扱い（disabled・エラー非表示）
  - 前後空白付き・先頭ゼロ付きの番号でも移動できること
  - 表示中のブロック自身の番号は送信可能なまま（自分自身への移動は無害）
  - フォークした番号では tie-break の勝者の hash へ移動すること
  - 送信ボタンの連続クリック（親が差し替わる前）で同じ hash への移動が
    冪等に繰り返されるだけで、入力欄や活性状態が壊れないこと
  - エラーの出し分け網羅: 安全な整数を超える数字のみの入力は invalid /
    全角数字は invalid / 保持1件のときの「#7 〜 #7」表記 / 英語表示でも
    `{min}`/`{max}` が置換されること / notFound → invalid → 空欄と
    入力を変えたときに表示が正しく切り替わること
- `side-panel/BlockJumpForm.liveUpdate.test.tsx`（新規）
  - チェーンが進行し続けている最中の追随挙動に絞ったファイル。入力途中に
    新ブロックが届いても入力欄が消えないこと（同期の判定が hash であって
    `BlockEntity` のオブジェクト同一性ではないこと）/ 同番号の別フォークへ
    表示が切り替わったときは再同期すること / 未到着の番号を先回り入力して
    いた場合、到着した瞬間に notFound が消えて送信できるようになること /
    逆に保持窓から外れた瞬間に送信不可になりエラーの範囲表示も更新される
    こと / 途中で競合フォークが届いたら新しい勝者へ移動すること /
    保持窓が空になった場合のフォールバック（`resolveBlockJump` の防御的な
    分岐）が UI まで壊れずに通ること
- `side-panel/SidePanelHost.blockDetail.test.tsx`（既存ファイルへ追加）
  - ジャンプ後に入力欄と前後ボタンの対象が移動先のブロックへ揃うこと
  - 保持窓外の番号を入力してもパネルの中身が変わらないこと
    （Playwright では disabled 要素をクリックできないため、この経路は
    ユニットテスト側で押さえる）
  - ジャンプで遡った古いブロックが後から保持窓を外れた場合、既存の
    ダングリングガードが働いてパネルが閉じること

#### 見つかった問題（テストコード側の修正）

- `packages/e2e/src/ui/block-detail-jump.spec.ts` の「保持窓外の番号」の
  シナリオが、**disabled になっている「移動」ボタンを `click()` していた**。
  実装は仕様どおり notFound の間は送信ボタンを disabled にする
  （ARCHITECTURE.md §18.3.1）が、Playwright の click は
  `["visible", "enabled", "stable"]` が揃うまで待つため、この行は
  enabled にならないまま必ずタイムアウトする（playwright-core 1.61.1 の
  `_retryPointerAction` が `waitForEnabled` で待つ状態を確認済み）。
  実機で走らせれば確実に落ちる箇所だったため、クリックせずに
  「notFound エラーが範囲付きで表示される」「送信ボタンが disabled」
  「パネルの中身が変わらない」を確認する形へ修正し、`SCENARIOS.md` の
  UI-B-07a の記述（「『移動』を押す」）も実際の仕様に合わせて直した。
  実装側のバグではないため差し戻しはしていない。
- 実装ロジック（`entities/blockDetail.ts` / `BlockJumpForm.tsx`）に
  バグは見つからなかった。特に懸念していた「3箇所に重複した tie-break の
  ずれ」「入力中に保持窓が更新されたときの入力欄の消失」「invalid と
  notFound の取り違え」は、いずれも実装が正しく振る舞うことを確認した。

#### 回帰検出力の確認

追加したテストが実際に退行を捕まえられることを、実装を一時的に壊して確認
した（確認後はいずれも元に戻し済み）。

- `blockNumberRange` の `min === undefined` を `!min` に変えると、
  「ブロック番号 0 を最小値として扱う」テストのみが失敗した
- `BlockJumpForm` の `useEffect` の依存を `[block.hash]` から `[block]` に
  変えると、「同じ hash の新しいオブジェクトに差し替わっても入力を保つ」
  テストのみが失敗した
- `findBlockByNumber` の tie-break を hash 辞書順のみに変えると、
  相互チェック 12 件中 7 件が失敗した

#### 確認

- `pnpm lint`（ルート）: エラーなし
- `pnpm build`（ルート、全パッケージ。e2e の `tsc --noEmit` を含む）: 成功
- `pnpm test`（ルート）: shared 75 / e2e 185 / collector 1765 /
  frontend 4029（テスト強化前は 3968。+61 件）すべて成功

#### 次の担当への申し送り

- e2e（UI-B-07a）の実機実行は依然として未確認。上記の修正で「必ず
  タイムアウトする1行」は取り除いたが、実機での green 確認は QA に委ねる。
- フォーク tie-break の規則を将来変更する場合、
  `blockDetail.jumpTieBreak.test.ts` が3実装の不一致を検出して落ちる。
  落ちたときは3箇所（`findBlockByNumber` / `findChildBlock` /
  `pickCanonicalPerNumber`）を同時に直すこと。

### 2026-07-26 Issue #428 レビュー結果（reviewer、合格）

- 担当: reviewer
- 判定: **合格**。差し戻し事項なし、コードの修正は行っていない

#### 確認内容

- `docs/ARCHITECTURE.md` §18.3.1 の設計内容と実装が完全に一致することを
  確認した。`packages/shared`・collector の変更は無く、既存の
  `BlockEntity` 群の中で完結している。境界の遵守・チェーン固有語彙の
  非漏出も問題なし
- 品質ゲート観点: `parseBlockNumberInput` は異常系を `undefined` として
  明示的に返すだけの純粋関数で、`catch` によるエラー握りつぶしは無い。
  diff全体に `try`/`catch` は1つも追加されていない。`resolveBlockJump` の
  `blocksByHash` 空Mapに対するフォールバックは理由がコード内コメントに
  明記されている。e2eの「保持窓外」テストは絶対値ではなく相対オフセット
  （現在表示中の番号 + 1,000,000）で作っており固定値ルール違反もない
- Issue本文・ARCHITECTURE.md §18.3.1との突き合わせ: UI配置、
  `type="text"` + `inputMode="numeric"`、バリデーション、エラー出し分け、
  i18nキー4種、関数構成、コンポーネント分離、E2E 3ケース、すべて設計どおり
- `findBlockByNumber`/`findChildBlock`/`pickCanonicalPerNumber` の
  tie-break規則の意図的な重複実装は、Issue #409の前例を踏襲したもので、
  `blockDetail.jumpTieBreak.test.ts` が3実装の相互一致を固定しているため
  ドリフトのリスクは抑制されている。設計判断として妥当と判断
- `pnpm lint && pnpm build && pnpm test`: shared 75件・collector 1765件・
  e2e 185件・frontend 4029件、すべて成功
- テストコードの質: `blockDetail.jump.test.ts` は広範な異常系をカバーし、
  実際の退行を検出する形になっている。`blockDetail.jumpTieBreak.test.ts`
  は3実装の相互一致という不変条件そのものを固定しており意味のある検出力を
  持つ。統合テストでジャンプ経由の遷移・ダングリングガードの連携まで検証
  されている
- コミット粒度: `git log main..HEAD` で13コミット、それぞれ独立した関心事
  に対応しており「1つの変更内容 = 1コミット」の原則に沿っている

#### 軽微な所感（ブロッキングではない）

GitHub Issue #428にラベル・マイルストーンが付与されていないが、直近の
他Issue（#420等）にも同様の欠落があり本Issue固有の問題ではないため指摘
事項としては扱わない。

#### 次の担当への申し送り

`chainviz-qa` による実機検証（特に `packages/e2e/src/ui/block-detail-jump.spec.ts`
のUI-B-07aシナリオが実機でgreenになるか）を推奨する。

### 2026-07-27 Issue #428 実機検証（QA、条件付き不合格・e2e テストのみ差し戻し）

- 担当: qa
- ブランチ: issue-428-block-detail-number-jump（origin の 6c32207 時点）
- 判定: **ブロック番号ジャンプ機能そのものは合格**。ただし
  `packages/e2e/src/ui/block-detail-jump.spec.ts` の UI-B-07a シナリオ1が
  **実機で決定論的に失敗する**ため、この e2e テストファイルの修正を
  frontend 担当へ差し戻す。実装ロジック側のバグではない。

#### 検証環境

- `profiles/ethereum` の Docker スタックを起動し（Playwright の globalSetup
  が `ensureChainRunning` 経由で `docker compose up -d` する）、reth1/reth2・
  beacon1/beacon2・validator1/validator2・workbench の7コンテナが Up、
  `eth_blockNumber` が増え続けることを確認した。
- collector は globalSetup が UI 層 E2E 用ポート（WS 4125 / プロキシ 4126）で
  起動、frontend は vite dev server（5275）を起動して chromium から操作した。
- 当環境の Playwright chromium はシステムに `libnspr4.so` 等が無く起動でき
  ないため、`LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu`
  を付けて実行した（Issue #373 / #409 と同じ環境側の既知の準備。リポジトリ
  には影響しない）。
- 検証の途中で PC が再起動されたため、コンテナを作り直した状態（genesis 直後の
  チェーン）でも同じ手順を最初からやり直し、同じ結果になることを確認している。

#### 1. UI-B-07a（`block-detail-jump.spec.ts`）の実行結果

`pnpm --filter @chainviz/e2e exec playwright test src/ui/block-detail-jump.spec.ts`

- シナリオ1「保持窓内ジャンプ成功」: **失敗**（2回実行して2回とも同じ箇所。
  チェーンを作り直した後も再現するので実行タイミング依存ではない）
- シナリオ2「保持窓外の番号でエラー」: 成功
- シナリオ3「数値以外で送信ボタン disabled」: 成功

失敗の原因は **e2e テストコードのロケータの不備**で、実装のバグではない。

```
Error: locator.getAttribute: Error: strict mode violation:
  getByTestId('block-detail-view').locator('[data-testid^="block-detail-prev-"]') resolved to 2 elements:
    1) <button ... data-testid="block-detail-prev-0x4bc5...3a63">前のブロック</button>
    2) <p class="block-detail-view__nav-reason" data-testid="block-detail-prev-reason">
       これより前は保持期間外のため表示できません</p>
```

- 同ファイル末尾のヘルパー `currentHash()`（143行目）が
  `[data-testid^="block-detail-prev-"]` という前方一致だけでボタンを
  特定している。`BlockDetailView.tsx` は「前のブロック」が disabled の
  ときに `data-testid="block-detail-prev-reason"` の `<p>` も描画する
  （同ファイル 237〜241 行）ため、この前方一致は **ボタンと理由文の2要素**
  にマッチし、Playwright の strict mode 違反になる。
- シナリオ1は「最初のタイル」＝保持窓の最古のブロックでパネルを開くので、
  `parent === undefined` すなわち理由文が必ず描画される。したがってこの
  失敗は毎回・確実に発生する。
- 既存の `block-detail.spec.ts`（UI-B-07）にも同じ書き方のヘルパー
  `getDisplayedBlockHash()` があるが、そちらは「子ブロックへ移動した後」
  （＝ prev が enabled で理由文が無い状態）でしか呼ばれないため露見して
  いなかった。今回の新規テストが最古ブロックの状態で呼んだことで初めて
  顕在化した。
- 修正の方向（frontend 担当向け）: セレクタを
  `button[data-testid^="block-detail-prev-"]` のように要素名で絞る。
  QA 側の手動検証スクリプトではこの形で問題なく hash を取得できることを
  実機で確認済み。`block-detail-next-` 側にも `block-detail-next-reason`
  が存在するので同じ注意が必要。

#### 2. ブロック番号ジャンプ機能そのものの実機確認（すべて期待どおり）

ブラウザ（chromium）で実際に操作し、以下を確認した。

- **保持窓内ジャンプ成功**: 保持窓が #29〜#37 の状態で、#29 を表示中に
  `37` を入力して「移動」を押すとパネルが #37 に差し替わり、逆に `29` で
  戻れた。中間の `33` へのジャンプも成功。1ブロック隣だけでなく
  8ブロック離れた移動が両方向で動く。サイドパネルは1枚のまま中身だけが
  差し替わる（`side-panel` の要素数は1のまま）。
- **入力欄の同期**: 前後ボタンで移動しても、ジャンプで移動しても、入力欄の
  値が移動先のブロック番号に追随することを確認した。
- **Enter 送信**: 入力欄で Enter を押しても「移動」ボタンと同じく移動する。
- **保持窓外の番号**: 表示中の番号 + 1,000,000 を入力すると
  「指定したブロック番号は見つかりませんでした（現在保持しているのは
  #12 〜 #13）」のように保持範囲を具体値で提示するエラーが出て、「移動」
  ボタンは disabled のまま、パネルの中身も変わらなかった。
- **数値以外の入力**: `abc` / `12a` / `-5` / `1.5` / `1,000` / `0x10` /
  `#12` / `＃12` / 全角数字 `１２３` のいずれでも
  「0以上の整数を入力してください」が表示され、「移動」ボタンは disabled。
  空白のみの入力ではエラーを出さずに disabled のみ（仕様どおり）。
  前後空白付き・先頭ゼロ付き（`  012  ` 等）は有効な入力として受け付けられた。
- **英語表示**: 言語を English に切り替えると
  「No block found with that number (currently retained: #29–#37)」と
  `{min}`/`{max}` が正しく置換されて表示された。ラベルは
  「Jump to block number」、ボタンは「Go」。
- **配置**: 設計どおり「前のブロック」「次のブロック」のボタン列のすぐ上に
  ジャンプ欄が置かれており、prev が disabled で「これより前は保持期間外の
  ため表示できません」と出ている場面でも、その直前にジャンプ欄が見える。

#### 3. 既存の前後ナビゲーションのデグレ確認

- `packages/e2e/src/ui/block-detail.spec.ts`（UI-B-07）を実機で実行し
  **成功**。前後ナビゲーション・保持窓境界での disabled と理由表示・
  チェーン先端での「最新のブロックです」まで従来どおり動作している。
- 手動確認でも、ジャンプで移動した直後に「次のブロック」を押して
  1つ先へ進めること（#33 → #34）を確認した。ジャンプと前後ボタンの
  併用でパネルの状態が壊れることはない。

#### 次の担当への申し送り

- frontend 担当へ: `packages/e2e/src/ui/block-detail-jump.spec.ts` の
  `currentHash()` のセレクタを修正し、実機で UI-B-07a の3シナリオが
  green になることを確認してほしい。実装コード
  （`entities/blockDetail.ts` / `BlockJumpForm.tsx` / `BlockDetailView.tsx`）
  には手を入れる必要はない。
- 修正後は QA で再検証する。機能面は本記録のとおり確認済みなので、
  再検証は UI-B-07a の実行が中心になる。
- `docs/PLAN.md` のチェックボックスは実装担当が既にチェック済み。今回は
  e2e テストの差し戻しがあるため QA 側での追加のチェックは行っていない。

### 2026-07-27 Issue #428 QA差し戻し対応（tester、e2e テストの修正）

- 担当: tester
- ブランチ: issue-428-block-detail-number-jump
- 対象: QA が報告した e2e テストの不備のみ。実装コード
  （`entities/blockDetail.ts` / `BlockJumpForm.tsx` / `BlockDetailView.tsx`）は
  変更していない。

#### 1. 表示中 hash 取得ヘルパーのセレクタ修正

`packages/e2e/src/ui/block-detail-jump.spec.ts` の `currentHash()` と、
`packages/e2e/src/ui/block-detail.spec.ts` の `getDisplayedBlockHash()` の
セレクタを `[data-testid^="block-detail-prev-"]` から
`button[data-testid^="block-detail-prev-"]` へ変更した。

`BlockDetailView` は「前のブロック」が disabled のとき理由文
`<p data-testid="block-detail-prev-reason">` も描画するため、前方一致だけだと
ボタンと理由文の2要素にマッチして Playwright の strict mode 違反になる。
UI-B-07a のシナリオ1は保持窓の最古ブロックでパネルを開くので prev が必ず
disabled になり、毎回確実に失敗していた。`block-detail.spec.ts` 側は prev が
enabled の状態でしか呼んでいなかったため露見していなかったが、同じ潜在バグ
なので併せて修正した。なぜ `button` で絞る必要があるかは両ヘルパーの
docstring に残してある。

実機（`profiles/ethereum` の Docker スタック + collector 4125/4126 + vite 5275）
で以下を確認した。

- 修正前: UI-B-07a シナリオ1が QA 報告と同じ strict mode violation で失敗
  （シナリオ2・3 は成功）
- 修正後: `block-detail-jump.spec.ts`（3件）と `block-detail.spec.ts`（1件）の
  計4件がすべて成功

#### 2. 同種の衝突を検知する構造整合テストの追加（再発防止）

`packages/e2e/src/ui/support/testid-prefix-locator.ts`（判定ロジック）と
`testid-prefix-locator.unit.test.ts`（ユニットテスト + 実走査）を追加した。
`support/cleanup-consistency.unit.test.ts`（Issue #233）と同じ考え方で、
「同型の書き方が別ファイルに取り残される」ことを構造的に検知する。

- `src/ui/*.spec.ts` に現れる `[data-testid^="..."]` の前方一致ロケータと、
  frontend 側に書かれた固定（テンプレートリテラルでない）data-testid を
  突き合わせ、衝突しうる組み合わせを検出する
- 要素名で絞っていないロケータは同じ接頭辞の固定 testid があれば衝突。
  要素名で絞ったロケータは接頭辞とタグの両方が一致する場合のみ衝突
- UI 層 E2E は実 Docker を要するため pre-push（`pnpm test`）では走らない。
  この検査は Docker 非依存のユニットテストなので pre-push で毎回走る
- 判定前にコメントを除去する。アンチパターンを注意書きとしてコメントに
  書けるようにするため。素朴に「`//` 以降を削る」実装だと `"http://..."`
  のような文字列リテラルを巻き込み、同じ行にある本物のロケータを見落とす
  ので、引用符の状態を追いながら除去している
- セレクタを修正前の状態に戻すと、この構造整合テストが実際に
  `block-detail-jump.spec.ts` の衝突を検出して失敗することを確認済み

現時点でリポジトリ全体を走査した結果、接頭辞を共有する固定 testid は
`block-detail-prev-reason` / `block-detail-next-reason` の2件のみで、
他の前方一致ロケータ（`chain-ribbon-tile-` / `toast-` / `ghost-card-` /
`wallet-tx-chip-` / `contract-activity-chip-` / `p2p-legend-count-`）に
衝突は無い。`block-detail-next-` 側は現在どの spec も前方一致で掴んで
いないが、掴む場合は同じく `button` で絞る必要がある（この検査が検出する）。

#### 実行した検証

- `pnpm lint` / `pnpm build` / `pnpm test`（shared 75・e2e 230・
  collector 1765・frontend 4029、すべて成功）
- 実機での UI-B-07a・UI-B-07 の Playwright 実行（上記のとおり）

#### 次の担当への申し送り

- 実装ロジックのバグは見つかっていない。QA の再検証は UI-B-07a と
  UI-B-07 の実行が中心になる。
- 当環境では Playwright chromium の起動に
  `LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu`
  が必要（Issue #373 / #409 / QA 記録と同じ環境側の既知の準備）。
