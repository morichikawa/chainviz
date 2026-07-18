### 2026-07-17 Issue #351 チェーンリボンの「親ブロック」行ホバー強調が実質使えない（起票・バックログ追記のレビュー）

- 担当: reviewer
- ブランチ: docs-issue-351-352-backlog
- 内容: Issue #313のUX設計中にchainviz-uxが実測で発見した既存不具合の
  Issue起票と、`docs/PLAN.md` バックログへの追記（docsのみの変更、
  Issue #352と同一コミット）のレビュー。
  - Issue #351本文と`docs/PLAN.md`追記の照合: 現象（ホバーが約200msで
    閉じてポップオーバーごと消える）・発見の経緯（Issue #313のUX設計中の
    実測）・Issue #298の「既知の残課題」で既に言及されていた問題の顕在化
    という位置づけ・着手時はchainviz-uxのUX設計を先行させるという方針の
    いずれも一致し、過不足なし
  - Issue本文が参照する事実の実在確認: `docs/worklog/issue-298.md` の
    「既知の残課題」（873行目〜）に、タイル→ポップオーバーの「親ブロック」
    行へのマウス移動経路で `mouseleave` により強調が解除される問題と
    `useHoverPopover` の200ms遅延クローズへの言及が実在する。
    `docs/worklog/issue-313.md` にも「別Issue候補として統括へ報告」の
    記録が実在し、経緯の記述は正確
  - `docs/PLAN.md` の追記フォーマットは直前の #346 項目と一貫
    （チェックボックス+6スペースインデントの補足+Issueリンク行）。
    配置（バックログ節末尾・「## 運用ルール」の直前）も適切
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過を確認
- 決定事項・注意点:
  - レビュー結果は合格。コード変更を伴わないためCLAUDE.mdの例外規定に
    基づきchainviz-qaは省略可
  - 実装着手は後日。着手時はまずchainviz-uxにUX設計を依頼する
    （遅延クローズの拡大か別トリガー方式かの判断が必要）
  - Issue #313側で解消見込みの「関連用語チップの生キー表示」問題は
    本Issueに含めず別Issue化もしない、という切り分けは妥当

### 2026-07-18 Issue #351 「親ブロック」行ホバー強調のUX設計

- 担当: ux
- ブランチ: issue-351-parent-block-hover-highlight
- 内容: 実際にアプリを動かして現象を実測で再現し、原因（描画構造の逸脱）を
  特定したうえでUX設計をまとめた。実装は frontend 担当へ引き継ぐ
  （このメモはUX設計のみ。実装コードは書いていない）

## 1. 実測で確認したこと（再現）

frontend をモックデータモード（`VITE_COLLECTOR_URL` 未設定、
`pnpm --filter @chainviz/frontend exec vite --port 5299`）で起動し、
Playwright（`packages/e2e` 同梱の chromium を
`chromium.launch({ channel: "chromium" })` +
`LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu` で
起動。issue-298.md §8 と同じ手順）で実マウス軌跡を再現して測定した。
測定に使った一時スクリプト（`packages/e2e/ux-351-probe*.mjs`）は削除済み。

1. **タイルを離れてから約205msでポップオーバーが閉じる**（`useHoverPopover`
   の 200ms 遅延クローズ + 処理遅れ。Issue 報告どおり）
2. **穏やかな移動（約750px/s）ではタイル中心 → ポップオーバー内の
   「親ブロック」行まで319msかかり、到達前に消える**（タイルは既定ズーム
   では約16×7pxと小さく、ポップオーバーは220×213px。行はその中段にある）
3. **素早く動かせば45msで到達でき、直前タイルの強調も点灯する**（機能
   自体は正しく動く）。しかし行の上で静止し続けても、タイル離脱起点から
   **217ms でポップオーバーごと閉じる**。つまりどう操作しても強調を
   200ms超は見られない（「実質使えない」の実態）
4. **二次バグ（固着）**: ポップオーバーが消える瞬間にマウスが「親ブロック」
   行の上にあると、行の `mouseleave` が発火しないまま unmount されるため
   `parentHighlightHash` がリセットされず、**直前タイルの強調枠が
   点いたまま残る**（スクリーンショットで確認。強調はそのタイルが表示窓
   から流れ出るまで残り続ける）
5. **対照実験: `WalletPopover` は同じ操作で閉じない**。カード → 隙間で
   100ms静止（クローズタイマー起動中）→ ポップオーバー進入 → 500ms静止
   でも開いたままで、完全に離れると閉じる。問題はリボン固有

## 2. 原因（構造の逸脱）

