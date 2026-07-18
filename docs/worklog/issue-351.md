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
