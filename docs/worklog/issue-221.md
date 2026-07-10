### 2026-07-10 Issue #221 ノード等のホバーポップオーバーが、カードから離れる途中で消えて中の用語にホバーできない

- 担当: frontend
- ブランチ: issue-221-popover-hover-gap

#### 設計メモ（着手前）

**再現確認の方法について**: このサンドボックス環境には Chromium 実行に必要な
共有ライブラリ（libnspr4/libnss3/libasound2 等）がシステムにインストールされて
おらず、`sudo` も使えないため `playwright install-deps` が使えない。
`apt-get download`（root不要）で該当 `.deb` を取得し `dpkg -x` でユーザー
ディレクトリに展開、`LD_LIBRARY_PATH` で読ませることで実 Chromium
(headless) を起動できた。これで `vite dev`（モッククライアント）に対し
実際にマウスカーソルを座標移動させ、カードの隙間を通過させる再現手順を
実行した。

**根本原因の実測結果**: InfraNodeCard で実際に、カード中心→ポップオーバー
内へ 20 ステップに分けてマウス座標を移動させたところ、移動完了後に
`.infra-popover` の DOM 要素数が 0 になることを確認した（修正前に再現）。
`mouseenter`/`mouseleave` は子孫要素への出入りでは発火しない仕様のため、
ポップオーバー自体が対象要素の DOM 子孫である限り本来は問題にならない
はずだが、隙間（`top: calc(100% + Npx)` で意図的に空けている領域）は
カード・ポップオーバーどちらの描画ボックスにも属さないため、そこを通過
した瞬間に一度 `mouseleave` が発火して `hovered=false` になり、React が
即座にポップオーバーの DOM を除去してしまう。次の `mousemove` がポップ
オーバーがあった位置に到達しても、その時点で該当 DOM 要素は既に存在しない
ため `mouseenter` が再発火する機会がない、というのが実測できた根本原因
（Issue本文の推測と一致）。

**対象箇所の洗い出し**: `styles.css` の `top: calc(100% + Npx)` /
`left: calc(100% + Npx)` パターンを全数確認した結果、以下 6 箇所が該当する
（Issue本文の「4箇所」時点から他Issueの実装で増えている）。

| CSS クラス | 対応コンポーネント | 開閉トリガー |
|---|---|---|
| `.infra-popover` | `InfraNodeCard.tsx` | mouse only |
| `.action-hint__popover` | `ActionHint.tsx`（`canvas/`） | mouse + focus/blur |
| `.contract-activity-chip__popover` | `ContractCard.tsx` の `ActivityChip` | mouse only |
| `.glossary-popover` | `GlossaryTerm.tsx` | mouse + focus/blur |
| `.tx-lifecycle-popover` | `WalletCard.tsx` の `TxChip`、`WalletPopover.tsx` の `WalletPopoverTxItem` | mouse + focus/blur |
| `.operation-panel` | `OperationPanel.tsx` | 対象外。クリックでの開閉トグルであり
ホバーで開閉しないため、本Issueの隙間問題は該当しない（確認のみ、変更なし） |

`WalletCard.tsx`（カード本体、`WalletPopover` を開く方）・`ContractCard.tsx`
（カード本体、`ContractPopover` を開く方）も同じ `.infra-popover` 相当の
隙間（`InfraPopover`/`ContractPopover`/`WalletPopover` はいずれも
`.infra-popover` クラスを共有）を使っており、同じ根本原因が当てはまる。

合計 8 箇所のコンポーネントが同一パターン
（`useState` + `onMouseEnter`/`onMouseLeave`（一部 `onFocus`/`onBlur` も）+
条件付きレンダリングでポップオーバーを出し入れ）を持っており、Issue本文が
挙げる通り重複したロジックになっている。

**採用する修正方針**: Issue本文が挙げる2案（隙間を無くす／当たり判定を
繋ぐ、または非表示までの短い遅延）のうち、「非表示までの短い遅延」を
全箇所共通で採用する。

- 「隙間を無くす／繋ぐ」案は、6箇所それぞれで CSS 構造を「当たり判定用の
  透明な橋渡し要素」＋「見た目用の内側ボックス（余白を付け直す）」の二重
  構造に組み替える必要があり、見た目（影・角丸・背景色が隙間部分にも
  掛かってしまう等）の副作用を避けるために JSX 側にもラッパー要素の追加が
  要る。カード種別ごとに DOM 構造が微妙に異なるため、共通化してもCSS側の
  変更量・見た目デグレのリスクが大きい
- 「短い遅延」案は、既存の「`useState` の bool ひとつ + mouseenter/leave」
  という実装パターンを崩さずに、開閉の状態管理だけをカスタムフックに
  差し替えるだけで済む。CSS・DOM構造は一切変更不要なため、見た目のデグレ
  リスクが無く、8箇所への適用も機械的にできる
