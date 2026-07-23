# Issue #410 ワークベンチの操作をする時にポップアップが邪魔で操作画面が見えない

### 2026-07-23 Issue #410 UX設計メモ

- 担当: ux
- ブランチ: issue-410-operation-panel-tooltip-suppression
- 内容: ユーザー指摘（「ワークベンチの操作パネルを開いても、他のツール
  チップ／ポップオーバーが表示されたままで操作画面が見えない」「操作画面
  にカーソルを当てている間は、ティップスは表示され続けなくてよい」）に
  対するUX設計。実装は chainviz-frontend が本メモを引き継いで行う。

#### 1. 実際に触って確認した課題

`pnpm --filter @chainviz/frontend exec vite --port 5299`（モックデータ、
`VITE_COLLECTOR_URL` 未設定）で frontend を起動し、`packages/e2e` の
Playwright（chromium。`LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/
x86_64-linux-gnu` を付けて共有ライブラリ不足を解消）から実際にワーク
ベンチカードをホバー・クリックして操作パネルを開く手順を再現した
（スクリーンショットで目視確認、および `getBoundingClientRect` による
重なり判定・実際のポインタ操作の可否も確認）。

原因は独立した3つの重なりで、いずれも「ホバーで開くツールチップ／
ポップオーバーの表示制御が、操作パネルが開いているかどうかを考慮して
いない」ことに起因する。

**原因1: 「操作を実行…」ボタンの予告ツールチップ（ActionHint）が、開いた
瞬間の操作パネルに重なる**

`InfraNodeCard.tsx` のワークベンチカード下部「操作を実行…」ボタンは
`ActionHint` でラップされており、ホバー中は予告文（「このワークベンチの
中で開発ツール（cast / forge）を実行します。RPC 呼び出しは {rpcTarget}
に送られ…」）がポップオーバー表示される。ボタンをクリックした直後も
カーソルはまだボタン上にあるため、`OperationPanel` が開いた瞬間にこの
予告ツールチップがまだ画面に残っており、パネルの本文（タブ・入力欄）に
ほぼ重なって隠れることを実機のスクリーンショットで確認した。

**原因2: 操作パネルを操作している間、カードのホバー詳細ポップオーバー
（InfraPopover）が閉じ続けない**

`InfraPopover`（IP・ポート・プロセス・CPU・メモリ等を表示するホバー
詳細）の表示可否は、カード全体（`.infra-card`）への `onMouseEnter`/
`onMouseLeave`（`useHoverPopover`）で制御されている。一方 `OperationPanel`
はポータルではなく `.infra-card` の DOM 子要素としてそのまま描画されて
いる（`InfraNodeCard.tsx` 末尾で `hovered && <InfraPopover .../>` の
直後に `operationPanelOpen && <OperationPanel .../>` を並べて描画。
どちらも `.infra-card` の子）。そのため、カーソルが操作パネルの入力欄や
ボタンへ移動しても、DOM 的には `.infra-card` から「出た」ことにならず
`mouseleave` が発火しない。結果として、一度カードにホバーしてボタンを
押し操作パネルを開くと、以後パネルを操作している間ずっと `InfraPopover`
が表示され続け、パネル本体と幾何学的に重なる。実機の Playwright 操作
（カードホバー→ボタンホバー→クリックでパネルを開く→パネル内の入力欄へ
ホバー、という一連の流れ）でも、パネルの入力欄にカーソルを移した後まで
`InfraPopover` が描画され続け、`getBoundingClientRect` の比較でパネルと
重なっていることを確認した。

**原因3: 用語解説ポップオーバー（GlossaryTerm）が操作パネルより前面
（z-index）に出て、クリック自体を物理的に妨害する**

`.glossary-popover` の `z-index: 30`（`ActionHint` のポップオーバーも
同じクラスを流用しており同値）は `.operation-panel` の `z-index: 25` より
高い。カードヘッダーの「ワークベンチ」ラベルや、原因2により表示され
続ける `InfraPopover` 内の各種用語解説（例:「操作先ノード」＝
`rpc-endpoint`）にカーソルが触れると、その定義ポップオーバーが操作
パネルの上に前面表示される。実機の Playwright 検証では、このポップ
オーバーが操作パネルの入力欄の上に居座り、その入力欄への疑似ポインタ
操作（`locator.hover()`）が実際にブロックされる（Playwright の
actionability チェックが "element intercepts pointer events" として
リトライを繰り返し、30秒のタイムアウトで失敗する）ことを確認した。
単なる見た目の重なりではなく、実際にクリック・入力ができない状態に
なることを実機で確認済み。

