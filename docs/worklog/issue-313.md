# Issue #313 用語集パネル(サイドパネルでの全用語一覧・検索・ジャンプ)が未実装

### 2026-07-17 Issue #313 用語集パネルの UX 設計

- 担当: ux
- ブランチ: issue-313-glossary-panel
- 内容: ユーザーフィードバック「チェーンリボンのタイルホバーで出る『ブロック』
  用語の定義文が他の用語より長く読み切れない」に対する UX 設計。
  `docs/CONCEPT.md`「用語解説（グロッサリー）機能」の「用語集パネル」構想を
  具体化する。実装は frontend 担当へ引き継ぐ

## 1. 実際に動かして確認したこと

frontend をモックデータモード（`VITE_COLLECTOR_URL` 未設定、
`pnpm --filter @chainviz/frontend dev` port 5199）で起動し、Playwright
（`packages/e2e` 同梱の chromium。ヘッドレス実行に必要な共有ライブラリは
`/home/zoe/chrome-deps/root/usr/lib/x86_64-linux-gnu` を `LD_LIBRARY_PATH`
で解決。issue-125.md 記載の既知の回避策）で操作・実測した。

1. **「ブロック」の用語ポップオーバーは 260px 幅 × 約 242px 高**（実測。
   リボン見出し「チェーン」= termKey `block` のホバーで再現）。定義文は
   小さめのフォントで約 10 行の密なテキストになり、ホバーを維持したまま
   読み続ける必要がある。「読み切れない」の実態は「読む場所がツールチップ
   （ホバー維持中だけ存在する場所）しか無い」こと
2. **報告経路（タイル → タイルのポップオーバー内の『ブロック番号』用語）は
   さらに壊れやすい**。実際のマウス軌跡（`mouse.move` を小刻みに実行）で
   タイルからポップオーバー内へ移動すると、タイルの `mouseleave` から約
   200ms（`useHoverPopover` の遅延クローズ）でポップオーバー自体が閉じ、
   中の用語解説ごと消えることを実測した（`popover still open after moving
   into it: false`）。これは issue-298.md に「既知の残課題」として記録済みの
   構造（リボンのポップオーバーはタイルの React ツリー上の子ではなく兄弟
   なので、ポップオーバー上のホバーがタイルのホバー状態を維持しない）の
   顕在化で、ポップオーバー内の「親ブロック」行ホバーにも同じ制約がある
3. **関連用語が生キーのまま表示され、リンク風なのに辿れない**。ポップ
   オーバー末尾に `transaction, mempool, gossip` のような YAML キーが
   リンク色（青）で並ぶが、クリックしても何も起きない（`GlossaryTerm.tsx`
   は `relatedTerms.join(", ")` を出しているだけ）。「リンクに見えるのに
   死んでいる」アフォーダンスの不一致
4. **用語自体もクリックが空振りする**。`GlossaryTerm` のアンカーは
   `role="button"` `tabIndex={0}` を持つのに、クリック・Enter で何も
   起きない
5. 補足: 用語を一覧・検索できる入口は現状どこにも無い（画面に登場した
   用語しか学べない）。用語データは 37 語（a-infra 9 / b-network 8 /
   c-transaction 15 / d-internal 5。`layer` 値は `a-infra` 等の4種のみ）

## 2. 何が伝わっていないか（課題の言語化）

1. **長文の定義を「ホバー維持中だけ存在する場所」で読ませている**。機能は
   動くが、腰を据えて読む場所が無い。定義が充実するほど（Issue #298 で
   `block` が長くなったように）この矛盾は悪化する
2. **関連用語・用語一覧という「学びを広げる導線」が存在しない**。関連用語は
   生キー表示で辿れず、全用語を眺める・検索する手段も無い
3. **クリックという自然な次の操作が用意されていない**。「もっと読みたい」と
   思った瞬間の受け皿が無い（role="button" が期待だけ作っている）