- 遅延を入れても、カードから完全に離れて別の操作をするケースでは
  ユーザーが体感する遅延は数百ms未満に収まる（隙間の通過時間よりは長いが、
  UIの反応が鈍いと感じるほどではない一般的なドロップダウン/ツールチップの
  慣習的な値、200ms）ため UX 上の悪化は小さいと判断した

これを踏まえ、`packages/frontend/src/interaction/useHoverPopover.ts` に
共通フックを新設する（`docs/ARCHITECTURE.md` §1 のフォルダ一覧に
`interaction/` を追記する）。既存の `entities/useNewArrivalHighlight.ts`
（時間経過に依存するUIロジックをカスタムフックに切り出す）と同じ設計
パターンに合わせ、固定値はエクスポートした定数
（`HOVER_POPOVER_CLOSE_DELAY_MS`）として持つ。

```ts
function useHoverPopover(closeDelayMs = HOVER_POPOVER_CLOSE_DELAY_MS): {
  isOpen: boolean;
  onMouseEnter: () => void; // 即座に開く。保留中のクローズタイマーは破棄
  onMouseLeave: () => void; // すぐには閉じず、closeDelayMs 後に閉じるタイマーを積む
  onFocus: () => void;      // 即座に開く（キーボード操作。隙間を経由しないため遅延不要）
  onBlur: () => void;       // 即座に閉じる（フォーカスは連続的に移らないため遅延不要）
}
```

各コンポーネントは `useState` 直書きの代わりにこのフックを呼び、返って
きたハンドラを既存の `onMouseEnter`/`onMouseLeave`（元々 `onFocus`/
`onBlur` を持っていた箇所はそれも）にそのまま割り当てる。`onFocus`/
`onBlur` は、元々持っていなかったコンポーネント（`InfraNodeCard`/
`ContractCard`/`WalletCard` のカード本体）には追加しない
（React の合成イベントでは `focus`/`blur` がバブルするため、カード本体に
迂闊に付けると子要素のボタン等へのフォーカスでカード側ポップオーバーが
意図せず開閉してしまう回帰を招くため）。

`.operation-panel`（`OperationPanel.tsx`）はクリックトグルであり本Issueの
対象外のため変更しない。

#### 実装内容

**再現確認（修正前）**: このサンドボックスには実 Chromium 実行に必要な
共有ライブラリが無く `sudo` も使えなかったため、`apt-get download`（root不要）
で `libnspr4`/`libnss3`/`libasound2t64` の `.deb` を取得し `dpkg -x` で
ユーザーディレクトリに展開、`LD_LIBRARY_PATH` に加えることで headless
Chromium を起動できるようにした。`vite dev`（モッククライアント）に対し、
Playwright でカード中心からポップオーバー内へマウス座標を20ステップに
分けて移動させたところ、修正前は移動完了後に `.infra-popover` の DOM
要素数が 0 になることを確認した（実際の再現）。

**実装**:
- `packages/frontend/src/interaction/useHoverPopover.ts` を新設。
  設計メモどおり `isOpen`/`onMouseEnter`/`onMouseLeave`/`onFocus`/`onBlur`
  を返す。`onMouseLeave` だけが `HOVER_POPOVER_CLOSE_DELAY_MS`（200ms）の
  遅延クローズを行い、その間に再度 `onMouseEnter`/`onFocus` が呼ばれれば
  保留中のクローズタイマーを破棄して開いたままにする
- 対象8箇所すべてに適用: `InfraNodeCard.tsx`（カード本体）、
  `ContractCard.tsx`（カード本体・`ActivityChip`）、`WalletCard.tsx`
  （カード本体・`TxChip`）、`WalletPopover.tsx`（`WalletPopoverTxItem`）、
  `GlossaryTerm.tsx`、`ActionHint.tsx`。`onFocus`/`onBlur` は元々持って
  いたコンポーネントにのみ渡す（カード本体3箇所には追加しない。合成
  イベントの `focus`/`blur` はバブルするため、迂闊に付けると子要素の
  ボタン等へのフォーカスでカード側ポップオーバーが誤って開閉する回帰に
  なるため）
- `docs/ARCHITECTURE.md` §1 のフォルダ一覧に `interaction/` を追記
- `.operation-panel`（`OperationPanel.tsx`）はクリックトグルのため対象外
  （設計メモどおり、変更なし）