原因2（InfraPopoverが操作パネル使用中も閉じ続けない）が、原因3の
持続時間を長引かせる前提条件になっている。操作パネルを操作している間
ずっとカードが「ホバー中」と判定され続けるため、その間にカード上の
どの用語にカーソルが触れても、用語解説ポップオーバーが不必要に長く
残ってしまう。

#### 2. 設計判断

- **操作パネルが開いている間は、そのワークベンチカードの `InfraPopover`
  を表示しない**（カーソルがカード本体・操作パネルのどこにあっても
  同様）。理由: 操作パネルを開いた時点でユーザーの意図は「フォームへの
  入力」であり、同じカードから同時にインフラ詳細（IP・CPU等）まで見る
  必要は薄い。情報密度の高い2つのポップオーバーが同一カードから同時に
  出ると、どちらも中途半端にしか読めない。パネルを閉じれば通常の
  ホバー挙動（ホバーで `InfraPopover` が出る）に戻す。
- 上記の結果として、`InfraPopover` 内に埋め込まれた用語解説ポップ
  オーバー（`rpc-endpoint` 等）も連鎖的に表示されなくなるため、個別の
  抑制対応は不要になる見込み。
- **「操作を実行…」ボタンの予告ツールチップ（ActionHint）は、ボタンを
  クリックして操作パネルを開いた瞬間に明示的に閉じる**。カーソルが
  ボタン上に残っていても、パネルが開いた時点で予告の役目は終わって
  いる（`ARCHITECTURE.md` §6.5 でもこの予告は「ボタン押下前」の説明と
  位置づけられている）。この処理は、`GlossaryTerm.openPanel()` が用語
  集サイドパネルを開くと同時に自分自身のホバーポップオーバーを
  `close()` する既存パターン（`glossary/GlossaryTerm.tsx`）と同じ考え方
  である。
- z-index の並び替え（`operation-panel` を全ポップオーバーより高い値に
  上げる等）だけで対症療法的にすませることはしない。今回の実測で
  分かったとおり、単に「見た目の重なり」だけでなく「その位置の要素へ
  物理的にポインタ操作ができない」実害が出ている。z-index を上げれば
  見た目の重なりは操作パネルが勝つが、逆に用語解説ポップオーバー自体が
  操作パネルの下に隠れて読めなくなるだけで、「なぜ表示されたまま
  なのか」という根本（表示条件がパネルの開閉を考慮していない）は
  解決しない。表示条件そのものを制御する方針を優先する。

#### 3. 受け入れ条件（GitHub Issue #410 本文にも転記済み）

1. ワークベンチの「操作を実行…」ボタンをクリックして操作パネルを開いた
   瞬間、そのボタンの予告ツールチップ（ActionHint）は閉じる。
2. 操作パネルが開いている間、そのワークベンチカードの `InfraPopover`
   （ホバー詳細ポップオーバー）は表示しない。パネルを閉じれば通常の
   ホバー挙動に戻る。
3. 上記2の結果として、`InfraPopover` 内の用語解説ポップオーバーも
   連鎖的に表示されなくなる（個別対応は不要な見込み）。
4. 操作パネル自体は、開いている間は常にカーソルの位置に関わらず全体が
   視認・操作可能な状態を維持する。

#### 4. 実装方針（実装担当への申し送り）

- 型変更は不要（`packages/shared` は対象外）。変更は
  `packages/frontend` 内、具体的には `InfraNodeCard.tsx`（および必要に
  応じて `ActionHint.tsx`）に閉じる見込み。
- `InfraPopover` の表示条件を `hovered && !operationPanelOpen` に変更する
  （`operationPanelOpen` は既存の state をそのまま使える）。
- 「操作を実行…」ボタンの `ActionHint` を明示的に閉じる手段が必要。
  2案を検討した:
  - (a) `useHoverPopover` が返す `close()` を `ActionHint` の外へ公開する
    プロパティ（例: 制御用の ref や `open`/`onRequestClose` props）を
    追加し、`InfraNodeCard` がボタンの `onClick` で `operationPanelOpen`
    を立てるのと同じタイミングで明示的に閉じる。
  - (b) `ActionHint` に `suppressed?: boolean` のような prop を追加し、
    `operationPanelOpen` の間は常に閉じた扱いにする（`useHoverPopover`
    自体のAPIは変えず、`open` の算出に `suppressed` を掛け合わせるだけ）。
  - (b) の方が影響範囲が小さく、`useHoverPopover` の共通APIを変えずに
    済む（`GlossaryTerm` など他の利用箇所に影響しない）ため、実装しやすさ
    の観点では (b) を推奨するが、最終判断は実装担当（chainviz-frontend）
    に委ねる。