- `useHoverPopover` の開閉ハンドラはタイル div にしか付いておらず、
  ポップオーバー（body 直下への portal）はホバー維持に参加していない
- 一方、既存の他ポップオーバー全部（`InfraNodeCard` / `ContractCard` /
  `WalletCard` / `TxChip` / `GlossaryTerm` / `ActionHint`）は
  `{hovered && <Popover/>}` を**ホバー対象要素の React ツリー上の子**と
  して描いている。React はポータルへのイベント伝播を React ツリー基準で
  合成するため、portal 先（body 直下）のポップオーバーへマウスが入ると
  アンカーの `onMouseEnter` が発火してクローズタイマーが解除される。
  つまり「ポップオーバーもホバー領域の一部」という望ましい挙動が既存
  パターンでは無償で得られている（§1-5 の実測が裏付け）
- `ChainRibbonTileView` だけは Fragment でポップオーバーを**タイル div の
  兄弟**として描いており、この恩恵を受けていない。リボンが唯一の逸脱

## 3. UX設計（結論）: ポップオーバーをホバー領域に含める（既存パターンへの合流）

あるべき操作フロー:

1. タイルにホバー → ポップオーバー表示（現状どおり）
2. マウスをポップオーバーへ移動 → 途中の隙間（約8〜12px）は既存の
   200ms猶予で吸収され、**ポップオーバー上にいる間は開き続ける**
3. 「親ブロック」行にホバー → 直前タイルが強調され、**ホバーし続ける限り
   点灯し続ける**。行の parentHash 短縮表示と強調タイルのハッシュ表示が
   同じ値であることを、時間を気にせず見比べられる（学習上の要の回復）
4. 行から離れると強調が消え、ポップオーバー全体から離れると200ms後に
   閉じる
5. タイルまたはポップオーバーにホバーしている間、表示窓の前進（タイル列の
   スライド・退去）は停止する（読んでいる途中で対象が動かない・消えない）
6. 強調の寿命はポップオーバーの寿命を超えない（§1-4 の固着バグの解消）

推奨（必須ではない。採否は実装担当・統括の判断でよい）: 表示窓の最古
タイルの「親ブロック」行をホバーしたとき（親が画面外）は、左端の「⋯」
省略インジケータを同系統の強調で光らせる。「親は存在するが表示範囲より
前にある」ことが伝わる。文言追加は不要（既存ツールチップ「これより前の
ブロックは表示していません」で足りる）

## 4. 検討した代替案と却下理由

- **遅延クローズの拡大（200ms→600ms等）**: 構造を直さない対症療法。
  どれだけ延ばしても「読んでいる途中でタイマーが発火して閉じる」ことは
  変わらず（§1-3 の実測: ポップオーバー上に居てもタイマーは走り続ける）、
  読む速さの個人差も吸収できない。全ポップオーバー共通定数のため影響
  範囲も広い。却下
- **クリックで固定表示（ピン留め）に変更**: 読む時間は保証できるが、
  (a) 本アプリのポップオーバーは全てホバー駆動で統一されており1箇所だけ
  別作法になる、(b) キャンバス上のクリックは React Flow のドラッグ・
  選択と衝突しやすい、(c) 「腰を据えて読む場所」は Issue #313 の用語集
  パネルが担う設計で、ここで確認したいこと（親ハッシュ = 直前タイル）は
  数秒のホバー継続で足りる。却下（将来必要になれば別Issueで検討）
- **タイル側の当たり判定の拡張**: ポップオーバー内の行の操作を可能に
  しないため、本件の解決にならない。却下

採用理由の要約: 既存の5系統のポップオーバーが既に同じ挙動を持っており、
本設計は「リボンだけ挙動が違う」という不整合の解消そのもの。新しい操作
概念を導入せず、ユーザーが他カードで学んだ操作感がそのまま通用する。

## 5. 実装要件（frontend への引き継ぎ）

- **`packages/shared` の型変更なし**（chainviz-designer との調整は不要）。
  データフローの変更もなし。フロントの描画ツリーとホバー状態管理に閉じる
- 変更箇所の見立て（最終判断は実装担当の設計メモに委ねる）:
  1. `ChainRibbonTileView` の `{hovered && <ChainRibbonPopover/>}` を
     タイル div の内側（React ツリー上の子）へ移す（`WalletCard` 等と
     同じ配置）
  2. 表示窓の凍結条件の拡張: 現状は `hoveredBlockHash !== null` のみで、
     タイル → 隙間 → ポップオーバーの通過中に一瞬 null になり凍結が
     外れる（issue-298.md「既知の残課題」に記録済みの経路）。凍結条件に
     「いずれかのタイルのポップオーバーが開いている」を加える（タイル側の
     `hovered` を `ChainRibbonCard` へ通知する等）。これで issue-298 の
     既知の残課題も完全に解消する
  3. 強調の固着対策: `hovered` が false になったら `parentHighlightHash`
     をリセットする（ポップオーバー unmount 時の cleanup でも可）。
     仕様として「強調の寿命 ≤ ポップオーバーの寿命」を保証する
  4. （推奨・任意）親が表示窓外のときの「⋯」強調（§3 末尾）