**再現確認（修正後）**: 同じ Playwright スクリプトで、InfraNodeCard /
WalletCard / ContractCard いずれも「カードからポップオーバーへ向けて
カーソルを移動させても、移動完了後にポップオーバーが存在し続ける」ことを
確認した。さらに InfraPopover 内の `GlossaryTerm`（例:
「ポート」ラベル）へカーソルを移動させ、そのネストした glossary-popover が
開き、かつ外側の infra-popover も閉じないままであることを確認した
（用語にホバーできるという Issue の期待挙動を満たす）。

**既存テストへの影響**: `onMouseLeave` で即座に閉じることを前提にしていた
既存テスト9件（`ActionHint.test.tsx`、`CanvasToolbar.test.tsx`、
`GlossaryTerm.test.tsx`、`GlossaryTerm.testid.test.tsx`、
`ContractCard.test.tsx`（2件）、`txLifecyclePopoverHover.test.tsx`（3件））
を、`vi.useFakeTimers()` + `vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS)`
で遅延を経過させてから閉じたことを確認する形に更新した。あわせて
「mouseleave 直後はまだ開いたままである」ことも各テストでアサートし、
今回の修正が退行した場合に検知できるようにした。

**新規テスト**: `packages/frontend/src/interaction/useHoverPopover.test.ts`
に、開閉タイミング・遅延中の再エントリでのキャンセル・focus/blur の即時性・
アンマウント時のタイマー掃除などをカバーする11ケースを追加。

**確認したこと**:
- `pnpm build`（全パッケージ）
- `pnpm lint`（ルート）
- `pnpm --filter @chainviz/frontend exec vitest run`（106ファイル/1617件、
  全パス）
- `pnpm --filter @chainviz/shared test` / `pnpm --filter @chainviz/collector test`
  （本Issueでは変更していないが影響がないことの確認として実行、全パス）
- 上記の実ブラウザでの手動再現確認（修正前に再現・修正後に再現しないこと
  の両方）

**次の担当が知っておくべきこと**:
- このサンドボックス環境でPlaywrightの実Chromiumを使うには、`sudo` が
  使えなくても `apt-get download <pkg>` で `.deb` を取得し `dpkg -x` で
  展開、`LD_LIBRARY_PATH` に加えれば動く（`libnspr4`/`libnss3`/
  `libasound2t64` が不足していた）。恒久的な環境整備ではなく都度の
  ワークアラウンドなので、次に同様の検証が必要になった場合の参考として
  記録しておく
- 遅延時間 `HOVER_POPOVER_CLOSE_DELAY_MS`（200ms）は隙間の物理的な幅
  （数px〜十数px）に対して余裕を持たせた慣習的な値であり、隙間の
  ピクセル数から動的に導出しているわけではない。将来 CSS 側で隙間の
  サイズを大きく変える場合はこの値の妥当性も見直すこと

#### レビュー記録（chainviz-reviewer、2026-07-10）

静的レビューの結果、**合格**。確認した内容:

- `useHoverPopover.ts` の遅延クローズロジック: `onMouseLeave` のみ
  200ms の遅延タイマーを積み、`onMouseEnter`/`onFocus` で保留中の
  タイマーを破棄して開いたままにする実装が正しい。アンマウント時は
  `useEffect` のクリーンアップでタイマーを掃除しており、unmount 後の
  setState は起きない。重複した `onMouseLeave` でもタイマーは常に
  1本に保たれる（張り直し）
- 適用箇所の全数確認: `styles.css` の `calc(100% + Npx)` パターンを
  grep した結果は6箇所で、worklog の表と一致。うち `.operation-panel`
  はクリックトグルのため対象外という判断も実装（`InfraNodeCard.tsx` の
  `operationPanelOpen`）と一致。コンポーネント単位では8箇所すべてに
  フックが適用されている。エッジ用ポップオーバー
  （deploy/peer/internal-link）は Canvas 側がホバー状態を注入する
  別機構であり、本 Issue の隙間問題（自要素の mouseleave で自分の
  ポップオーバー DOM が消える）の構造に該当しないため対象外で妥当
- `onFocus`/`onBlur` は元々持っていた4箇所（TxChip、
  WalletPopoverTxItem、GlossaryTerm、ActionHint）にのみ渡し、カード
  本体3箇所には追加していないことを diff で確認。バブルによる誤開閉を
  避ける設計メモどおり
- 固定値 200ms: 前提条件（隙間は数px〜十数px で通過時間は遅延より
  十分短い）がコード内コメントと worklog の両方に明記されており、
  CLAUDE.md の運用ルールを満たす
- テストの質: 更新された既存テスト9件はいずれも「mouseleave 直後は
  開いたまま」を先にアサートしてから遅延経過後のクローズを確認して
  おり、即時クローズに退行した場合に検知できる。新規の
  `useHoverPopover.test.ts`（11件）は遅延中の再エントリでのキャンセル、
  blur とタイマーの競合、アンマウント時の掃除、カスタム遅延、重複
  mouseleave といった異常系・境界値を押さえている。mouseLeave を使う
  テストファイルにフェイクタイマー未使用のものが残っていないことも
  grep で確認した