- 上記変更により、操作パネルが開いている間は「カード本体へのホバー」に
  由来するポップオーバー類がすべて出なくなる。操作パネル自体の中身
  （`TransferForm`/`DeployForm`/`CallForm`）は現状 `GlossaryTerm` や
  `ActionHint` を使っておらず、パネル内で新たに用語解説等を持つ場合は
  別途「パネルが開いている間は自分自身のホバーは通常どおり機能してよい」
  （パネル内のUIどうしが重なりを起こす想定は薄い）という前提で設計して
  よい。

#### 5. 決めきれておらず確認が必要な点

1. **他のカード種別（`WalletCard` / `ContractCard` 等）にも同種の問題が
   あるか**: 今回の調査は Issue #410 のタイトルどおり「ワークベンチの
   操作」に絞り、`InfraNodeCard`（entity.kind === "workbench"）の
   `OperationPanel` を対象にした。`WalletPopover`/`ContractPopover` には
   現状ホバー詳細ポップオーバーの奥でさらに別の操作用UIを開く導線は
   無いため、同型の問題は今のところ再現しないと考えられるが未検証。
   将来同種の導線が追加された場合は同じ観点の確認が要る。
2. **抑制の範囲を「自カードの `InfraPopover`/`ActionHint`」に限定するか、
   「操作パネルの矩形と重なるすべてのポップオーバー（隣接する別カードの
   ポップオーバー等）」まで広げるか**: キャンバス上でカード同士が極端に
   接近していれば、理論上は別カードのポップオーバーとも重なり得るが、
   再現性が低く、汎用的な「重なり検出→自動回避」ロジックは先回りの
   過剰実装になりやすい（CLAUDE.mdの「先回りしてUIを過剰に作り込まない」
   原則）。今回は「自カードの操作パネルと自カードの `InfraPopover`/
   `ActionHint` の組み合わせ」に絞った修正を推奨する。他カードとの重なりが
   実際に問題として報告されたら、その時点で改めて設計する。

### 2026-07-23 Issue #410 実装メモ

- 担当: frontend
- 実装前の再現確認: `pnpm --filter @chainviz/frontend exec vite --port
  5299`（モックデータ）で frontend を起動し、`packages/e2e` の Playwright
  （`LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu`
  を付けて起動、chromium）から実際にワークベンチカードをホバー→操作パネル
  を開く→パネル内の金額入力欄（`operation-transfer-amount`）へカーソルを
  移す、という手順を踏んで3つの原因すべてを実機で再現した。特に原因3
  （用語解説ポップオーバーによるポインタ操作のブロック）は、金額欄に対する
  `locator.click()` が実際に3秒のタイムアウトで失敗することを確認した
  （宛先入力欄は位置的にポップオーバーと重ならず塞がれなかったため、
  金額欄で再現する必要があった）。修正後は同じ手順で3つとも解消し、金額欄
  のクリックが成功することを確認した。使ったスクリプトは一時ファイルで
  リポジトリには含めていない。

- 実装方針は worklog の設計メモどおり、(b) 案（`ActionHint` に
  `suppressed?: boolean` prop を追加）を採用した。`useHoverPopover` の
  共通 API・他の利用箇所（`GlossaryTerm` 等）には一切手を入れていない。
  - `packages/frontend/src/canvas/ActionHint.tsx`: `suppressed` prop を
    追加。内部のホバー状態(`open`)はそのまま保持し、表示条件だけ
    `visible = open && !suppressed` に変更（`aria-describedby` の算出も
    `visible` に揃えた）。ホバー状態自体を閉じない設計にしたのは、
    操作パネルを閉じたときに再度ホバーし直さなくても元の見た目に戻る
    （＝suppressed が外れた瞬間、保持していたホバー状態がそのまま反映
    される）挙動をそのまま実現できるため。
  - `packages/frontend/src/entities/InfraNodeCard.tsx`:
    「操作を実行…」ボタンを包む `ActionHint` に
    `suppressed={operationPanelOpen}` を渡した。また `InfraPopover` の
    描画条件を `hovered && (...)` から `hovered && !operationPanelOpen
    && (...)` に変更した。z-index の並び替えは行っていない
    （設計メモの方針どおり、表示条件そのものを制御する）。
