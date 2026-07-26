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
