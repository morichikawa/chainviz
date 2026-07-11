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

#### テスト強化（tester）

実装担当が書いた基本テスト（ハッピーパス中心）に対し、異常系・境界値の
観点で以下を追加した。実装コードは変更していない（テスト追加のみ）。

- `interaction/popoverPosition.test.ts` に境界値ケースを追加:
  gapPx が 0 の場合（アンカー下端に密着）、負の gapPx（クランプせず
  そのまま重ねる）、小数座標（`getBoundingClientRect` がズーム時に返す
  サブピクセル値を丸めず保持）、ビューポート右下端付近でも折り返さない
  こと（従来の `position: absolute` CSS もはみ出しを許容していたため挙動を
  変えないことの characterization。クランプが必要になった場合は別 Issue）、
  入力の `AnchorRect` を破壊しないこと、呼び出しごとに新しいオブジェクトを
  返すこと。
- `interaction/PopoverPortal.test.tsx` にエッジケースを追加:
  gapPx 省略時に既定値 8px が使われること、マウント時に `anchorRef.current`
  が null なら何も描画しないこと、マウント後にアンカーが割り当てられたら
  次フレームで追従を開始すること、gapPx prop 変更で位置が再計算される
  こと、表示中は毎フレーム `requestAnimationFrame` を予約し続けること、
  アンマウント時に `cancelAnimationFrame` が呼ばれ rAF ループがリーク
  しないこと、アンカー位置が変わらない間は子を再レンダーしないこと
  （無駄な再描画を避ける最適化）。
- `interaction/popoverPortalConsistency.test.tsx` を新設:
  対象8箇所（ActionHint / GlossaryTerm / InfraPopover / ContractPopover /
  WalletPopover / TxLifecyclePopover / ContractCard の活動チップ /
  WalletCard の tx チップ）すべてで、開いたポップオーバーが RTL の描画
  コンテナ（各カード/要素のローカルなサブツリー）の外にあり、かつ
  `document.body` 配下に portal されていることを横断的に固定する。将来
  ポップオーバーを追加/変更した際に「portal し忘れて隣接カードの下に
  隠れる」退行を検出する目的。

Issue #221 の遅延クローズ（`useHoverPopover`）と portal 化の相互作用は、
既存の `ActionHint.test.tsx`・`GlossaryTerm.test.tsx`・
`txLifecyclePopoverHover.test.tsx` が portal 化後の DOM に対して
mouseEnter/mouseLeave→遅延クローズの開閉を検証しており（portal 先の
`document.body` を `screen` が探索するため成立）、追加の重複ケースは
設けなかった。

`pnpm --filter frontend build`（`tsc -b`）・`pnpm --filter frontend test`
（vitest、115ファイル/1764件、テスト強化で +21 件）・上記3ファイルへの
`eslint` はいずれも成功。

#### レビュー（reviewer）

コードは変更せず、静的レビューとビルド・lint・テストの確認のみ実施した。
判定は**合格**。

確認した内容:

- **境界の遵守**: 変更は frontend 内に閉じており、Docker/ノードへの直接
  アクセスやチェーン固有語彙の漏れは無い。`packages/shared` の型変更も無い。
- **設計の妥当性**: `createPortal` で `document.body` 直下へ描画する方式は、
  React Flow の各ノードが `position` + `zIndex` で独立したスタッキング
  コンテキストを作る問題への正攻法。座標計算（`popoverPosition.ts`、純粋
  関数）と DOM 追従（`PopoverPortal.tsx`）の分離も 1 ファイル 1 責務に
  沿っている。8箇所すべてで `PopoverPortal` がイベントハンドラを持つ要素の
  **React ツリー上の子**として描画されていることを確認した。React の
  合成イベント（onMouseEnter/onMouseLeave）は DOM ツリーではなく React
  ツリーで伝播するため、portal 先（body 直下）へカーソルを移してもアンカーの
  onMouseLeave は発火せず、Issue #221 の `useHoverPopover`（遅延クローズ）
  との相互作用は保たれる（ポップオーバー内のリンク操作や入れ子の
  GlossaryTerm も成立する構造）。
- **rAF 常時ループの負荷**: ループが回るのはポップオーバー表示中のみ
  （`{open && <PopoverPortal/>}` の条件付きマウント）。毎フレームの処理は
  `getBoundingClientRect` 1回 + 座標比較のみで、位置不変時は `setState` を
  スキップして再レンダーを避けている。キャンバスのパン/ズームは CSS
  transform で行われ scroll/resize イベントが飛ばないため、
  IntersectionObserver/ResizeObserver では追従できず、rAF ポーリングは
  この用途の標準的な手段（Floating UI の autoUpdate animationFrame と同型）。
  許容範囲と判断した。
- **ビューポート非クランプの判断**: 従来の CSS も折り返し・クランプを
  していなかったため、バグ修正の範囲で挙動を変えない characterization は
  妥当。なお portal 化により、従来は `.react-flow`（overflow: hidden）で
  クリップされていたキャンバス端のポップオーバーが画面端まで表示される
  ようになる（読める方向への変化）。端で読みにくいケースが QA/実利用で
  見つかればクランプは別 Issue とする方針に同意する。
- **z-index の整合**: body 直下に出るポップオーバー（20/25/30）は
  トースト（40）より下、ツールバー（10）より上で、意図した順序。
  `.operation-panel`（25、ノード内のまま）が対象外である旨も worklog に
  明記されている。