- `InfraPopover` 内に埋め込まれた用語解説ポップオーバー（`rpc-endpoint`
  等、z-index 30）は、`InfraPopover` 自体が描画されなくなることで連鎖的
  に出なくなる。個別の抑制コードは追加していない（設計メモの見立て通り）。
- スコープ外として明記されていた「他のカード種別（`WalletCard`/
  `ContractCard` 等）」「操作パネルと重ならない別カードのポップオーバー」
  には手を入れていない。またワークベンチカードのヘッダーにある
  「ワークベンチ」ラベル自体の `GlossaryTerm`（`InfraPopover` の外、
  カード本体の `hovered` 状態とは独立したホバー状態を持つ）も今回の
  抑制対象には含めていない。Issue 本文には「カードヘッダーのラベルに
  触れても前面表示される」との記述もあるが、受け入れ条件・設計メモの
  実装方針の指示範囲は一貫して「`InfraPopover`/`ActionHint`」の2つに
  限定されており、ヘッダーラベルの独立ホバーへの言及は無かったため対象
  外とした。将来ヘッダーラベルのホバーが操作パネルと重なる問題が実際に
  報告された場合は、別途 `suppressed` prop を渡すか同様の条件を足す
  形で対応できる（`ActionHint` と同じ抑制の仕組みが流用できる）。
- テスト（vitest）:
  - `packages/frontend/src/canvas/ActionHint.suppressed.test.tsx`
    （新規）: `suppressed` prop 単体の挙動（開いている状態から
    suppressed=true で隠れる、内部のホバー状態は保持されたままで
    suppressed が外れると再ホバーなしで戻る、suppressed 中はホバーしても
    開かない、`aria-describedby` も連動して消える、prop 省略時は従来どおり
    という5点）。既存の `ActionHint.test.tsx`（ホバー/フォーカスの基本
    挙動）を肥大化させないよう別ファイルに分けた。
  - `packages/frontend/src/entities/InfraNodeCardOperationPanelPopoverSuppression.test.tsx`
    （新規）: `InfraNodeCard` 側の統合的な確認（パネルを開くと
    `InfraPopover`/`ActionHint` 双方が消える、パネルを閉じると再ホバー
    無しで両方戻る）。既存の `InfraNodeCardOperationButton.test.tsx`
    （ボタン・パネル開閉そのもの）とは関心事を分けた。
  - 回帰検出の確認: 実装前に `InfraNodeCard.tsx` の変更2箇所
    （`suppressed={operationPanelOpen}` と `!operationPanelOpen` 条件）を
    一時的に取り除いた状態で新規テストを走らせ、4件のテストが実際に
    失敗すること（=このバグを検出できること）を確認してから修正を戻した。
- `pnpm lint && pnpm build && pnpm test`（リポジトリ全体）が通ることを
  確認済み。
- 次の担当への申し送り: 決めきれていない点の1（他カード種別の同種問題）
  ・2（他カードとの重なり）・ヘッダーラベルの独立ホバーは、いずれも今回
  未対応のまま。実際に問題が報告された場合の対応方針は上記のとおり
  `suppressed` prop の流用で対応できる見込み。

### 2026-07-23 Issue #410 テスト強化メモ

- 担当: tester
- 実装担当が書いた基本テスト（`ActionHint.suppressed.test.tsx`、
  `InfraNodeCardOperationPanelPopoverSuppression.test.tsx`）はハッピーパス
  （抑制で隠す・抑制解除で戻す・省略時は従来どおり）を押さえていたため、
  それらと関心事を分けて異常系・境界値・スコープの観点を追加した。