## 3. UX 設計

### 3.1 汎用サイドパネル機構（Issue #321）への相乗り

- `packages/frontend/src/side-panel/sidePanelView.ts` の `SidePanelView` に
  `{ kind: "glossary"; termKey?: string }` を追加する（同ファイルの docstring
  および `docs/ARCHITECTURE.md` §12.2 が既に想定しているとおり。
  **`packages/shared` の型変更は無し**。フロント内部の表示状態のみ）
- シェル（`SidePanel.tsx`: ヘッダ・×ボタン・Esc クローズ・本文スクロール・
  右ドック固定幅 400px 目安）と状態管理（`SidePanelContext.tsx`）は
  そのまま使う。`SidePanelHost.tsx` に `kind: "glossary"` の case を足す
- 同時に開けるパネルは 1 枚（排他）の既存仕様に従う。コントラクトソース
  表示中に用語をクリックしたら用語集パネルに**置き換わる**（仕様として明記。
  例えば `ContractSourceView` 内の `abi` アンカーをクリックした場合も同様）

### 3.2 開閉トリガー（操作フロー）

1. **ヘッダーの「用語集」ボタン**（`app__controls` 内、`LanguageToggle` の
   隣）。クリックでパネルをトグル（glossary 表示中なら閉じる、他 kind
   表示中・非表示なら `open({ kind: "glossary" })`）。`aria-pressed` で
   開閉状態を示す
   - キャンバスツールバーではなくヘッダーに置く理由: ツールバーは
     「環境を変える操作」（ノード追加・ワークベンチ追加）の場所。用語集は
     言語切り替えと同じ「学習・参照系のアプリ全域機能」なので、ヘッダーの
     コントロール群に置くほうが関心が揃う
2. **点線下線の用語（`GlossaryTerm`）のクリック**（全箇所共通）。
   `open({ kind: "glossary", termKey })` でその用語を選択状態にして開く。
   - **ホバー = さっと覗く、クリック = じっくり読む**という2段の使い分けを
     アプリ全体で一貫させる。§1-2 の「ポップオーバー内で読ませる」経路の
     壊れやすさも、クリックで安定した置き場所（パネル）へ逃がすことで解決する
   - Enter / Space でも同じ（既に `tabIndex={0}` `role="button"` がある。
     キーハンドラを足すだけで、空振りしている a11y 上の期待も回収できる）
   - クリック時はその用語のホバーポップオーバーを閉じる（パネルと二重に
     出さない）
   - クリックはカード側へ伝播させない（`stopPropagation`。React Flow の
     ノード選択などへの波及防止）
3. 閉じる手段はシェル既存のとおり ×ボタンと Esc。ヘッダーボタンの再クリック
   でも閉じる
4. キーボードショートカット（例: `g`）は今回は設けない（先回りしない。
   入力欄とのフォーカス競合の設計コストに対して必要性が未観測）

### 3.3 パネルの中身（情報の見せ方）

ワイヤーフレーム（テキスト。幅は §12.2 の 400px 目安）:

```
┌──────────────────────────────┐
│ 用語集                    ✕ │ ← シェルのヘッダ
│ [🔍 用語を検索…            ] │ ← 検索欄（type="search"）
│                              │
│ A層 インフラ                 │ ← 層グループ見出し
│  ▸ コンテナ — Container      │ ← 行（折りたたみ）
│  ▾ スロット — Slot           │ ← 展開中の行
│    │ 定義全文（クランプ無し）│
│    │ [A層 インフラ ◎]       │ ← レイヤーチップ（レンズ連動）
│    │ 関連用語:               │
│    │ [バリデータ] [CLクライアント]│ ← クリックでパネル内ジャンプ
│  ▸ バリデータ — Validator    │
│ B層 P2Pネットワーク           │
│  ▸ ピア — Peer               │
│ …                            │
└──────────────────────────────┘
```

