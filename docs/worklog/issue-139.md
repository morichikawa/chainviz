# Issue #139 作業記録

### 2026-07-07 Issue #139 lighthouse起動時のweak subjectivity periodエラー対応(node-env)

- 担当: node-env
- ブランチ: issue-139-weak-subjectivity
- 内容: `profiles/ethereum/scripts/lighthouse-bn.sh`の`lighthouse bn`起動
  オプションに`--ignore-ws-check`を追加した(ユーザー承認済みの対応方針)。
  あわせて`profiles/ethereum/README.md`に「長時間停止後の再起動と weak
  subjectivity(Issue #139)」節を追加し、原因・対応・既知の限界を記載した。

- 背景・原因:
  - `lighthouse-bn.sh`は起動のたびに`/data`を初期化して genesis からやり直す
    設計(Issue #43で確認済み。EL/CL単独再起動を避けるための既存の前提）。
  - genesis の生成時刻(`generate-genesis.sh`が初回起動時に記録する現在時刻。
    以降は冪等で再利用される。Issue #56)から実時間で weak subjectivity
    period を超えて`docker compose up -d`すると、lighthouseが
    `Failed to build beacon chain: The current head state is outside the
    weak subjectivity period`というCRITで起動を拒否する。PCのシャットダウン・
    スリープ等でコンテナが長時間停止した状態から再起動しようとした場合に
    発生する。
  - このプロファイルの設定(`values.env`: `PRESET_BASE=mainnet`,
    `NUMBER_OF_VALIDATORS=64`, `SLOT_DURATION_IN_SECONDS=2`)での weak
    subjectivity period を計算すると、epoch数はmainnetプリセットの
    `MIN_VALIDATOR_WITHDRAWABILITY_DELAY`(256 epoch)がほぼ支配的で
    churn由来の追加分はごくわずか(バリデーター64・churn limit最小値4・
    safety decay既定10で試算すると +2〜3 epoch程度)。256〜258 epoch ×
    32 slot/epoch × 2秒/slot ≈ 16512〜16640秒 ≈ **約4.6時間**。

- 対応方針: `--ignore-ws-check`フラグの追加(ユーザー承認済み)。lighthouseの
  long range attack対策の安全チェックを意図的に無効化するもので、chainvizは
  外部非公開の使い捨てローカル学習用環境のためこのリスクは実質的に無関係と
  判断した。将来的にこの環境を外部公開する運用に変える場合は再検討が必要。

- 実機検証(重要: 単に「フラグを付けたら起動した」だけでなく、実際に
  ブロック生成が再開するかまで確認した):
  - **検証環境の分離**: メインworktree(`/home/zoe/workspace/chainviz`)で
    稼働中の本物の`chainviz-ethereum`スタックには一切触れていない。検証は
    scratchpad上に`profiles/ethereum`一式をコピーし、プロジェクト名
    (`chainviz-wstest` / `chainviz-wstest2n`)・サブネット(`172.99.0.0/16`
    / `172.98.0.0/16`)・ポート公開を本物と衝突しないよう変更した独立
    docker composeプロジェクトで行った。検証後はいずれも`docker compose
    down -v`で完全に破棄済み。本物の`chainviz-ethereum`は検証前後で
    `docker compose ls`のUPTIME・コンテナ数に変化がないことを確認済み。
  - **再現方法**: 実時間で4.6時間待つ代わりに、`generate-genesis.sh`の
    検証用コピーに`TEST_GENESIS_TIMESTAMP_OFFSET_SEC`環境変数を読む分岐を
    一時的に追加し(本番の`generate-genesis.sh`には入れていない)、
    genesis時刻を「現在時刻 - オフセット秒」に固定できるようにした。これに
    より、PCを実際に何時間も止めなくても「genesis生成から長時間経過した
    状態でのdocker compose up」を即座に再現できる。
  - **不具合の再現**(修正前・単一ノード構成): オフセット6時間(21600秒)の
    genesisで`--ignore-ws-check`無しの`lighthouse-bn.sh`を起動し、issueに
    書かれた文言と完全に一致するCRITエラー
    (`The current head state is outside the weak subjectivity period...
    If you understand the risks, it is possible to ignore this error
    with the --ignore-ws-check flag.`)で起動が拒否されることを確認した。
  - **修正の効果確認(短時間の停止想定)**: オフセット10分(600秒。典型的な
    開発中の一時停止を想定)で`--ignore-ws-check`を付けて起動したところ、
    CRITは発生せず、reth側のログで`Block added to canonical chain`が
    約2秒間隔で継続的に進行することを確認した(number=15→16→17→18…)。
    ブロック生成が正常に再開することを実際に確認済み。
  - **修正の効果確認(1〜1.5時間の停止想定)**: オフセット3600秒(1時間)・
    5400秒(1.5時間、1800/2700 slot相当)でも、起動直後から
    `head_slot == current_slot`に一致し、遅延なく追従・進行することを
    確認した。

- **重要な限界の発見(要申し送り)**: `--ignore-ws-check`は「起動時の
  即時CRIT」は解消するが、**genesis生成時刻からの経過時間が長すぎる場合、
  起動はしてもブロック生成が再開しないまま高CPU負荷でハングし続ける**
  ことを実機検証で確認した。
  - オフセット6400秒(約1.78時間、3200 slot)以上では、`--ignore-ws-check`
    を付けていても`head_slot`が0のまま進まず、beaconログに
    `Producing block at incorrect slot`(`current_slot`がslotを追い越し
    続ける)・`Timed out waiting for fork choice before proposal`が
    繰り返し出続け、10分以上待っても回復しないことを確認した(CPU使用率は
    単一beaconコンテナで1000%超)。オフセット5400秒(1.5時間、2700 slot)
    までは問題なく、6400秒(3200 slot)から発生するため、境界はこの検証
    環境(20 vCPU)ではおおよそ1.5〜1.8時間の間にある。
  - 2ノード構成(実際の本番トポロジー同様、beacon1/2がP2P接続済み)でも
    同じ現象を確認した。オフセット21600秒(6時間)で`--ignore-ws-check`
    付きの2ノード構成を起動したところ、`peer_count: 1`で相互接続はできて
    おり`Sync state updated: Stalled -> Synced`とは出るものの、
    `Producing block at incorrect slot`は単一ノード構成と同様に継続し、
    ブロックは一切生成されなかった。P2P接続の有無は結果を変えない
    (両ノードとも同時に停止から復帰するため、どちらかが「進んだ状態」を
    持って相手を助けることができないのは論理的に妥当)。
  - 根本原因(推定): このプロファイルは`beacon`起動のたびに`/data`を
    初期化するため(Issue #43の前提)、毎回 genesis(slot 0)から現在の
    slotまでの空きスロットをその場で再構築する必要がある。この再構築は
    1 slot(2秒)以内に完了しないと"提案が遅すぎる"扱いになり、
    `current_slot`が先に進んでしまう。経過時間(=再構築が必要なslot数)が
    ある閾値を超えると、この再構築が恒常的にslot時間を超過するようになり、
    `head`が一切前進しないまま`current_slot`だけが増え続ける状態に
    ロックインする。この閾値は実行マシンのCPU性能に依存するため固定値では
    ないが、構造的な問題(固定のslot time内に必要な処理を終える必要がある)
    はハードウェアに関わらず存在する。
  - **この閾値(1.5〜1.8時間)は今回検証したweak subjectivity period
    (約4.6時間)よりずっと小さい**。つまり「PCが長時間止まっていて
    weak subjectivity periodを超えたケース」(issueが想定する状況)では、
    その時点で既にこの再構築ハングの領域に入っている可能性が高く、
    `--ignore-ws-check`だけでは実質的にブロック生成の再開を保証できない。
    ユーザー承認済みの対応方針としてこのフラグ自体は追加したが(即時CRITを
    解消し、短時間〜中時間の停止には確実に有効)、長時間停止からの完全な
    自動復旧までは実現していないことを明記しておく。
  - 対応: README.mdに上記の限界と、ハングした場合は`docker compose
    down -v`(genesis再生成、チェーン進行状態は失われる)が最終手段である
    旨を明記した。この再構築ハング自体の抜本対応(checkpoint syncの導入、
    `/data`を再起動のたびに初期化しない設計への変更など)は本Issueの
    承認済みスコープを超えるため実装していない。必要であれば別Issueとして
    切り出すことを推奨する。

- 変更ファイル:
  - `profiles/ethereum/scripts/lighthouse-bn.sh` — `--ignore-ws-check`
    フラグ追加 + 経緯・既知の限界をコメントで明記
  - `profiles/ethereum/README.md` — 「長時間停止後の再起動と weak
    subjectivity(Issue #139)」節を追加
  - `docs/PLAN.md` — 該当チェックボックスにチェック
  - `docs/WORKLOG.md` — 索引に本ファイルへのリンクを追加

- 決定事項・注意点(次の担当が知っておくべきこと):
  - `generate-genesis.sh`本体には検証用の分岐を入れていない(検証は
    scratchpad上のコピーのみで行った)。本番のgenesis生成ロジックは
    今回のIssueで変更していない。
  - この再構築ハングは「weak subjectivity period超過」だけでなく、
    「genesis生成からある程度(検証環境で1.5〜1.8時間程度)経過した状態での
    beacon/reth restart全般」で起こり得る、より広い既存の潜在バグの
    可能性がある。`restart-node.sh`(Issue #43)の実機確認は genesis が
    新しい状態(短時間)で行われたため、この問題を踏んでいなかったと
    考えられる。長時間稼働中のスタックで`restart-node.sh`を使う場合は
    この点に注意すること。

### 2026-07-07 Issue #139 静的レビュー(reviewer)

- 担当: reviewer
- 結果: **合格**(実装・記録の内容に差し戻し事項なし。ただし下記の
  「完了条件の充足度」についての判断を統括に申し送る)
- 確認内容:
  - `profiles/ethereum/scripts/lighthouse-bn.sh` に `--ignore-ws-check` が
    `COMMON` へ追加されており、boot/peer 両ロールに適用される。ユーザー
    承認済みの対応方針(Issue #139 の案B)どおり。フラグの目的・リスク・
    限界がスクリプト冒頭コメントに明記されている
  - 実機検証の記録は妥当。genesis 時刻を過去にオフセットする手法は本番の
    `generate-genesis.sh` を汚しておらず(検証用コピーのみ)、修正前の
    CRIT 再現→修正後の挙動確認という「実際に再現して確認する」原則
    (CLAUDE.md)に沿っている。検証環境の分離(別プロジェクト名・別サブ
    ネット・破棄済み)も記録されている
  - 4.6 時間(weak subjectivity period)・1.5〜1.8 時間(再構築ハングの
    閾値)という数値は、導出根拠と成立前提(mainnet プリセットの
    256 epoch、slot time 2 秒、閾値は CPU 性能依存で固定値ではないこと)
    がスクリプトコメント・README・worklog の三か所に明記されており、
    「固定値の前提条件を明記する」原則に適合。ロジックへの決め打ち定数の
    埋め込みは無い
  - README の閾値表記「1.5〜2 時間程度」と worklog の「1.5〜1.8 時間」に
    わずかな幅の差があるが、README 側は「程度」付きで CPU 依存の旨も
    併記されているため許容範囲と判断
  - `pnpm lint` / `pnpm build` / `pnpm test`(761 件)すべて通過。
    TypeScript コードの変更は無く、境界(フロント/collector への
    チェーン固有語彙の漏れ等)への影響なし。テスト追加義務の対象外
    (シェルスクリプト+ドキュメントのみの変更)
- **完了条件の充足度についての判断(統括への申し送り)**: 部分的な解決に
  留まる。Issue #139 の完了条件は「長時間停止後にユーザーが手動で
  エラーログを読み解いて `down -v` する必要なく解消できること」だが、
  worklog 自身が記録するとおり、再構築ハングの閾値(検証環境で約 1.5〜
  1.8 時間)は weak subjectivity period(約 4.6 時間)より手前にある。
  つまり本 Issue が想定する「CRIT が出るほど長時間停止したケース」では、
  修正後も起動はするがブロック生成が再開せず、結局 `down -v` が必要になる。
  しかも失敗の現れ方が「明示的な CRIT」から「無言のハング(高 CPU 負荷)」
  に変わるため、README の検知・復旧手順の記載が無ければ発見性はむしろ
  悪化し得た(記載済みなのでこの点は担保されている)。承認済みスコープ
  (案B のフラグ追加)は正しく実装・検証・文書化されており実装としては
  合格だが、Issue #139 の完了条件を字義どおりには満たしていないため、
  再構築ハング(checkpoint sync 導入、`/data` を毎回初期化しない設計、
  または案A 型のハング検知+案内)を**別 Issue として切り出すこと**を
  推奨する。#139 をこの PR で閉じるか、別 Issue 化とセットで閉じるかは
  統括・ユーザーの判断に委ねる
- コミット粒度: レビュー時点で全変更が未コミット。関心事に沿って
  「(1) fix(node-env): フラグ追加+README の当該節追加」
  「(2) docs: worklog 追記・WORKLOG.md 索引・PLAN.md チェック」の
  2 コミット程度に分けることを推奨する

### 2026-07-07 統括による対応方針の確定

- レビュー(査読誠)の申し送り「完了条件は部分的にしか満たしていない」を受け、
  発見された「長時間停止でのハング」問題をIssue #148として別途起票した。
- Issue #139自体は「--ignore-ws-checkフラグの追加により、ハング閾値
  (約1.5〜1.8時間)未満の停止からの再起動は解消される」という承認済みの
  対応方針の範囲では完了と判断し、このままQA・マージへ進める。
- ハング閾値以上の長時間停止への根本対応(checkpoint sync等)はIssue #148
  で別途対応する。