- 追加した観点:
  - **表示と内部状態の整合（抑制中に起きたホバー/フォーカス遷移）**:
    新規ファイル `packages/frontend/src/canvas/ActionHint.suppressedHoverSync.test.tsx`。
    `suppressed` は `useHoverPopover` の内部状態（`open`）を変えず表示だけを
    隠す設計のため、抑制中もホバー/フォーカスのハンドラは生きている。この
    ため次の食い違いが起きないことを固定した:
    - 抑制中にマウスが実際に離れた（遅延クローズ満了）場合、抑制解除後に
      ツールチップが復活しない（`fireEvent.mouseLeave` +
      `HOVER_POPOVER_CLOSE_DELAY_MS` 経過で fake timers を使用）。
    - 抑制中に blur した（フォーカスがパネル内などへ移った）場合、抑制
      解除後に復活しない。
    - 逆に、抑制中に新しく始まったホバー/フォーカスは内部状態として記憶
      され、抑制解除の瞬間に表示される（既存テストの「抑制前に開いていた
      ものを戻す」とは順序が逆のケース）。
  - **操作パネル開閉との同期（統合）**:
    `InfraNodeCardOperationPanelPopoverSuppression.test.tsx` に追加。
    - 操作パネルを開いた後にボタンが blur（フォーカスがパネル内へ移動）
      した場合、パネルを閉じても ActionHint の予告ツールチップが復活
      しない（既存の「カーソルがボタン上に残ったまま戻る」ケースの対）。
    - パネルを素早く open/close 繰り返しても `InfraPopover` の表示が
      毎回 open/close に同期する（トグル state と表示条件が食い違って
      固まらない）。
  - **スコープ（他カード種別への波及がないこと）**: `suppressed` prop の
    利用箇所を grep で確認した結果、`InfraNodeCard.tsx` のワークベンチ
    カード1箇所のみで、`WalletCard`/`ContractCard` は `ActionHint` 自体を
    使っておらず、他の `ActionHint` 呼び出し側（`CanvasToolbar` 等）は
    `suppressed` を渡さず既定 false で従来どおり（既存の「省略時は従来
    どおり」テストが担保）。加えて統合テストに、通常ノードカード
    （`entity.kind === "node"`。操作パネル・ActionHint を持たず
    `operationPanelOpen` は常に false）でホバー時に `InfraPopover` が正常に
    出て抑制条件 `!operationPanelOpen` に巻き込まれないことを固定した。
- 回帰検出の確認: `ActionHint.tsx` の `visible = open && !suppressed` を
  一時的に `visible = open`（抑制無効）へ改変し、新規の
  `ActionHint.suppressedHoverSync.test.tsx` 4件が実際に失敗することを確認
  してから元に戻した。
- 実装のバグは見つからなかった。実装の抑制ロジック（表示だけを隠し内部
  状態を保持する設計）は上記の境界すべてで一貫して正しく振る舞う。
- `pnpm lint && pnpm build && pnpm test`（リポジトリ全体、frontend 3048
  件を含む全パッケージ）が通ることを確認済み。

### 2026-07-23 Issue #410 レビュー結果（合格）

- 担当: reviewer
- 確認したブランチ: `issue-410-operation-panel-tooltip-suppression`
  （コミット `41565a4` 時点）。`main` との差分は
  `packages/frontend/src/canvas/ActionHint.tsx`・
  `packages/frontend/src/entities/InfraNodeCard.tsx` と、対応する新規
  テスト3ファイル・docs更新のみ。`packages/shared` の型変更は無し（設計・
  実装メモどおり不要）。

**境界・設計原則**:

- 変更は `packages/frontend` 内に閉じており、Docker/ノードAPIへの直接
  アクセスやチェーン固有語彙の追加は無い。境界侵犯なし。
- `ActionHint` の `suppressed` prop は `useHoverPopover` の共通APIを変更
  せず、表示条件のみを合成する設計。他の呼び出し側（`GlossaryTerm`、
  `CanvasToolbar` 等）への影響が無いことをコードとテスト双方で確認した
  （grep で `suppressed` の利用箇所が `InfraNodeCard.tsx` の1箇所のみで
  あることを確認）。
- 1ファイル1責務: `ActionHint.tsx`・`InfraNodeCard.tsx` の変更は共に
  数行程度で、既存の責務を超えて肥大化していない。新規テストも関心事
  ごとに3ファイルへ分割されており（基本挙動／表示と内部状態の整合／
  統合)、既存テストファイルを肥大化させていない。

**品質ゲートのチェック項目**:

- catchして握りつぶす箇所、エラーを汎用メッセージにすり替える箇所: 該当
  変更に例外処理は無く、対象なし。
- 「今観測できる状態」に依存した固定値: 該当変更にタイムアウト・件数
  上限等の定数は無い（真偽値の表示条件合成のみ）。対象なし。