- **層ごとにグループ化**（a → d の順）。見出し文言は既存の
  `layerFilter.a`〜`layerFilter.d`（「A層 インフラ」等）を再利用し、
  レイヤーレンズのチップバーと語彙を揃える。`GlossaryTerm.layer`
  （`a-infra` 等）から先頭 1 文字で `VisualizationLayer` へ対応付ける。
  対応しない値・空文字は末尾に「その他」グループとして出す（現データでは
  発生しないが、パース仕様上 `layer` は空になり得るため表示を落とさない）
- **グループ内の並びは YAML の記載順を維持**する（アルファベット順に
  しない。terms ファイルの並びは基礎概念 → 発展の学習順として書かれて
  おり、一覧をそのまま上から読める教材にする）
- **行 = 用語名（現在の言語）+ もう一方の言語の用語名を副次表示**
  （例: 「ブロック — Block」）。日英の対応をここで学べるようにする
  （用語集は 2 言語対応が前提。CLAUDE.md 命名・用語）
- **行クリックでその場に展開**（アコーディオン）。展開は同時に 1 件
  （別の行を開くと前の行は閉じる。一覧の見通しを保つ）。`aria-expanded`
  を付ける
- 展開内容:
  - 定義全文（クランプ無し。ここが「じっくり読む場所」）
  - レイヤーチップ（§3.5）
  - 関連用語チップ（§3.4）
- `termKey` 付きで開かれたとき: 該当用語を展開し、その行までスクロールし、
  行を一時ハイライトする（新着カードの発光と同じ「ここだよ」の合図）。
  検索欄にはフォーカスしない（スクロール位置を奪わない）
- `termKey` 無し（ヘッダーボタン）で開かれたとき: 検索欄にフォーカスする

### 3.4 関連用語のジャンプ（パネル内navigation）

- 展開内容の関連用語は、生キーではなく**現在の言語の用語名のチップ**として
  表示し、クリックでその用語をパネル内で展開 + スクロールする
  （`open({ kind: "glossary", termKey })` を呼び直すだけでよい。§3.3 の
  「termKey 付きで開かれたとき」と同じ動きに合流する）
- glossary に未登録のキー（参照切れ）はクリック不可のプレーン表示にする
  （現在の `GlossaryTerm` の unknown 扱いと同じ流儀）

### 3.5 レイヤー・キャンバス要素へのジャンプ

- **レイヤーチップ**（例「A層 インフラ」）のクリックで、レイヤーレンズ
  （Issue #299 の `layerFilter`）をその層に設定する。パネルは開いたまま
  （幅 400px の右ドックなので、キャンバス側で「その層以外が薄くなる」
  変化が見えたまま学べる）
  - CONCEPT.md の例「『peer』→ B層のエッジをハイライト」は、レンズの
    dim（選択層以外を薄くする）でそのまま実現される。専用のハイライト
    機構は作らない
  - チップの挙動は `LayerFilterBar` と同じトグル（選択中の層をもう一度
    押すと "all" に戻る）にし、現在レンズがその層のときは active 表示に
    する。ツールチップ（`ActionHint`）で「この層だけをキャンバスで見る」
    ことを予告する
- **個別のキャンバス要素へのパン**（例: `block` → チェーンリボンカードへ
  `setCenter`）は今回は**見送る**。用語 → 要素のマッピングデータ
  （YAML への `canvasTarget` 的なフィールド追加）が必要で、CONCEPT.md の
  例示（レイヤーへのジャンプ）はレンズ連動で満たせるため、先回りしない。
  必要性が観測されたら glossary スキーマ拡張として別途設計する