- `pnpm build` / `pnpm lint` / `pnpm test`（frontend 106ファイル/
  1617件を含む全パッケージ）がすべて通ることを確認
- docs: `docs/PLAN.md` のチェック、`docs/WORKLOG.md` の索引行、
  `docs/ARCHITECTURE.md` §1 への `interaction/` 追記がいずれも実装と
  整合
- コミット粒度: feat（フック新設+ARCHITECTURE追記）/ fix（8箇所への
  適用+既存テスト更新）/ docs（worklog）の3コミットで関心事が
  分離されている
- ブランチは main より古い 26f4273 起点だが、`git merge-tree` で
  main との合流に衝突が無いことを確認済み（マージ時の追加作業は不要）

#### QA検証記録（chainviz-qa、2026-07-11）

実ブラウザ（Playwright + Chromium headless）で、実コンポーネント・実CSS
（`styles.css`）・実フック（`useHoverPopover`）を使ってカードからポップ
オーバーへカーソルを移動させる元Issueの再現手順を実行し、**完了条件を
満たしていることを確認した（合格）**。

**検証環境の準備**: このサンドボックスには Chromium 実行に必要な共有
ライブラリ（libnspr4/libnss3/libnssutil3/libasound）が無いため、worklog
記載のワークアラウンドどおり `apt-get download`（root不要）で `.deb` を
取得し `dpkg -x` でユーザーディレクトリへ展開、`LD_LIBRARY_PATH` に加えて
headless Chromium を起動した。

**検証方法**: 一時的な検証ハーネス（vite dev で配信、検証後に削除）に、
実コンポーネントを実フックで結線して配置した。
- InfraNodeCard 相当: `div.infra-card`（実フック）＋実 `InfraPopover`
  （内部に実 `GlossaryTerm`「ポートマッピング」）
- ContractCard の ActivityChip 相当: `span.contract-activity-chip`
  ＋ `.contract-activity-chip__popover`（内部に実 `GlossaryTerm`「ABI」）
- WalletCard の TxChip 相当: `span.wallet-tx-chip`（実フック）＋実
  `TxLifecyclePopover`（内部に実 `GlossaryTerm`「署名」）

各トリガの中心から、その直下のポップオーバー中心へ 24 ステップでマウス
座標を移動させ（トリガ下端とポップオーバー上端の間＝隙間帯を必ず通過
する経路）、移動中・移動後のポップオーバー DOM 数を計測した。

**結果（全12項目パス）**:
1. InfraNodeCard: ホバーでポップオーバーが開く／隙間帯を通過中も消えず
   （隙間通過中の最小 DOM 数 = 1）／移動後も存在する。さらに内部の
   `GlossaryTerm`「ポートマッピング」へカーソルを合わせるとネストした
   glossary-popover が開き、かつ外側の infra-popover も開いたまま
   （＝元Issue「ポップオーバー内の用語にカーソルを合わせられない」の
   解消を確認）。
2. ContractCard の ActivityChip: 同様に隙間を跨いでも消えず、内部の
   `GlossaryTerm`「ABI」に到達できる。
3. WalletCard の TxChip: 同様に隙間を跨いでも消えず、内部の
   `GlossaryTerm`「署名」に到達できる。
4. 回帰確認: カードから完全に離れた直後はポップオーバーが残っており
   （遅延クローズ）、約200ms 後に消える（`InfraNodeCard` で確認）。
   通常操作を阻害する違和感は無い。

**ネガティブコントロール（この検証が元不具合を検出できることの確認）**:
同じハーネスで遅延を 0ms（＝修正前の即時クローズ相当）にして同一の
隙間跨ぎを実行すると、InfraNodeCard・ContractChip いずれも移動後に
ポップオーバー DOM 数が 0 になり、元の不具合が再現した。修正
（200ms 遅延）を入れた状態ではこれが起きないことを対比で確認した。

**あわせて確認**: `useHoverPopover.test.ts`（11件）がパスすること、実行中の
ページに JavaScript エラーが出ないこと。

**判定**: 完了条件「元Issue（ポップオーバー内の用語にカーソルを合わせ
られない）が実際に解消されていること」を満たす。差し戻しなし。

**注記**: 検証に使った一時ハーネス（`packages/frontend/qa-hover-harness.html`
・`src/qa-hover-harness.tsx`）と Playwright スクリプト
（`packages/e2e/qa-hover-*.mjs`）は検証後に削除済み。次回同様の UI 検証を
行う際は上記のライブラリ・ワークアラウンドを再利用すればよい。