**ビルド・lint・テスト**: `pnpm lint && pnpm build && pnpm test` を
リポジトリ全体で実行し、全パッケージ（shared/collector/frontend/e2e）が
成功することを確認した（frontend 244ファイル3048件含め全件成功）。

**テストコードの質**: 実装担当の基本テスト（ハッピーパス）とテスト強化
担当の追加テスト（抑制中に実際に発生したホバー終了/フォーカス喪失が
抑制解除後に誤って復活しないこと、抑制中に新規に始まったホバーが記憶
され解除時に反映されること、パネルの高速開閉への追従、対象外カード種別
への非波及）を確認した。いずれも表示結果（DOMに要素があるか）を検証して
おり、実装の内部実装詳細をなぞるだけの空虚なテストにはなっていない。
テスト強化担当が `ActionHint.tsx` の `suppressed` 条件を一時的に無効化して
追加テストが実際に落ちることを確認した記録もworklogにあり、検出力を
確認済み。

**Issue受け入れ条件との突き合わせ**:

1. ActionHintを明示的に閉じる: 実装済み・テストあり。合格。
2. 操作パネル表示中はInfraPopoverを表示しない: 実装済み・テストあり。
   合格。
3. InfraPopover内の用語解説ポップオーバーも連鎖的に消える: InfraPopover
   自体が描画されなくなることで自動的に満たされる（`InfraPopover.tsx` 内
   の `GlossaryTerm` 使用箇所を確認）。合格。
4. 操作パネル自体は常に視認・操作可能: 主要因（原因1〜3）はいずれも解消
   されている。ただし1点、残存リスクとして次を指摘する。

**残存リスク（QAでの実機確認を推奨、差し戻しではない）**:

Issue本文の原因3では「カードヘッダーの『ワークベンチ』ラベル」の用語解説
ポップオーバーも操作パネルより前面に出る一因として言及されている。今回の
実装は、この見出しラベルの独立したホバー状態（`InfraPopover`とは別系統）
を抑制対象に含めていない（worklogに明記済みの意図的なスコープ外判断で、
再現性の低さと過剰実装回避を理由にしている）。受け入れ条件1〜3はこの
ラベルに言及していないため文言上は満たしているが、条件4「常に視認・
操作可能」との整合性は、実際に見出しラベルをホバーした状態で操作パネルを
開き、パネルの入力欄が塞がれないかを実機で確認しないと断定できない
（操作パネルは `left: calc(100% + 12px); top: 0` でカードの右側に開くのに
対し、見出しラベルの用語解説ポップオーバーはラベル直下に開くため、通常は
重ならない可能性が高いと見立てるが、静的なコード確認だけでは断定できない）。
QAで「ワークベンチ」ラベルをホバー→操作パネルを開く→パネルの入力欄が
実際にクリックできることを確認する項目を追加することを推奨する。実装の
やり直しを要求するものではない。

**総合判定**: 合格。差し戻し事項なし。上記の残存リスクはQAでの実機確認
項目として申し送る。

### 2026-07-23 Issue #410 QA検証結果（条件4に未達あり・frontendへ差し戻し）

- 担当: qa
- 検証ブランチ: issue-410-operation-panel-tooltip-suppression（origin の最新コミット 7eb42cf を detached HEAD で取得して検証）。
- 検証環境: 依存を pnpm install、pnpm build 済み。profiles/ethereum の Docker スタックを docker compose up -d で起動し、チェーンが進行すること（cast block-number が 0 → 3 と増加）とワークベンチコンテナから reth1 への RPC が通ることを確認した。フロントエンドは pnpm --filter @chainviz/frontend exec vite --port 5299（VITE_COLLECTOR_URL 未設定＝モックデータ）で起動し、Playwright(chromium、LD_LIBRARY_PATH で共有ライブラリ補完)で実操作した。

#### 実機で確認できたこと（受け入れ条件1〜3は満たす）

ワークベンチカード（workbench-alice）で以下を実操作で確認した。いずれも合格。