- 状態の配線（実装メモ）: `layerFilter` / `setLayerFilter` は
  `App.tsx`（AppShell）にあり、パネルを描画する `SidePanelHost` は
  `Canvas` 内にある。`Canvas` は既に `layerFilter` を受け取っているので、
  変更用コールバック（`onLayerFilterChange` 等）を `Canvas` の props に
  追加して `SidePanelHost` へ渡す（`contractsByAddress` と同じ prop 渡し
  パターン）。あわせて `SidePanelProvider` を `App.tsx` のヘッダーも包む
  位置（`.app` 直下）へ引き上げる（ヘッダーボタンが `useSidePanel()` を
  使えるようにするため。Provider 自体は状態を持つだけなので影響は無い）

### 3.6 検索

- 検索欄はパネル上部に常設。インクリメンタルにフィルタする
- 一致対象: 用語名（ja / en 両方。言語切替に関係なく両方引けるように
  する。英語表記でしか知らない用語を日本語 UI で探すケースが自然に
  あるため）・用語キー・定義文（現在の言語のみ。反対言語の定義まで
  含めるとノイズが増える）
- 大文字小文字を無視した部分一致。スコアリング・あいまい一致はしない
  （37 語に対して過剰）
- フィルタ中も層グループの構造は保ち、一致が無いグループは見出しごと
  隠す。全体 0 件のときは「一致する用語がありません」を出す
- `<input type="search">` を使う（ネイティブのクリアボタンが付く）

### 3.7 既存インラインポップオーバー（`GlossaryTerm`）との関係

**置き換えず共存**させる。ポップオーバーは「読んでいる文脈を離れずに
一瞥する」ためのもの、パネルは「じっくり読む・関連へ広がる・一覧する」
ためのもの、と役割を分ける。そのうえでポップオーバー側に3点の手直しを行う:

1. **定義文を CSS の line-clamp で 6 行までに制限**する（超過分は省略
   記号）。全文はパネルで読む。6 行の根拠: 現データで `block` 以外の
   定義はおおむね 6 行以内に収まり（260px 幅での実測）、先頭 1〜2 文が
   要約として自立する書き方になっているため、6 行あれば「一瞥」の用は
   足りる。固定値だが「YAML の定義文が将来さらに長くなっても壊れない」
   方向の安全弁であり、成立条件はこの節に記録した
2. **フッターに小さく「クリックで用語集を開く」を常設**する（全用語共通の
   固定文言）。クランプの有無に関わらず出す（クリックできることの
   ディスカバリー手段を兼ねる）
3. **関連用語の生キー表示を、現在の言語の用語名表示に直す**（例:
   `transaction, mempool, gossip` → 「トランザクション（tx）・mempool・
   ゴシップ」）。ポップオーバー内ではクリック不可のままとし（§1-2 の
   とおりポップオーバー内インタラクションは構造的に壊れやすい）、
   リンク色をやめて弱い色にする（死んだリンクに見せない）。辿りたければ
   用語をクリックしてパネルへ、という一本道にする

### 3.8 スコープ外・別 Issue 候補

- **出典（リソース）からの逆引き**（CONCEPT.md「ホバーで逆引き」）:
  スコープ外とする。`sources.yaml` のモデル化自体が未着手で、用語 YAML にも
  出典フィールドが無い。パネルの「展開したら詳細が出る」構造は将来の
  出典表示の置き場所としてそのまま使えるため、先回りは不要
- **チェーンプロファイル横断**: 現在プロファイルは Ethereum のみで、
  `glossary/data.ts` が読み込むのも Ethereum の 4 ファイルだけ。パネルは
  「読み込み済みの glossary 全件」を表示する作りにし（プロファイル名の
  ハードコードはしない）、複数プロファイル対応（プロファイル別の
  グループ化など）は 2 つ目のプロファイル追加時に再設計する