- **変更しないもの**: `useHoverPopover` の 200ms（隙間通過の吸収にだけ
  使われる分には妥当な値。他の全ポップオーバーに影響するため触らない）、
  他カードのポップオーバー、`RibbonHoverContext` の公開API（凍結条件は
  リボンカード内で拡張できる）
- テスト観点（tester への手がかり）:
  - タイル離脱 → 200ms以内にポップオーバーへ進入、でポップオーバーが
    開き続けること（jsdom では React の enter/leave 合成の都合上、
    `fireEvent.mouseOver` + `relatedTarget` を使う必要があるかもしれない）
  - ポップオーバー滞在中に新ブロックが届いてもタイル列が前進しないこと
  - ポップオーバーが閉じたら親強調が残らないこと（§1-4 の固着バグの
    回帰テスト。修正前の状態で失敗することの確認を推奨）
  - e2e: 実マウス軌跡での「タイル → 親ブロック行 → 強調点灯の持続」確認。
    `chain-ribbon.spec.ts`（UI-B-05/06）への追加を検討し、Issue #346 で
    整えたホバー flakiness 対策の流儀に合わせる
- docs: `docs/ARCHITECTURE.md` §10.3 に「タイルのポップオーバーは
  ホバー領域の一部（React ツリー上の子として描く）」の旨を追記するとよい
  （sync-docs で確認）

## 6. 決めきれなかった点

- 「⋯」強調（§3 の推奨項目）の採否のみ。必須要件（§3 の 1〜6）だけで
  Issue の完了条件は満たせるため、実装担当がスコープ判断してよい

### 2026-07-18 Issue #351 実装設計メモ

- 担当: frontend
- ブランチ: issue-351-parent-block-hover-highlight

#### 事前調査（jsdom での挙動確認）

着手前に、jsdom + React Testing Library でのホバー合成イベントの挙動を
小さなスパイクコードで確認した（コミットには含めない一時コード）。

- `fireEvent.mouseOver(el, { relatedTarget })` /
  `fireEvent.mouseOut(el, { relatedTarget })`（bubbles: true）は、React の
  enter/leave 合成ロジック（target と relatedTarget の React ツリー上の
  共通祖先を計算し、その間の要素にだけ enter/leave を発火させる）を正しく
  再現する。portal で body 直下に描画された子要素でも、JSX 上で親要素の
  子として書かれていれば、その子要素へ「入る」ときに親要素の
  `onMouseEnter` が再発火することを確認した（スパイクテストで実証済み）
- 一方 `fireEvent.mouseEnter(el)` / `fireEvent.mouseLeave(el)`
  （`@testing-library/dom` の既定で bubbles: false）は、dispatch した
  その要素自身にしか作用せず、祖先方向への合成計算をしない。既存の
  `ChainRibbonCard.test.tsx` がこれまで通りに使ってきたのは、対象要素
  自身に対して直接 enter/leave するだけの単純な検証だったため問題なく
  動いていた（=祖先へのバブリングが要らないテストだった）
- 結論: 「ポップオーバーへ移動しても親要素の onMouseEnter が再発火し
  開いたままになる」ことを検証する回帰テストは `mouseOver`/`mouseOut` +
  `relatedTarget` を使う。逆に「行の mouseleave が発火しないまま
  ポップオーバーが閉じて強調が固着する」ことを再現する回帰テストは、
  むしろ祖先へ伝播「させない」直接 dispatch（既存パターン通りの
  `mouseEnter`/`mouseLeave`）で組める（行の leave を意図的に一度も
  発火させないことが再現の要のため）
- 上記の想定通り、修正前のコードに対して「固着」再現テストを実際に書いて
  失敗すること（`chain-ribbon-tile--highlight` が消えずに残ること）を
  確認してから実装に着手した

#### 実装方針

1. **描画構造の修正（本丸）**: `ChainRibbonCard.tsx` の
   `ChainRibbonTileView` で、外側の `Fragment` を廃止し、
   `{hovered && <ChainRibbonPopover ... />}` をタイル `div` の
   **内側の子**として描画する（`WalletCard`/`ContractCard`/`InfraNodeCard`
   と同じ配置）。`ChainRibbonPopover.tsx` 自体（`PopoverPortal` の
   呼び出し方）は変更不要（`PopoverPortal` は呼び出し側の JSX 上の位置に
   依存する設計だと docstring に明記されている）
