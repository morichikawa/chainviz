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