- **別 Issue 候補（統括へ報告）**: チェーンリボンのポップオーバー内
  インタラクション（「親ブロック」行ホバーの直前タイル強調・フィールド
  ラベルの用語解説）が、タイルからポップオーバーへポインタを移した約
  200ms 後にポップオーバーごと閉じて成立しないことを実測した（§1-2）。
  issue-298.md の「既知の残課題」の顕在化で、本 Issue の起点となった
  「読み切れない」報告の一因でもある。用語解説の読み場所は本パネルで
  解決するが、「親ブロック」強調という #298 の学習上の要が実質使えない
  問題が残るため、ポップオーバー表示中のホバー保持（ポップオーバー上の
  mouseenter でクローズタイマーを取り消す等）を別 Issue として検討する
  ことを推奨する

### 3.9 新規 i18n 文言（初稿。英訳は chainviz-i18n レビュー対象）

| キー | ja | en |
| --- | --- | --- |
| `glossary.open` | 用語集 | Glossary |
| `glossary.open.hint` | 画面に登場する用語の一覧・検索を開きます | Browse and search all terms used on screen |
| `glossary.panel.title` | 用語集 | Glossary |
| `glossary.panel.searchPlaceholder` | 用語を検索 | Search terms |
| `glossary.panel.searchEmpty` | 一致する用語がありません | No matching terms |
| `glossary.panel.relatedTerms` | 関連用語 | Related terms |
| `glossary.panel.layerLens.hint` | この層だけをキャンバスで見る（レイヤーレンズ） | Focus the canvas on this layer (layer lens) |
| `glossary.panel.otherLayer` | その他 | Other |
| `glossary.popover.openPanel` | クリックで用語集を開く | Click to open the glossary |

層グループ見出しは既存の `layerFilter.a`〜`layerFilter.d` を再利用する
（新設しない）。

### 3.10 実装要件まとめ（frontend 担当向け）

- `packages/shared` の変更: **無し**
- glossary YAML・パーサ（`parse.ts` / `types.ts`）の変更: **無し**
  （既存の `key` / `name` / `definition` / `layer` / `relatedTerms` だけで
  成立する）
- 変更・新設（想定。分割の最終判断は実装担当に委ねる）:
  - `side-panel/sidePanelView.ts`: `{ kind: "glossary"; termKey?: string }`
    追加
  - `side-panel/SidePanelHost.tsx`: glossary case の振り分け +
    レンズ変更コールバックの受け渡し
  - `side-panel/GlossaryPanelView.tsx`（新規）: パネル本体（検索・
    グループ・アコーディオン・チップ）。1 ファイルが肥大するなら
    行コンポーネント・検索純関数（`glossary/` 側に `filterTerms` /
    `groupTermsByLayer` のような純関数を切る）へ分割する
  - `glossary/GlossaryTerm.tsx`: クリック / Enter / Space でパネルを
    開く・ポップオーバーのクランプとフッター・関連用語の名前解決。
    **`SidePanelProvider` の外（単体テスト・Storybook 的な利用）でも
    壊れないこと**: クリック連携は Context が無ければ no-op に
    フォールバックする（`useSidePanel()` は throw するので、optional 版の
    フックか try は不可・Context を直接 `useContext` する軽量アクセサが
    必要になる点に注意）
  - `App.tsx`: `SidePanelProvider` の引き上げ・ヘッダーの用語集ボタン
    （小さければ AppShell 内、独立させるなら `glossary/GlossaryPanelButton.tsx`）
  - `canvas/Canvas.tsx`: レンズ変更コールバックの中継
  - `i18n/messages.ts` / `styles.css`
- data-testid 提案: `glossary-open-button` / `glossary-panel-search` /
  `glossary-panel-group-<a|b|c|d|other>` / `glossary-panel-term-<key>`
  （行）/ `glossary-panel-layer-chip` / `glossary-panel-related-<key>`