2. **表示窓凍結条件の拡張**: `ChainRibbonCard` に
   `openPopoverHashes: ReadonlySet<string>` を state として持たせ、各
   `ChainRibbonTileView` が自分の `hovered`（`useHoverPopover` の
   `isOpen`）の変化を `useEffect` で親へ通知する
   （`onPopoverOpenChange(hash, isOpen)`、アンマウント時のクリーンアップで
   `false` も送る）。凍結条件を
   `hoveredBlockHash !== null || openPopoverHashes.size > 0` に拡張する。
   タイル→隙間→ポップオーバーの移動中、`hoveredBlockHash` は
   `onMouseLeave` で即座に null に戻る（ポップオーバー側の 200ms 猶予とは
   独立)ため、この拡張がないと隙間通過中に表示窓の凍結が一瞬外れる
   （issue-298 の既知の残課題）
3. **強調の固着対策**: `ChainRibbonPopover.tsx` に「親ブロック」行が
   現在ホバー中かどうかを追う `ref`（`parentHoveredRef`）を持たせ、行の
   `onMouseEnter`/`onMouseLeave` でこの ref を更新する。コンポーネントの
   unmount 時（`useEffect` のクリーンアップ）に `parentHoveredRef.current`
   が true のままなら `onParentHover(null)` を呼ぶ。これにより「行の
   mouseleave が発火しないまま popover が unmount される」経路でも
   確実に強調を解除する。`onParentHover`（`ChainRibbonCard` の
   `setParentHighlightHash`）は `useState` のセッター（同一性が安定）
   なので、`useEffect` の依存配列に含めても余分な再実行は起きない
4. **「⋯」強調（任意項目）**: 採用する。`parentHighlightHash` が
   現在の表示窓のどのタイルの hash とも一致しない（＝親が画面外）とき、
   `chain-ribbon-card__older` に強調クラスを付ける。追加ロジックは
   `ChainRibbonCard` 内の1つの真偽値導出のみで、既存の強調 CSS
   （`--accent` 系）を流用するだけなので実装コストが小さく、UX設計の
   推奨事項でもあるため採用する
5. テストは関心事ごとにファイルを分ける（1ファイル1責務。既存の
   `ChainRibbonCard.test.tsx` にこれ以上積み増さない）:
   - `ChainRibbonCard.test.tsx`: 既存の基本表示テストはそのまま
     （変更なし）
   - 新規 `ChainRibbonPopoverHoverBridge.test.tsx`:
     ポップオーバーへ移動しても開き続けること（`mouseOver`/`mouseOut` +
     `relatedTarget`）、表示窓凍結の隙間問題の解消、固着バグの回帰
     （新規）を担当
   - 「⋯」強調は既存 `ChainRibbonCard.test.tsx` に1ケース追加する程度で
     収まる規模のため、そちらに置く
6. e2e: 既存 `chain-ribbon.spec.ts`（Issue #298/#346）に「タイル →
   ポップオーバー → 親ブロック行 → 強調が持続する」ことを実マウス
   軌跡（`page.mouse.move` のステップ移動）で確認するケースを1つ追加する。
   対象タイルは表示窓内にあるため、Issue #346 の分類では「ビューポート内
   要素への実マウス hover」に該当し、実マウス経路を使う（画面外要素の
   `dispatchHover` 相当のフォールバックは不要）

#### 変更しないもの

- `useHoverPopover` の 200ms（worklog UX設計メモの通り）
- `packages/shared` の型定義
- 他カードのポップオーバー実装

### 2026-07-18 Issue #351 実装完了

- 担当: frontend
- ブランチ: issue-351-parent-block-hover-highlight

#### 実施内容

1. `packages/frontend/src/entities/ChainRibbonCard.tsx`:
   `ChainRibbonTileView` の外側 `Fragment` を廃止し、
   `{hovered && <ChainRibbonPopover />}` をタイル div の内側の子として
   描画するよう変更（本丸の修正）。加えて `ChainRibbonCard` に
   `openPopoverHashes` を追加し、表示窓の凍結条件を
   `hoveredBlockHash !== null || openPopoverHashes.size > 0` に拡張した
2. `packages/frontend/src/entities/ChainRibbonPopover.tsx`: 「親ブロック」
   行のホバー状態を `parentRowHoveredRef` で追跡し、ポップオーバーの
   unmount 時にホバー中のままなら `onParentHover(null)` を呼んで確実に
   強調を解除するようにした（固着バグの解消）
