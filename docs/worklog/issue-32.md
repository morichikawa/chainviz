# Issue #32 作業記録

### 2026-07-05 PR #75 PLAN.mdの#32チェック漏れ修正のレビュー(reviewer)

- 担当: reviewer
- ブランチ: docs-plan-checkbox-fix
- 内容: `docs/PLAN.md` バックログの「ダークモードのUI視認性を改善する」
  (#32)を `[x]` に付け替える1行のみの変更をレビューした。結果は合格。
  - Issue #32 は CLOSED、対応PR #72(`issue-32-dark-mode-contrast`)は
    2026-07-04 に MERGED であり、マージコミット `505823b` と実装コミット
    `887c2c1` が `origin/main` の祖先に含まれることを `git merge-base
    --is-ancestor` で確認した。チェック付与は事実と整合する。
  - 記法は既存のチェック済み項目(#43)と同一形式で、Issueリンク行も
    維持されている。
  - 変更は Markdown 1行のみで TypeScript パッケージに影響しないため、
    `pnpm build`/`pnpm lint`/`pnpm test` の結果は main と同一
    (pre-push フックで検証済み)。
  - コミットは1件(`89b504c`)で1変更1コミットの規約に適合。
- 決定事項・注意点: ブランチ名が `issue-<番号>-<スラッグ>` 形式でないが、
  本修正は #32 のクローズ時のチェック漏れの後始末であり、対応する新規
  Issue が存在しないため許容とした。

### 2026-07-04 Issue #32 ダークモードのUI視認性改善

- 担当: frontend
- ブランチ: issue-32-dark-mode-contrast
- 内容:
  - 実環境フィードバック「ダークモードのせいか見づらい」を受け、
    `packages/frontend/src/styles.css` と B層のP2Pエッジ関連コードの配色を
    調整した。事前調査として、`.cache/ms-playwright` にキャッシュ済みの
    Chromiumがあったが起動に必要な共有ライブラリ(libnspr4等)が環境に
    無かったため、`apt-get download` で該当debパッケージを取得して
    スクラッチパッドに展開し、`LD_LIBRARY_PATH` を通すことでPlaywright
    (chromium headless)を動かせるようにした上でモックデータ
    (`websocket/mockData.ts`)を描画したスクリーンショットで視認性を確認した
    (リポジトリには何も追加していない)。
  - WCAGの相対輝度式でコントラスト比を計算し、以下の問題点を特定・修正した。
    - カード・入力欄・ポップオーバーなどの輪郭線
      (`#33405a`、背景比1.77:1)がキャンバス背景に対しほぼ判別できず、
      カードの境界が曖昧だった。輪郭線を`#46577d`(背景比2.56:1)に上げ、
      `--border` / `--divider` の2段階のCSS変数として整理した。区切り線
      (`--divider`)には輪郭線の旧値である`#33405a`を流用したが、区切り線を
      使うヘッダー/ツールバーの変更前の色は`#2a3346`であり、実際には
      わずかに明るい`#33405a`に変わっている。
    - 補助テキスト色`--muted`(`#9aa6bd`、カード上比5.77:1)はWCAG AA
      (4.5:1)は満たしていたが余裕が小さかったため`#a9b5cc`
      (カード上比6.85:1)に上げた。
    - P2Pエッジ(紐)は`stroke-opacity: 0.7`を背景と合成した実効色で見ると、
      青(`#4f9dff`)・紫(`#c77dff`)が背景の紺色と近い色相のため合成後
      コントラスト比が約3.9:1まで下がり、他4色(5:1以上)より見えにくかった。
      青・紫のみ明度を上げ(`#7db8ff` / `#d59bff`)、`stroke-opacity`を
      0.85に、`strokeWidth`を1.5→2に引き上げた
      (`packages/frontend/src/entities/peerEdge.ts`)。
    - ブロック伝播パルス(`PeerPropagationEdge.tsx`)は元々コントラスト比
      16.55:1と高く問題は無かったが、エッジの太さ・不透明度を上げた影響で
      相対的に目立ちにくくなるのを避けるため、半径を4→5、
      `drop-shadow`のぼかし半径を拡大し、色をエッジの新しい青
      (`#6cb2ff`)に揃えた。
    - React FlowのControls/MiniMapが既定のライトテーマ(白背景)のまま
      描画され、アプリ全体のダーク配色から浮いて見えていたため、
      `<ReactFlow colorMode="dark">`を指定してライブラリ標準のダーク
      テーマ変数に切り替えた(`packages/frontend/src/canvas/Canvas.tsx`)。
      MiniMap/Controlsのパネル背景・アイコン色が実際に切り替わることを
      Playwrightで確認済み。
    - glossaryのインライン用語解説・ポップオーバーは元々のコントラスト比が
      6.85〜9台と十分高かったため文言・配色の変更はしていない
      (`--muted`変更により定義文の可読性はさらに上がる)。
  - カードのレイアウト・レイヤー構成・コンポーネント配置は変更していない
    (配色のみの調整)。
- 決定事項・注意点:
  - `NETWORK_COLORS`はテストで配列に含まれるかどうかのみ検証しており
    (`peerEdge.test.ts`)、具体的な16進値には依存していないため、パレット
    変更によるテスト破壊は無い。
  - 本変更は見た目(色・不透明度・線幅)のみでロジックの追加・変更は
    伴わないため、CLAUDE.mdの方針どおり新規ユニットテストは追加していない。
    既存の`pnpm lint` / `pnpm build` / `pnpm test`(frontend 301件)は
    全て通過を確認済み。
  - Playwright実行のため`apt-get download`したdebパッケージ・展開した
    共有ライブラリはすべてスクラッチパッド配下のみに置き、リポジトリには
    含めていない。

### 2026-07-04 Issue #32 ダークモードUI視認性改善のレビュー(reviewer)

- 担当: reviewer
- ブランチ: issue-32-dark-mode-contrast
- 内容: frontend担当の配色調整(未コミットのワークツリー)を静的レビューした。
  - コントラスト比の検算: WCAG相対輝度式で全数値を再計算し、報告値と一致
    することを確認した(輪郭線1.77→2.56、--muted 5.77→6.85(カード背景
    --panel-2基準で妥当)、P2Pエッジ青3.87→6.72・紫3.95→6.60、パルス
    16.55)。変更なしとされた他4色もstroke-opacity 0.85適用後は6.2:1以上。
  - `peerEdge.test.ts`は`NETWORK_COLORS`への包含と`networkIdColor`との
    一致のみを検証しており16進値の直書きは無い。線幅・半径・不透明度を
    直書きしたテストも無く、パレット変更によるテスト破壊は無い。
  - `colorMode="dark"`は`@xyflow/react` v12の正規API。アプリ側に
    Controls/MiniMapのカスタムCSSは無く競合しない。カードはカスタム
    ノード型、エッジ色はインラインstyle指定のためダークテーマ変数の
    影響を受けない。
  - 差分は色・不透明度・半径・線幅・テーマ指定のみでロジック変更は無く、
    新規テスト省略の判断はCLAUDE.mdの方針と整合する。
  - `pnpm lint` / `pnpm build` / `pnpm test`(frontend 301件・collector
    330件ほか)全通過。docs/ARCHITECTURE.md・CONCEPT.mdに配色への言及は
    無く齟齬なし。境界違反・チェーン固有語彙の漏れ・エラー握りつぶしなし。
- 決定事項・注意点: 合格。ただし軽微な指摘が2点あり、対応は統括の判断に
  委ねる(いずれもコントラスト改善の結論には影響しない)。
  1. `colorMode="dark"`の副作用として、`.react-flow.dark`が
     `--xy-background-color-default: #141414`を定義し`<Background />`が
     キャンバス全面をこの色で塗る(ライト時はtransparentでアプリの
     `--bg #0f1420`が透けていた)。エッジの実背景は#141414に変わるが
     検算の結論は不変(青6.70・紫6.61・輪郭線2.56、両背景の輝度差は
     1.00:1)。一方で`peerEdge.ts`・`styles.css`のコメントは「背景
     (--bg #0f1420)の上に描かれる」と記しており実態とずれる。
     `<Background bgColor="var(--bg)" />`でアプリの紺色に揃えるか、
     コメントを実態に合わせて修正するのが望ましい。
  2. WORKLOGの「ヘッダー/ツールバーの区切り線は現状の#33405aを再利用」
     という記述について、当該箇所の変更前の色は#2a3346であり、実際には
     わずかに明るく変化している(値としての#33405a再利用は事実)。
     記述の正確性の観点で補足しておく。

### 2026-07-04 Issue #32 ダークモードUI視認性改善のQA検証(qa)

- 担当: qa
- ブランチ: issue-32-dark-mode-contrast
- 内容: 未コミットのワークツリーを実際に動かして検証した。frontendを
  `pnpm dev`(モックモード、VITE_COLLECTOR_URL未設定で`mockData.ts`を描画)で
  起動し、スクラッチパッドに残っていたPlaywright(chromium headless、
  LD_LIBRARY_PATH経由)でスクリーンショットを取得・DOMの算出値を検証した。
  - CSS変数の実値をブラウザ上で確認: `--bg #0f1420` / `--border #46577d` /
    `--divider #33405a` / `--muted #a9b5cc`。いずれも実装意図と一致。
  - キャンバス背景: `.react-flow__background`に`--xy-background-color-props:
    var(--bg)`がバインドされ、`colorMode="dark"`適用下でも背景色がアプリの
    紺色`#0f1420`になっていることを確認した。無彩色グレー(#141414)には
    なっておらず、レビュー指摘への`<Background bgColor="var(--bg)" />`対応が
    実際に効いている。スクリーンショット上も紺色で、変更前と色相が一致。
  - React Flowのクラスが`react-flow dark`となり、Controls/MiniMapが
    ダークテーマで描画されることを確認した。変更前(01-overview-before.png)は
    MiniMapが白背景・Controlsも明色でダークUIから浮いていたが、変更後は
    両方ともダーク背景に変わり統一されている(最も体感差の大きい改善)。
  - カード・ポップアップ・ツールバーの輪郭線が変更前より明瞭。ホバーで
    インフラポップオーバー(IP/ポート/プロセス/CPU/メモリ)、用語解説
    ポップオーバー(定義文・関連レイヤーのリンク)が正しく表示され、
    補助テキストも読み取れる。
  - P2Pエッジ: `stroke-opacity: 0.85` / `stroke-width: 2px`をDOMで確認。
    ブロック伝播パルスはモックがパルスのパイプライン(BlockEntityの受信
    時刻)に給餌しないため実描画は出ないが、`r=5`・`drop-shadow`拡大の
    変更はソース/DOM上で確認済み(collector実データ由来の要素)。
  - ブラウザのconsoleエラー・pageエラーはゼロ。
  - 静的確認として `pnpm lint`(exit 0)・`pnpm build`(exit 0)・
    `pnpm test`(frontend 301件・collector 330件ほか全パス)も再実行して通過。
- 判定: 合格。実際の画面で配色改善(輪郭線・補助テキスト・エッジ・
  Controls/MiniMapのダーク化)が確認でき、背景色も意図どおり`#0f1420`。
  本Issueはdocs/PLAN.mdのチェックボックスに紐づかないためPLAN.mdへの
  チェック付与は不要。
- 決定事項・注意点: headless chromiumに日本語フォントが無く、日本語文字が
  豆腐(□)表示になるが、これは検証環境のフォント欠落でありアプリの不具合では
  ない(配色・コントラストの検証には影響しない)。検証後はvite dev serverを
  停止し、クリーンな状態に戻した。