- テスト観点（tester 強化前の基本分):
  - 検索純関数: 部分一致（ja 名 / en 名 / key / 現在言語の定義）・
    大文字小文字無視・0 件・空クエリで全件
  - グループ化: `a-infra` → a 等の対応・未知 `layer` が「その他」に
    落ちる・YAML 記載順の維持
  - `GlossaryTerm` クリックで `open({kind:"glossary", termKey})` が
    呼ばれる / Provider 無しで throw しない / ポップオーバーが閉じる
  - `SidePanelHost`: glossary view で パネルが出る・termKey の行が
    展開される・レイヤーチップで onLayerFilterChange が呼ばれる
  - ヘッダーボタンのトグル（開 → 閉、contractSource からの置き換え）
- 実装規模の見立て: 新規コンポーネント 1〜2 + 純関数 1、既存 4〜5
  ファイルの小規模編集。Issue #330（mempool パネル）と同程度の中規模

### 3.11 決めきれない点（統括・ユーザーへの確認事項）

1. **ポップオーバー定義文の 6 行クランプ**（§3.7-1）は、既存表示から
   見える情報を減らす変更。推奨は採用（「ツールチップで長文を読ませない」
   という本 Issue の趣旨への直接対応）だが、「全文維持 + フッター導線
   のみ」でも設計は成立する。異議があればクランプだけ外せる
2. **ヘッダー配置**（§3.2-1）はツールバー配置と比較のうえの推奨。
   ツールバー側が良ければボタンの置き場所だけ差し替え可能（設計の他の
   部分に影響しない）

### 2026-07-17 Issue #313 用語集パネルの実装

- 担当: frontend
- ブランチ: issue-313-glossary-panel
- 統括からの判断: §3.11 の2点とも推奨案どおり採用（ポップオーバー6行
  クランプを採用、ボタンはヘッダー配置）

#### 設計メモ（実装着手前）

UX設計 §3.10 の実装要件まとめにほぼ沿って進めた。差分・補足のみ記録する。

- **`SidePanelHost.tsx` のダングリングガードのバグ**: 既存コードは
  `const dangling = view !== null && contract === undefined;` となって
  おり、`contract` は `view?.kind === "contractSource"` のときだけ
  world state から引いていた。つまり `kind` を判定せず
  `contract === undefined` だけで判定していたため、glossary kind を
  追加すると「glossary パネルを開いた瞬間、contract が undefined なので
  ダングリング扱いされて即座に閉じる」という自己矛盾を起こす。
  `view?.kind === "contractSource" && contract === undefined` に修正した
  （§3.10 には明記されていなかったが、2 kind 目を追加する時点で必然的に
  露呈する既存のバグ。回帰テストを `SidePanelHost.glossary.test.tsx` に
  追加した）
- **`SidePanelProvider` の引き上げ**: §3.5 の実装メモどおり、`App.tsx` の
  `.app` 全体（ヘッダーを含む）を包む位置へ引き上げた。以前は
  `RibbonHoverProvider` の内側・`main` を包む位置だったため、ヘッダーの
  `GlossaryOpenButton` が `useSidePanel()` を呼べなかった
- **`useHoverPopover` に `close` を追加**: `GlossaryTerm` はクリック時に
  自分自身のホバーポップオーバーを即座に閉じる必要があるが、既存の
  返り値（`isOpen`/`onMouseEnter`/`onMouseLeave`/`onFocus`/`onBlur`）には
  「即座に閉じる」を外部から呼べる関数が無かった（`onBlur` の内部実装
  `closeNow` を流用するだけで済んだ）。既存の呼び出し元には影響しない
  追加のみの変更
- **`SidePanelContext.tsx` に `useOptionalSidePanel` を追加**:
  `GlossaryTerm` は `SidePanelProvider` の外（単体テストなど）でも
  レンダーされる想定のため、throw する `useSidePanel()` とは別に
  `useContext` を直接呼ぶだけの non-throw 版を追加した
- **検索・グループ化の純粋関数を `glossary/glossarySearch.ts` に分離**:
  `GlossaryPanelView.tsx` 本体を表示に専念させるため（CLAUDE.md
  「1ファイル1責務」）。`resolveGlossaryLayerGroupKey` /
  `matchesGlossaryQuery` / `filterGlossaryTerms` /
  `groupGlossaryTermsByLayer` / `glossaryToOrderedTerms` の5関数
