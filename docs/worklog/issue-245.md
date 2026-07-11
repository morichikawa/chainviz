### 2026-07-11 Issue #245 カードのホバーポップオーバーが隣接カードの下に描画され読めない

- 担当: frontend
- ブランチ: issue-245-popover-zindex

#### 設計メモ（着手前）

**原因の特定**: `@xyflow/react`（v12.11.1）は各ノードのラッパー要素
（`.react-flow__node`）に `style={{ zIndex: internals.z, position: "absolute" }}`
を直接付与してレンダリングする（`node_modules/@xyflow/react/dist/esm/index.js`
の `NodeWrapper` 実装で確認）。`position` + `zIndex` の組を持つ要素は CSS の
仕様上それ自身で新しいスタッキングコンテキストを作るため、各ノードは互いに
独立したスタッキングコンテキストになる。

`styles.css` のポップオーバー各クラス（`.infra-popover` 等）は
`position: absolute` でカード内に子要素として描画され、`z-index: 20〜30` を
持つが、この z-index は**自分が属するノードのスタッキングコンテキスト内でしか
比較されない**。そのため、ポップオーバーの z-index をどれだけ上げても、
「別ノード（＝別スタッキングコンテキスト）」である隣接カードの手前に出る保証は
無い。実際、React Flow は `zIndexMode: "basic"`（既定）でノードの重なり順を
（選択/ドラッグによる一時的な elevate を除けば）DOM 挿入順で決めており、
隣接ノードのどちらが後発の DOM 順かによって、ポップオーバーが勝つか負けるかが
決まる。これが Issue 本文の再現（beacon1-1 のポップオーバーが下段の reth2-1
の下に隠れる）の根本原因。

**実機再現による確認**: サンドボックス環境に Chromium 実行に必要な共有
ライブラリが無かったため、Issue #221 と同じ手順（`apt-get download` で
`.deb` を取得し `dpkg -x` でユーザーディレクトリに展開、
`LD_LIBRARY_PATH` で読ませる）で headless Chromium を用意し、
Playwright（`~/.cache/ms-playwright` にキャッシュ済みのバイナリ、
`~/.npm/_npx` にキャッシュ済みの `playwright` パッケージ）経由で
`vite dev`（モッククライアント）に接続した。2枚の実カード
（`chainviz-reth-1`／`chainviz-lighthouse-1`）をドラッグしてほぼ隙間なく
隣接させ、上側のカードにホバーした状態で `document.elementFromPoint()` を
使い、下側カードのポップオーバー領域の実際の最前面要素を調べたところ、
修正前は隣接カード自身（`.infra-card__subtitle` 等）がポップオーバーの
上に重なって表示され、ポップオーバーの IP/ポート等のフィールドが隠れる
ことを実測で確認した（スクリーンショットでも視覚的に確認済み）。

**採用する修正方針**: 既存の CSS 構造・DOM 構造は変えず、ポップオーバーの
「描画先」だけを React の `createPortal` で `document.body` 直下に変える。
`document.body` はどの `.react-flow__node` のスタッキングコンテキストにも
属さないため、独立した z-index 比較のもとで確実に最前面に出せる
（`.app` 自体は `position`/`z-index` を持たずスタッキングコンテキストを
作らないことを `styles.css` で確認済み）。

具体的には `interaction/` 配下（Issue #221 の `useHoverPopover.ts` と同じ
「カード種別を跨ぐ汎用の操作性ロジック」の置き場）に以下2つを新設する。

- `interaction/popoverPosition.ts`: アンカー要素の `DOMRect`（`top`/`left`/
  `bottom`）から、その左下（下端 + gapPx、左端揃え）の座標を返す純粋関数
  `computePopoverPosition`。既存 CSS の
  `position: absolute; top: calc(100% + Npx); left: 0;` と等価な配置を、
  `position: fixed` 用の絶対座標として計算し直したもの。DOM 非依存で
  ユニットテストしやすい形に分離する。
- `interaction/PopoverPortal.tsx`: `anchorRef`（アンカー要素への
  `RefObject`）と `children` を受け取り、`document.body` へ `createPortal`
  する共通コンポーネント。表示中は `requestAnimationFrame` でアンカーの
  `getBoundingClientRect()` を毎フレーム再計算し、位置 state を更新する。
  キャンバスのパン/ズームは `.react-flow__viewport` への CSS `transform`
  で行われ、`scroll`/`resize` イベントが発火しないため、個々のイベントに
  フックする代わりに rAF ポーリングで座標追従する（ノードのドラッグ・
  親コンテナのスクロールも同じ仕組みで自動的に追従できる、汎用的な手段）。
  位置が変化していない場合は `setState` をスキップして無駄な再レンダーを
  避ける。

**対象8箇所への適用方法**: Issue #221 の設計メモで洗い出した8箇所を、
アンカーの持ち方で2パターンに分ける。