3. 「⋯」強調（任意項目）を採用した。`parentHighlightHash` が現在の表示窓
   のどのタイルの hash とも一致しないとき（＝親が画面外）、
   `chain-ribbon-card__older` に `--highlight` 修飾クラスを付け、
   `.chain-ribbon-tile--highlight` と同系統の見た目（`--accent`）にした
   （`packages/frontend/src/styles.css`）。実装コストが小さく UX設計の
   推奨事項でもあるため採用
4. テストは1ファイル1責務で分割し、新規
   `packages/frontend/src/entities/ChainRibbonPopoverHoverBridge.test.tsx`
   にポップオーバーのホバー領域化・表示窓凍結の拡張・固着バグ回帰・
   「⋯」強調の4観点をまとめた。既存 `ChainRibbonCard.test.tsx` は
   基本表示テストのみ残し、凍結解除のタイミングが変わった既存1ケース
   （`resumes tracking the latest tiles once the hover ends`）だけ、
   遅延クローズ猶予の経過待ちを追加する形で更新した
5. e2e: `packages/e2e/src/ui/chain-ribbon.spec.ts`（UI-B-05）に、実マウス
   （`page.mouse.move` の複数ステップ移動）でタイル→ポップオーバー→
   「親ブロック」行と辿り、遅延クローズ猶予（200ms）を超えて静止しても
   開いたまま・強調も持続することを確認するステップを追加した。対象タイル
   は初期表示窓内（React Flow 初期ビューポート内）にあるため、Issue #346
   の分類では「ビューポート内要素への実マウス hover」に該当し、実マウス
   経路（座標非依存の `dispatchHover` ではなく）を使った
   （`packages/e2e/SCENARIOS.md` の UI-B-05 記述も同期更新）
6. e2e 修正中に、既存の `[data-testid^="chain-ribbon-tile-"]` セレクタが
   tx件数バッジの testid（`chain-ribbon-tile-tx-<hash>`）にも接頭辞一致
   してしまい、tx を含むブロックが最新タイルのときに `.last()` がタイル
   本体ではなくバッジ要素を誤って返しうる潜在バグを発見した（実際に
   frontend をモックモードで起動した実ブラウザ検証中に踏んだ）。タイル
   本体だけが持つ `data-connected-to-previous` 属性で絞り込む
   `CHAIN_RIBBON_TILE_SELECTOR` を定義し、既存2箇所・新規1箇所すべての
   セレクタをこれに統一した（Issue #351 の直接のスコープではないが、
   同じファイル・同じ変更のついでに発見した実バグのため別コミットで修正）

#### 固着バグの再現確認（CLAUDE.md 運用ルール対応）

修正前のコードに対して、以下の手順で実際に再現することを確認してから
実装した:

1. 修正前のコードに、後の回帰テスト（固着バグのケース）と同内容の
   一時テスト（`fireEvent.mouseEnter`/`mouseLeave` を該当要素へ直接
   dispatch し、行自身の `mouseleave` を一度も発火させずにクローズ
   タイマーを満了させる）を書いて実行し、実際に失敗する
   （`chain-ribbon-tile--highlight` が消えずに残る）ことを確認した
2. 実装（構造修正 + `ChainRibbonPopover` の unmount 時クリーンアップ）を
   適用した後、同じテストが成功する（強調が確実に消える）ことを確認した
3. 同様に、本丸の「ポップオーバーが閉じてしまう」バグについても、
   `fireEvent.mouseOver`/`mouseOut` + `relatedTarget` を使う一時テストで
   修正前は失敗（4/5ケースが失敗）・修正後は全て成功することを確認した

一時テストは検証後に削除し、最終的な回帰テストは
`ChainRibbonPopoverHoverBridge.test.tsx` にまとめて残した。

#### 追加の実ブラウザ確認（jsdom を経由しない裏取り）

jsdom でのイベント合成は React の実装詳細に依存する部分があるため、
frontend をモックデータモード（`VITE_COLLECTOR_URL` 未設定の vite dev
server）で起動し、Playwright（`chromium.launch({ channel: "chromium" })` +
`LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu`。
issue-298.md §8 と同じ手順）の一時スクリプトで、実ブラウザ上でも
「タイル→ポップオーバー→親ブロック行、と実マウスで移動し、遅延クローズ
猶予（200ms）を大きく超える500ms静止してもポップオーバー・強調ともに
維持され、マウスを離すと両方消える」ことを確認した。一時スクリプトは
削除済み（コミットには含めていない）。

#### ビルド・テスト確認