- **ジャンプ時のハイライト演出は新規定数を作らず既存の
  `NEW_ARRIVAL_HIGHLIGHT_DURATION_MS`（5000ms, Issue #123）を再利用**。
  「ここだよ」の合図という役割が同じなため。CSS の `@keyframes
  chainviz-new-arrival` も同様に再利用（`.glossary-panel__row--highlight`）
- **`scrollIntoView` は jsdom に実装が無い**ため、`row?.scrollIntoView?.()`
  とオプショナルチェーンで無くても壊れないようにした（呼ばれることの
  確認は `GlossaryPanelView.test.tsx` でテスト内だけ一時的にプロトタイプへ
  スタブを生やして検証）

#### 実装したファイル

- 新規: `glossary/glossarySearch.ts`（+テスト）、
  `glossary/GlossaryOpenButton.tsx`（+テスト）、
  `side-panel/GlossaryPanelView.tsx`（+テスト）、
  `glossary/GlossaryTerm.panelIntegration.test.tsx`、
  `side-panel/SidePanelHost.glossary.test.tsx`、
  `app/App.glossaryPanel.test.tsx`（配線のE2Eに近い確認）
- 変更: `side-panel/sidePanelView.ts`（`glossary` kind 追加）、
  `side-panel/SidePanelHost.tsx`（振り分け + ダングリングガード修正）、
  `side-panel/SidePanelContext.tsx`（`useOptionalSidePanel` 追加）、
  `glossary/GlossaryTerm.tsx`（クリック連携・クランプ・フッター・関連用語
  名前解決）、`interaction/useHoverPopover.ts`（`close` 追加）、
  `canvas/Canvas.tsx`（`onLayerFilterChange` を `SidePanelHost` へ中継）、
  `app/App.tsx`（`SidePanelProvider` 引き上げ・ヘッダーボタン配置・
  `Canvas` へ `onLayerFilterChange` 配線）、`i18n/messages.ts`（設計メモ
  §3.9 の9キーをそのまま追加）、`styles.css`
- 既存テストの追従修正: `entities/ContractCard.test.tsx`
  （`SidePanelView` が判別共用体になったことに伴う型エラー修正）、
  `side-panel/SidePanelHost.test.tsx`（新しい必須 prop
  `layerFilter`/`onLayerFilterChange` の追加）

#### 動作確認

- `pnpm --filter @chainviz/frontend build` / `test`（167ファイル・2390件）
  ともに成功、`pnpm lint` も警告無し
- モックモード（`pnpm --filter @chainviz/frontend dev`）を起動し、
  Playwright（`packages/e2e` 同梱の chromium。issue-125.md 記載の
  `LD_LIBRARY_PATH` 回避策を使用）で実際に操作して確認した:
  - ヘッダーの「用語集」ボタンでパネルが開き、検索欄にフォーカスが当たる
  - 「チェーン」見出し（termKey `block`）のホバーポップオーバーが
    6行クランプ表示になり、関連用語が生キーではなく用語名
    （「トランザクション（tx）」「mempool（メモリプール）」
    「ゴシップ伝播」）で、末尾に「クリックで用語集を開く」フッターが
    出ることを確認
  - そのポップオーバーの用語自体をクリックすると、用語集パネルが開いて
    「ブロック」行が展開状態でスクロール表示され、クランプ無しの全文が
    読めることを確認（本Issueの起点だった「読み切れない」課題の解消を
    実際に確認できた）
  - パネル内の行のレイヤーチップをクリックすると、実際にキャンバス左上の
    レイヤーレンズのチップ（例: A層）が選択状態に切り替わることを確認
  - パネル内の関連用語チップをクリックすると、その用語がパネル内で展開・
    スクロールされることを確認
  - ヘッダーボタンの再クリックでパネルが閉じることを確認