1. **自己完結型**（トリガー要素とポップオーバーが同じコンポーネント内にある）:
   `GlossaryTerm`・`ActionHint`・`ContractCard` の `ActivityChip`・
   `WalletCard` の `TxChip`・`WalletPopover` の `WalletPopoverTxItem`。
   コンポーネント内で `useRef` を作り、トリガー要素（既存の
   `onMouseEnter`/`onMouseLeave` を付けている要素）にそのまま割り当てるだけ。
2. **カード分離型**（カード本体と詳細ポップオーバーが別コンポーネント）:
   `InfraNodeCard`→`InfraPopover`、`ContractCard`→`ContractPopover`、
   `WalletCard`→`WalletPopover`。カード側で作った `anchorRef` を
   ポップオーバー側コンポーネントへ新規 prop として渡す（`anchorRef` を
   必須 prop にする。ポップオーバー単体では位置決めの基準が無く成立しない
   ため、任意にしてフォールバック描画を持たせると経路が二重になり複雑化する）。
   `TxLifecyclePopover` も `TxChip`/`WalletPopoverTxItem` 側が持つ `anchorRef`
   を必須 prop として受け取る（2箇所から使われるため2番目のパターンに含める）。

各ポップオーバーの実装は、これまでの
`<div className="infra-popover" role="tooltip" ...>...</div>` を
`<PopoverPortal anchorRef={anchorRef} className="infra-popover" role="tooltip" ...>...</PopoverPortal>`
に置き換えるだけで、内部の JSX 構造・CSS クラスはそのまま流用する
（見た目のデグレを避ける）。ギャップ量（gapPx）は既存 CSS の
`calc(100% + Npx)` の値（8px/6px、クラスごとに異なる）をそのまま
`PopoverPortal` の `gapPx` prop に渡す。

`styles.css` 側は、各ポップオーバークラスの `position: absolute` /
`top: calc(...)` / `left: 0` を削除する（`PopoverPortal` が常に
インライン `style` で `position: fixed` + 実座標を与えるため、CSS 側の
指定は死んだコードになり、残すと「CSS で位置決めしている」という誤解を
招く）。`z-index` はそのまま残す（`document.body` 直下でも、入れ子の
ポップオーバー同士の重なり順は z-index の相対値で決まるため。例:
`InfraPopover`（20）の中の `GlossaryTerm` の `.glossary-popover`（30）が
`InfraPopover` の上に出る、という既存の意図した重なり順は z-index の
大小関係だけで再現できる）。

**対象外**: `.operation-panel`（`OperationPanel.tsx`）はクリックトグルで
開閉するパネルであり、Issue #221 の整理でも「ホバーポップオーバー」の
対象外とされている。本 Issue のタイトルも「ホバーポップオーバー」に限定
しているため、今回も変更しない（同じスタッキングコンテキストの制約は
理論上当てはまるが、別の Issue として切り出す）。

**テストへの影響**: `InfraPopover`/`ContractPopover`/`WalletPopover`/
`TxLifecyclePopover` は `anchorRef` が必須 prop になるため、これらを
直接単体テストしている既存テスト（`InfraPopover.test.tsx`・
`InfraPopover.testid.test.tsx`・`ContractPopover.test.tsx`・
`WalletPopover.test.tsx`・`TxLifecyclePopover.test.tsx`・
`txLifecyclePopoverHover.test.tsx` の一部）は呼び出し側に `anchorRef` を
追加する。`@testing-library/react` の `screen` はデフォルトで
`document.body` を検索範囲にするため、portal 化してもほとんどのアサーション
（`screen.getByTestId`/`getByRole` 等）はそのまま通る。ただし `render()` の
戻り値 `container`（RTLがマウント用に作る要素）を直接
`querySelectorAll` している箇所（`InfraPopover.test.tsx` の
sync-progress-bar 検証、`TxLifecyclePopover.test.tsx` のバッジ className
検証）は、portal 先が `container` の外（`document.body` 直下）になるため
見つからなくなる。該当箇所は `screen`/取得済み要素からの `querySelector`
に置き換える。

新設する `computePopoverPosition`/`PopoverPortal` 自体は新規ユニットテストを
追加する（純粋関数の座標計算、rAF による追従、アンマウント時のクリーン
アップ）。

#### 実装メモ（作業中の補足）

作業途中でセッションのAPI利用上限エラーが発生し、リセット後に元の
worktree ディレクトリ（`wt-issue-245`）自体が失われる事象が起きた
（ディスク上から消えていたが `git worktree` の管理情報には
prunable な状態で残っていた）。その時点までの未コミットの実装
（`interaction/popoverPosition.ts`・`PopoverPortal.tsx`とそのテスト、
`GlossaryTerm.tsx`・`ActionHint.tsx`・`InfraNodeCard.tsx`・
`InfraPopover.tsx`の変更、`ContractCard.tsx`の変更途中）はすべて失われた
ため、`git worktree add` で同じブランチ（`issue-245-popover-zindex`、
コミット無し・main と同一状態）に対して新しいディレクトリ
（`wt-issue-245-new`）を割り当て直し、設計内容を踏襲して実装を最初から
やり直した。実機再現の確認手順・結果は上記の「実機再現による確認」に
再掲した内容と同じ（再現自体は元セッションで実施済みの記録を基に記載）。