- **テストの質**: 純粋関数の境界値（gap 0/負値/小数/負座標/入力非破壊）、
  rAF のライフサイクル（クリーンアップ・リーク・追従開始/停止）、および
  8箇所横断の「portal し忘れ」退行検出テストが揃っており、実装の詳細を
  なぞるだけの無意味なテストは見当たらない。エラー握りつぶし・環境状態
  依存の固定値も無し（gapPx 6/8px は CSS 由来のデザイン定数であり
  環境依存値ではない）。
- **ビルド・lint・テスト**: リポジトリ全体で `pnpm build` / `pnpm lint` /
  `pnpm test`（frontend 115ファイル/1764件を含む）すべて成功。
- **コミット粒度**: feat（PopoverPortal 新設）→ fix（8箇所への適用 +
  既存テスト追随 + CSS 整理）→ docs → test×3 の6コミットで、
  Conventional Commits 準拠・1変更1コミットの粒度も問題なし。

QA への申し送り: jsdom では実ブラウザのマウス移動に伴う enter/leave の
伝播（portal をまたぐカーソル移動）を完全には再現できないため、実機で
「カード → ポップオーバー内へカーソルを移動してもポップオーバーが
閉じず、内部のリンク（例: InfraPopover の駆動する実行ノード）や入れ子の
GlossaryTerm を操作できること」「パン/ズーム/ドラッグ中の追従」を確認
してほしい。

#### QA検証記録（qa）

コードは変更していない。実機（実ブラウザ）で動かして検証した。判定は**合格**。

検証環境:

- frontend を `vite dev`（`VITE_COLLECTOR_URL` 未設定 = モッククライアント）で
  ポート5199に起動。
- 実ブラウザは headless Chromium（Playwright キャッシュの
  `chromium-1228/chrome-linux64/chrome`、Chrome for Testing 149）。起動に
  必要な共有ライブラリ（libnspr4 / libnss3 / libasound2t64）が
  サンドボックスに無かったため `apt-get download` + `dpkg -x` で
  ユーザーディレクトリに展開し `LD_LIBRARY_PATH` で読ませた。操作は
  リポジトリ同梱の playwright-core 1.61.1 経由。

実施内容と結果:

1. 元Issueの再現手順（隣接カードの下に隠れないこと）:
   `chainviz-reth-1`（infra-card-reth-node-1）を `chainviz-lighthouse-1`
   の直下へドラッグしてほぼ隙間なく隣接させ（実測 A.bottom≈169 /
   B.top≈179、左端ズレ約35px）、上側カードにホバーして InfraPopover を
   開いた。ポップオーバーと下側カードが物理的に重なる点
   （実測 (729,204)）で `document.elementsFromPoint()` を取得したところ、
   スタック順は上から `infra-field__label` → `infra-field` →
   `infra-popover`（index 0〜2）→ 下側カードの `infra-card` /
   `react-flow__node`（index 3〜5）で、ポップオーバーが下側カードより
   確実に前面にあることを実測で確認した（両者が同一点で重なっている
   ことも `elementsFromPoint` の両方の出現で確認済み。修正前はこの
   react-flow ノードのスタッキングコンテキストが勝ってポップオーバーが
   隠れていた）。スクリーンショットでも、IP・ポート・プロセス・CPU・
   メモリ・クライアント・役割・P2Pでの役割・同期状態・ブロック高・
   駆動元・同期ステージ各行・txpool の全フィールドが隣接カード
   （workbench-alice / EOA カード）の手前に読める状態を視覚確認した。

2. レビューア申し送り3点:
   - ポップオーバー内へカーソルを移しても閉じない（Issue #221 の遅延
     クローズが機能）: カードからポップオーバー内部へカーソル移動後
     600ms 待っても InfraPopover が開いたままであることを確認。
   - 入れ子の GlossaryTerm を操作できる: ポップオーバー内の
     `.glossary-term` にホバーすると `.glossary-popover` が開き、その
     用語ポップオーバー自身が最前面に描画される（`elementFromPoint` が
     `.glossary-popover` を返す）ことを確認。
   - パン/ズーム/ドラッグ中の追従: 上側カードをドラッグ中もポップ
     オーバーがアンカー（カード）に追従し、`pop.left - card.left ≈ 0`・
     `pop.top - card.bottom ≈ 8px`（gapPx）を維持することを実測で確認。
     パン/ズームも同一の `requestAnimationFrame` によるアンカー
     追従コードパスを通るため、ドラッグ追従の確認をもって同等と判断。

3. 8箇所のうち代表的な5箇所を実機で確認:
   InfraPopover（上記1）、GlossaryTerm（上記2）に加え、ContractCard の
   活動チップ（`.contract-activity-chip__popover`）、WalletCard の tx
   チップ（`.tx-lifecycle-popover`）、ActionHint（`.action-hint__popover`）
   のいずれも、開いたポップオーバーの親要素が `document.body` 直下
   （portal 済み）であり、かつ `elementFromPoint` で最前面に描画される
   ことを確認した。残る ContractPopover / WalletPopover /
   WalletPopover の TxItem も同一の `PopoverPortal` 機構を共有しており、
   reviewer の横断テスト（`popoverPortalConsistency.test.tsx`）で
   portal されることが固定済み。

完了条件（ポップオーバーが隣接カードの下に描画され読めない、が解消
されていること）を満たしていることを実機で確認した。