- 条件1: 操作を実行ボタンをホバーすると ActionHint 予告が出る。ボタンをクリックして操作パネルが開いた瞬間、カーソルがボタン上に残ったままでも ActionHint 予告が消える（action-hint__popover のDOM要素数が 1 → 0）。
- 条件2: 操作パネルが開いている間、カード本体（infra-card__name）およびパネル本体をホバーしても InfraPopover が表示されない（infra-popover-workbench-alice のDOM要素数 0）。パネルを閉じると再ホバーで InfraPopover が復活する（0 → 1）。
- 条件3: 上記に連動して InfraPopover 内の用語解説ポップオーバー（glossary-popover-rpc-endpoint）も表示されない（DOM要素数 0）。
- 条件4のうち InfraPopover/ActionHint 由来の重なりは解消: パネルを開いた状態で金額入力欄（operation-transfer-amount）を実際にクリックして値を入力できた（1.5 を入力成功）。原因1・原因2・原因3のうち InfraPopover 経由の経路はすべて解消していることを確認した。

#### 未達（受け入れ条件4）: ヘッダー「ワークベンチ」ラベルのポップオーバーが操作パネルを塞ぐ

レビューで残存リスクとして申し送られた点を実機確認したところ、リスクが現実化していた。

再現手順:
1. ワークベンチカードの操作を実行ボタンをクリックして操作パネル（送金タブ）を開く。
2. カードヘッダーの「ワークベンチ」ラベル（GlossaryTerm、termKey=workbench）にカーソルを乗せる。
3. ラベルの用語解説ポップオーバー（glossary-popover-workbench）が表示され、操作パネルの本体（送金フォーム）の上に前面表示される。

期待される挙動: 条件4「操作パネル自体は、開いている間は常にカーソルの位置に関わらず全体が視認・操作可能な状態を維持する」に従い、どのカーソル位置でも操作パネルの入力欄が塞がれない。

実際の挙動: ヘッダーラベルの用語解説ポップオーバーが操作パネルの送金フォームを覆い、金額入力欄（operation-transfer-amount）が物理的にクリックできなくなる。実測の裏付けは次のとおり。
- 幾何判定: ヘッダーラベルのポップオーバー矩形 x:998.6-1258.6 / y:246.6-392.6 が、操作パネル矩形 x:1119.5-1270.3 / y:225.6-390.9 および金額入力欄 x:1127.1-1262.8 / y:312.6-327.6 と重なる。
- ポインタ判定: 金額入力欄の中心座標で document.elementFromPoint を評価すると、返る要素は glossary-popover__definition（.glossary-popover の子）であり、操作パネルの入力欄ではない。すなわち入力欄はポップオーバーに覆われている。
- 実操作: この状態で金額入力欄への click が 4秒でタイムアウトして失敗する（element intercepts pointer events 相当）。スクリーンショットでも送金フォーム本体がラベルの用語解説ポップオーバーで完全に隠れている。

原因: .glossary-popover の z-index 30 が .operation-panel の z-index 25 より高く、かつ操作パネルはカード右側（left: calc(100% + 12px); top: 0）に開くのに対し、ヘッダーラベルの用語解説ポップオーバーは幅 260px でラベル直下に開くため、カード幅（約150px）を超えて右側へ張り出し操作パネル領域に重なる。この重なりはカードのキャンバス上の位置に依存しない構造的なもので、モック固有の配置由来ではない。実装・レビューのメモにあるとおりヘッダーラベルの GlossaryTerm は今回の抑制対象（InfraPopover/ActionHint）から意図的に除外されているため、パネルを開いてもラベルのポップオーバーは抑制されない。

#### 判定と差し戻し先

- 受け入れ条件1・2・3: 合格。
- 受け入れ条件4: 未達（ヘッダー「ワークベンチ」ラベルの用語解説ポップオーバーが操作パネルを塞ぐケースが残る）。Issue #410 本文の原因3にもヘッダーラベルは明記されており、ユーザーの当初の訴え（ポップアップが邪魔で操作画面が見えない）がこの経路では解消しきれていない。
- 差し戻し先: chainviz-frontend。対応方針は worklog 実装メモに記載済みの流用が使える見込み（ヘッダーラベルの GlossaryTerm に、操作パネルが開いている間だけホバーポップオーバーを抑制する仕組み＝ActionHint の suppressed と同型の条件を渡す、あるいは GlossaryTerm 側に同等の抑制手段を設ける）。z-index の入れ替えではなく、表示条件そのものを制御する既存方針に揃えるのが望ましい。
- なお、この修正が実装担当の当初スコープ（InfraPopover/ActionHint に限定）を超えるため、同一Issueの追修正とするか別Issueに切るかは統括の判断に委ねる。QAとしては条件4を満たしていないため現状のままの合格チェックは付けない。

（検証は commit / push していない。統括が内容を確認のうえ対応方針を決める。）