#### 次の担当が知っておくべき注意点

- §3.8 に記載のとおり、「別Issue候補」としてチェーンリボンのポップオーバー
  内インタラクション（ホバー保持）の改善は本Issueのスコープ外のまま残して
  ある。統括への報告事項
- `packages/shared` の変更・glossary YAML スキーマの変更は無し（当初の
  想定どおり）

### 2026-07-17 Issue #313 テスト強化（異常系・境界値）

- 担当: tester
- ブランチ: issue-313-glossary-panel
- 内容: 実装担当が書いた基本テストに、異常系・境界値・複数kind遷移の観点を
  追加した。実装コードは変更していない（テストファイルのみ）。

#### 追加したテストの観点

- `glossary/glossarySearch.test.ts`:
  - `matchesGlossaryQuery`: キーの大文字小文字無視・クエリの前後空白 trim・
    内部空白は正規化しない（"contain er" は不一致）・1文字クエリ・
    フィールド全体と等しいクエリ（部分一致の上端）
  - `resolveGlossaryLayerGroupKey`: 接尾辞なしの1文字 layer 値（"a"→a）・
    先頭空白は "other" に落ちる
  - `groupGlossaryTermsByLayer`: シャッフル入力でも a→b→c→d→other の固定順・
    同一 layer の用語が他 layer と交互に来ても グループ内の入力順を保つ
- `side-panel/GlossaryPanelView.test.tsx`:
  - 空 glossary（0件）で空表示になる境界・クエリを空へ戻すと全件復帰・
    空白のみクエリは全件表示
  - 参照切れ関連用語チップのクリックは view を変えない（no-op）
  - レイヤーチップ: レンズが別層(b)を選択中に a層用語のチップを押すと
    トグルで all に戻さず a へ切り替える（既存フィルタ状態との相互作用）
  - 存在しない termKey（壊れた deep-link）で開いてもクラッシュせず一覧が出る
- `glossary/GlossaryTerm.panelIntegration.test.tsx`:
  - キーボード活性化（Enter）でもホバーポップオーバーが閉じる（click と同等）
  - unknown 用語（素の span）のクリックはパネルを開かず throw もしない
- `side-panel/SidePanelHost.glossary.test.tsx`（ダングリングガード修正の
  回帰強化）:
  - world state 更新（無関係コントラクト増加）を跨いでも glossary が開いたまま
  - glossary 表示中にコントラクトが world state から消えても閉じない
    （Issue #321 のデグレ防止。ダングリングガードは contractSource 限定）
  - glossary → 参照切れ contractSource の遷移で contractSource 側の
    ダングリングガードが正しく発火し閉じる（kind ゲートが防御を無効化しない）
  - 参照切れ contractSource の自動クローズ後に glossary を開ける
  - 外部から渡された layerFilter がチップの active 表示に反映される

#### 回帰テストの検出力確認

- `SidePanelHost.tsx` のダングリングガードを修正前
  （`view !== null && contract === undefined`）へ一時的に戻すと、
  `SidePanelHost.glossary.test.tsx` の11件全てが失敗することを確認した
  （glossary パネルが誤クローズされるため）。修正を戻して全件パスに復帰。

#### 実装への申し送り（バグ候補・非ブロッキング）

- `GlossaryTerm` のキーボードハンドラ（`onKeyDown` で Space / Enter →
  `openPanel`）は `event.stopPropagation()` は呼ぶが `event.preventDefault()`
  を呼んでいない。`role="button"` を持つ `<span>`（ネイティブ button では
  ない）で Space を押すと、パネルは開くと同時にブラウザ既定のページ
  スクロールも発生し得る。a11y 上の軽微な問題。テストは現状の挙動を壊さない
  範囲に留めた（preventDefault を要求するテストは追加していない）。対応する
  かは frontend 担当の判断に委ねる。