`pnpm lint` / `pnpm build` / `pnpm test` をリポジトリ全体で実行し、
全パッケージ（shared 74・collector 1597・e2e 179・frontend 2630）が
通ることを確認した。

#### 次の担当への申し送り

- レビュー・QA未実施。`docs/PLAN.md` のチェックボックス更新もまだ
- e2e の新規ステップ（UI-B-05 拡張分）は実際のドッカースタックに対しては
  未実行（frontend engineerはDockerに触れない方針のため、モックモードでの
  実ブラウザ確認に留めた）。chainviz-qa による実スタックでの最終確認を
  推奨する
- `CHAIN_RIBBON_TILE_SELECTOR` のバグ修正は本Issueのスコープ外で発見した
  実バグの副次修正のため、レビュー時にコミット分割の妥当性を確認してほしい

### 2026-07-18 Issue #351 テスト強化メモ

- 担当: tester
- ブランチ: issue-351-parent-block-hover-highlight

#### 方針

実装担当が書いた基本テスト（`ChainRibbonCard.test.tsx` の基本表示・凍結・
cadence、`ChainRibbonPopoverHoverBridge.test.tsx` のホバー領域化・凍結拡張・
固着回帰・「⋯」強調のハッピーパス）を土台に、異常系・境界値を追加する。
新機能の実装はしない。既存テストは変更しない（追加のみ）。1ファイル1責務を
テストファイルにも適用する。

観点ごとの追加内容:

1. 固着バグ修正（`parentRowHoveredRef`）を、統合テストではなく
   `ChainRibbonPopover` 単体の「`onParentHover` ライフサイクル契約」として
   独立ファイルで検証する。通常のホバー解除以外の unmount 経路
   （コンポーネント削除そのもの）でも確実に強調解除されること、逆に
   ホバーしていない/既に解除済みのときに余分な `onParentHover(null)` を
   呼ばないことを直接確認する（新規 `ChainRibbonPopover.test.tsx`）。
2. ホバー領域の境界: 複数タイルを連続してホバーしたとき、直前タイルの
   強調が新しいタイルの親へ正しく移り、古い強調が残らないこと。カード
   全体が unmount される経路（ワールドステート更新でチェーンリボンが
   消える等）で例外が飛ばないこと（`ChainRibbonPopoverHoverBridge.test.tsx`
   に追加）。
3. 「⋯」強調の境界値: タイルが1件だけ（親が必然的に表示窓外）のとき点灯、
   親が表示窓内のタイルを指すときは点灯しないこと、ポップオーバーが行の
   mouseleave 未発火のまま閉じても「⋯」強調が固着しないこと
   （`ChainRibbonPopoverHoverBridge.test.tsx` に追加）。
4. e2e セレクタ修正（`CHAIN_RIBBON_TILE_SELECTOR`）の副作用確認は静的調査で
   実施。`chain-ribbon-tile` 系セレクタは `chain-ribbon.spec.ts` 内のみで
   使われ、UI-B-06 の強調タイル特定は `.chain-ribbon-tile--highlight`
   クラス経由（バッジには付かない）で曖昧一致の影響を受けないことを確認。
   他 spec への影響なし。

### 2026-07-18 Issue #351 静的レビュー