実装完了後、この `wt-issue-245-new` 上で改めて同じ手順（headless Chromium
+ Playwright、`chainviz-reth-1` を `chainviz-lighthouse-1` の直下へドラッグ
して隣接させ、`chainviz-lighthouse-1` にホバーしてポップオーバーを開く）を
実行し、修正後は隣接カードとの重なり領域で `document.elementFromPoint()`
がポップオーバー自身の要素を返すこと（＝ポップオーバーが最前面に描画され
ていること）をスクリーンショット付きで再確認した。IP・ポート・プロセス・
CPU・メモリ・クライアント・役割・P2Pでの役割・同期状態・ブロック高・
駆動する実行ノードの全フィールドが隣接カードに隠れず読める状態になった。

#### 実装内容のまとめ

- 新設: `packages/frontend/src/interaction/popoverPosition.ts`
  （`computePopoverPosition` 純粋関数）、
  `packages/frontend/src/interaction/PopoverPortal.tsx`（`createPortal` +
  `requestAnimationFrame` によるアンカー追従コンポーネント）。それぞれに
  対応するユニットテストを追加。
- 変更（自己完結型、ローカル `useRef` をアンカーに使用）:
  `glossary/GlossaryTerm.tsx`、`canvas/ActionHint.tsx`、
  `entities/ContractCard.tsx`（`ActivityChip`）、
  `entities/WalletCard.tsx`（`TxChip`）、
  `entities/WalletPopover.tsx`（`WalletPopoverTxItem`）。
- 変更（カード分離型、`anchorRef` を新規必須 prop として追加）:
  `entities/InfraNodeCard.tsx` → `entities/InfraPopover.tsx`、
  `entities/ContractCard.tsx` → `entities/ContractPopover.tsx`、
  `entities/WalletCard.tsx` → `entities/WalletPopover.tsx`、
  `entities/TxLifecyclePopover.tsx`（`TxChip`/`WalletPopoverTxItem` の両方
  から `anchorRef` を受け取る）。
- `packages/frontend/src/styles.css`: 上記5クラス
  （`.infra-popover`/`.contract-activity-chip__popover`/
  `.glossary-popover`/`.action-hint__popover`/`.tx-lifecycle-popover`）の
  `position: absolute`/`top: calc(...)`/`left: 0` を削除（`PopoverPortal`
  が常にインライン style で位置決めするため死んだ指定になる）。`z-index`
  は入れ子のポップオーバー同士の重なり順のために残した。
  `.wallet-popover__tx-item { position: relative; }` も、中の絶対配置要素
  が無くなったため削除。`.operation-panel`（クリックトグル、ホバー
  ポップオーバーではない）は対象外のまま変更していない。
- `docs/ARCHITECTURE.md` §1 の `interaction/` の説明に PopoverPortal の
  役割を追記。

既存テストへの影響として、`InfraPopover`/`ContractPopover`/
`WalletPopover`/`TxLifecyclePopover` を直接単体テストしていた
`InfraPopover.test.tsx`・`InfraPopover.testid.test.tsx`・
`ContractPopover.test.tsx`・`WalletPopover.test.tsx`・
`TxLifecyclePopover.test.tsx`・`txLifecyclePopoverHover.test.tsx` の
呼び出し箇所に detached 要素への `anchorRef` を追加した。また、RTL の
`container`（`InfraPopover.test.tsx` の sync-progress-bar 検証、
`TxLifecyclePopover.test.tsx` のバッジ className 検証）や `within(card)`
（`app/App.internalLink.test.tsx` の「lighthouse-1 の詳細ポップオーバーに
駆動先が出る」ケース）でポップオーバーの中身を検証していた箇所は、
portal 化により `document.body` 直下（RTL container やカード要素の外）に
描画されるようになったため、`document.body.querySelectorAll(...)` や
ポップオーバー自身の `data-testid` でスコープし直す形に変更した。

`pnpm --filter frontend build`（`tsc -b`）・`pnpm --filter frontend
build:web`（`vite build`）・`pnpm --filter frontend test`（vitest、
114ファイル/1743件）・`eslint packages/frontend/src` はいずれも成功した。

#### 次の担当が知っておくべき注意点

- `InfraPopover`/`ContractPopover`/`WalletPopover`/`TxLifecyclePopover` は
  `anchorRef` が必須 prop になった。これらを単体でテスト・利用する場合は
  必ず位置決めの基準になる要素への ref（`RefObject<HTMLElement | null>`）
  を渡す必要がある。
- 新しいホバーポップオーバーを追加する場合は、`PopoverPortal` を使うのが
  既定パターン。CSS 側には `position`/`top`/`left` を書かず、
  `PopoverPortal` の `gapPx` prop（アンカー下端からの余白）で位置を指定する。
- `PopoverPortal` は `requestAnimationFrame` でアンカー位置を継続的に追従
  するため、キャンバスのパン/ズーム・ノードのドラッグ中でもポップオーバーが
  正しい位置に追従する（個別の scroll/resize イベントには依存しない）。