- 担当: reviewer
- ブランチ: issue-351-parent-block-hover-highlight
- 結果: **合格**（差し戻しなし）
- 確認した内容:
  1. **ポップオーバー子孫化の整合性**: `ChainRibbonTileView` の
     `{hovered && <ChainRibbonPopover/>}` がタイル div の内側にあり、
     `WalletCard`(237行)・`ContractCard`(257行)・`InfraNodeCard`(236行)等の
     既存パターンと同一配置であることを確認。実 DOM は従来どおり
     `PopoverPortal` で body 直下に出るため、React Flow のノードドラッグ
     （node wrapper の DOM に付く d3-drag）には影響しない（DOM 出力は
     変更前後で同一。変わったのは React ツリー上の位置＝合成イベントの
     伝播経路のみ）。変更が本丸の1点に絞られており最小
  2. **固着バグ修正のライフサイクル妥当性**: `parentRowHoveredRef` は
     行の enter/leave で同期更新され、`useEffect` のクリーンアップ
     （unmount 時実行）で hovered のままなら `onParentHover(null)` を
     1回だけ呼ぶ。依存配列 `[onParentHover]` は実運用では `useState` の
     セッター（同一性安定）なので mount/unmount の2回しか走らない。
     仮に同一性が変わる呼び出し側が現れた場合は旧クリーンアップが
     強調を一旦解除する保守的な挙動になり、「強調の寿命 ≤ ポップオーバー
     の寿命」の不変条件は破れない。unmount 中の親 state セッター呼び出しは
     React 18 では警告対象外で、tester が unmount 経路の無例外も検証済み
  3. **テストのmount順序問題（useLayoutEffect post-order）**: 実装側に
     本質的問題なしと判断。実アプリでは `hovered` の初期値が false のため
     ポップオーバーは必ず「タイル div の mount 完了後の再レンダー」で
     mount され、`anchorRef.current` は常に設定済み。さらに
     `PopoverPortal` は anchor が null の間 rAF ポーリングで再試行する
     防御があり、万一同一コミットで mount しても1フレーム表示が遅れる
     だけで壊れない（テストハーネスの1tick遅延 mount は jsdom + fake
     timers で rAF が回らないことへの対処であり、実装の欠陥の隠蔽では
     ない）
  4. **「⋯」強調のスコープ**: UX設計メモ §3 末尾の「推奨・任意」の範囲
     どおり（文言追加なし・既存ツールチップ流用・`parentHighlightHash`
     からの導出1つ）。CSS は既存の `--accent` 変数と、
     `.chain-ribbon-tile--highlight` の box-shadow と同色系
     （rgba(79,157,255,…)）を踏襲しており新規の色定義なし
  5. **e2eセレクタ修正の副作用**: `chain-ribbon-tile-` 接頭辞セレクタの
     使用箇所は `chain-ribbon.spec.ts` のみで、3箇所すべて
     `CHAIN_RIBBON_TILE_SELECTOR`（`data-connected-to-previous` で絞り込み）
     に統一済みであることを grep で再確認。UI-B-06 の強調タイル特定は
     クラスセレクタ経由で影響なし。tester の静的調査結果と一致
  6. **固定値の扱い**: e2e 新ステップの `waitForTimeout(500)` は「時間が
     経っても何も起きないこと」の検証であり auto-wait で代替できない。
     前提（`HOVER_POPOVER_CLOSE_DELAY_MS`=200ms は全ポップオーバー共通の
     慣習値で変更しない設計）がコードコメントと本 worklog の両方に明記
     されており、運用ルールを満たす
  7. **エラー握りつぶし・境界**: 新規の catch 節なし。frontend が
     Docker/ノード API に触れる変更なし。チェーン固有語彙の shared/
     frontend への漏れなし。`packages/shared` の型変更なし
  8. **docs 整合**: `docs/ARCHITECTURE.md` §10.3 への追記（ポップオーバー
     はホバー領域の一部・凍結条件の拡張）が実装と一致。
     `packages/e2e/SCENARIOS.md` の UI-B-05 追記も新ステップと一致。
     `docs/WORKLOG.md` の差分は #351 行の更新のみで、#346/#381 行の
     見かけの差は main 側先行分（merge-tree でコンフリクト 0 を確認）
  9. **コミット粒度**: 9コミット+docs 2コミットが関心事ごとに分割され、
     すべて Conventional Commits 形式。スコープ外で発見された e2e
     セレクタバグも別コミット（50e917d）に分離されており妥当
  10. **品質ゲート**: `pnpm lint` / `pnpm build` / `pnpm test` を
      リポジトリ全体で実行し全通過（shared 74 / collector 1597 /
      e2e 179 / frontend 2641）
- 注意点（差し戻し対象ではない申し送り）:
  - e2e UI-B-05 の「`.last()` で対象タイルを決めて hash を取り、直後に
    同じ locator を再解決して hover する」流れは、その間に新ブロックが
    着地すると `.last()` が別タイルを指す理論上の競合がある（今回の
    新ステップ固有ではなく既存ステップからの踏襲パターン）。flaky が
    観測されたら hash 確定後は `getByTestId` で固定する改善を検討
  - e2e 新ステップは実 Docker スタックでは未実行（実装担当の申し送り
    どおり）。chainviz-qa による実スタック確認を推奨

### 2026-07-18 Issue #351 実機QA検証（不合格・frontend へ差し戻し）

- 担当: qa
- ブランチ: issue-351-parent-block-hover-highlight
- 結果: **不合格**（e2e UI-B-05 が実 Docker スタックで決定的に失敗）
- 検証環境: 既存の `profiles/ethereum` スタック（稼働中・チェーン進行を
  `eth_blockNumber` で確認: 0x5a→0x5b）を再利用。他エージェントの e2e
  実行がないこと（`chainviz-test-e2e.lock` 不在・playwright プロセス
  不在）を確認してから実施。Playwright chromium は
  `LD_LIBRARY_PATH=/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu`
  を付与して起動。

#### 検証で確認できた「動く」挙動（要件1のうち合格分）

使い捨ての診断 spec を `packages/e2e/src/ui/` に一時作成して実マウス
（`page.mouse.move`）でタイル→ポップオーバー→「親ブロック」行と辿り、
DOM を直接ダンプして確認した（検証後に削除、コミットせず）。

- ポップオーバーは遅延クローズ猶予（200ms）を大きく超える 500ms 静止でも
  開いたまま維持される（本丸の修正は機能している）
- ホバー解除（`mouse.move(0,0)`）で強調・ポップオーバーが完全に消える。
  3サイクル連続で `chain-ribbon-tile--highlight` が 0 件・ポップオーバー
  0 件になり、固着（§1-4）は解消されている
- 親ブロックが表示窓外のとき「⋯」インジケータ（`chain-ribbon-card__older`）
  に `--highlight` が付くことを確認

#### 不具合: e2e UI-B-05 が決定的に失敗する（強調タイルが1でなく2）

- 事象: `pnpm --filter @chainviz/e2e exec playwright test --grep "UI-B-05"`
  を3回実行し、3回とも `chain-ribbon.spec.ts:137`
  `expect(page.locator(".chain-ribbon-tile--highlight")).toHaveCount(1)` が
  `Received: 2`（14回リトライしても安定して2要素）で失敗する。
- 原因: `chain-ribbon-tile--highlight` は
  `isParentHighlighted || isReverseHighlighted` の2条件で付く
  （`ChainRibbonCard.tsx` 56行・74行）。`isReverseHighlighted =
  hoveredBlockHash === block.hash` はホバー中タイル自身を強調する。今回の
  修正でポップオーバーがタイル div の React ツリー上の子になったため、
  ポップオーバーへマウスを移してもタイル div の `onMouseLeave` が発火せず
  `hoveredBlockHash` はホバー中タイルのまま保持される。その結果、
  「親ブロック」行ホバー時には
  「ホバー中タイル（reverse 強調）＋ 親タイル（parent 強調）」の
  2タイルが同時に `--highlight` になる。親タイルが表示窓内にある通常ケース
  では強調タイルは2、親が表示窓外のケースでは1（＋「⋯」強調）となり、
  UI-B-05 の `toHaveCount(1)` は親が窓内のとき必ず失敗し、窓外のときのみ
  通る（診断 probe では親が窓外で1、実 UI-B-05 では親が窓内で2）。
  したがって値が実行時の表示窓位置に依存する不安定なアサーションになって
  いる。
- この「2タイル強調」はコンポーネント自身のユニットテストが前提とする
  挙動と一致する。`ChainRibbonPopoverHoverBridge.test.tsx` の
  「does not highlight the older indicator when the hovered parent is an
  in-window tile」（305〜325行）は、タイル `0xc` の `mouseLeave` を発火
  させずに親行をホバーしており（＝`hoveredBlockHash` は `0xc` のまま）、
  親タイル `0xp` が光ること・「⋯」が光らないことだけを検証し、強調タイルの
  総数は見ていない。ユニットでは `0xc` と `0xp` の2タイルが強調される状態を
  許容している。つまり本丸の実装挙動としては「ホバー中タイル＋親タイル＝2」が
  想定挙動であり、e2e UI-B-05 の `toHaveCount(1)` だけが実装の契約と矛盾
  している（実装担当の申し送りどおり e2e 新ステップは実 Docker で未実行
  だったため、この矛盾が検出されずに残った）。

#### 完了条件との照合

- 要件1（実マウスでの200ms超維持・タイル→ポップオーバー移動で閉じない・
  解除で固着しない・「⋯」強調）は満たしている
- 要件2（UI-B-05 を実際に実行して通過）を**満たしていない**

#### 差し戻し先と対応方針（案）

- 差し戻し先: chainviz-frontend
- 対応方針（最終判断は frontend/UX）: e2e UI-B-05 の強調タイル数の
  アサーションを実装の契約に合わせて修正する。ホバー中タイルが自身の
  強調を保持する以上、`toHaveCount(1)` は不適切。親が表示窓内のケースを
  検証したいなら、総数ではなく「対象の親タイル（hash 指定）が
  `--highlight` を持つこと」を `getByTestId` 等で直接検証する形にすると、
  表示窓位置に依存せず安定する。あわせて、ホバー中タイルと親タイルが
  同一スタイルで二重に光ることが「親タイルを見分ける」という UX 目的を
  損なわないかは UX 観点の判断が必要（損なうなら product 側で
  ポップオーバー滞在中の reverse 強調の扱いを見直す）。いずれの方針でも
  修正後に実 Docker スタックで UI-B-05 を実際に通す。

