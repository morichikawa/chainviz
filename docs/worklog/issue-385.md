# Issue #385 addWorkbench(createAndStart)でcontainer.start()失敗時に作成済みコンテナがorphanとして残留する

### 2026-07-18 Issue #385 起票の経緯

- 担当: 統括
- ブランチ: issue-385-workbench-orphan-container-backlog
- 内容: Issue #369の最終QA検証(docs/worklog/issue-369.md「2026-07-18
  実動検証(qa)」節の「発見した問題(#369の差分に起因しない既存の
  堅牢性ギャップ)」小節)でchainviz-qaが偶発的に観測した既存の堅牢性
  ギャップをIssue化し、`docs/PLAN.md`のバックログ節末尾に追記した。
- 事実関係: `addWorkbench`(`createAndStart`経路一般)は、`container.start()`が
  失敗した場合(存在しないネットワークを指定した場合等)に、直前に作成済みの
  「Created」状態コンテナを削除せずorphanとして残す。エラー自体は握りつぶさず
  正しく伝播する(静かには壊れない)が、作りかけのコンテナが残留する。
  `addNode`は先に`usedNetworkIps`(`network.inspect`)でネットワーク存在を
  確認してから作成に進むため、この経路ではorphanが残らない。`addWorkbench`
  にはこの事前チェックが無い。通常運用(既定のcomposeProjectで、対応する
  Dockerスタックが起動済みの状態)では発生しないが、Issue #369により
  「未用意のprojectを指させる」使い方が可能になったため、この経路で
  orphanが積もる可能性が上がる。

### 2026-07-18 Issue #385 起票・バックログ追記のレビュー

- 担当: reviewer
- ブランチ: issue-385-workbench-orphan-container-backlog
- 判定: **合格**(1回の差し戻しを経て解消)
- 1回目: 本ファイルの参照節名「2026-07-18 Issue #369 最終QA検証」が
  docs/worklog/issue-369.mdに実在しない見出しだったため差し戻し
  (実際の見出しは「2026-07-18 実動検証(qa)」節、該当内容はその中の
  「発見した問題(#369の差分に起因しない既存の堅牢性ギャップ)」小節)。
  それ以外の確認項目はすべて合格水準だった:
  - Issue #385本文と`docs/PLAN.md`追記の一致(タイトル完全一致・内容に
    矛盾なし・collectorラベル付与済み)
  - 参照事実の実在確認: `packages/collector/src/docker/dockerode-operations.ts`
    の`createAndStart`はcreateContainer成功後にstart()を呼び、start失敗時に
    作成済みコンテナを削除しない(エラー自体はcatchされず伝播する)。
    `packages/collector/src/adapters/ethereum/node-lifecycle.ts`のaddNodeは
    最初に`usedNetworkIps`(network.inspect)を呼ぶためネットワーク不在時は
    コンテナ作成前にfail-fastするが、addWorkbenchには事前チェックが無く
    createAndStartに直行する
  - `docs/WORKLOG.md`索引への1行追加(フォーマット・リンクとも一貫)
  - コミット粒度(PLAN.md追記とworklog新規+索引更新の2コミット)・
    Conventional Commits形式
  - `pnpm lint` / `pnpm build` / `pnpm test` 全パッケージ通過
- 2回目: 参照節名の修正(コミット6fc9ee6)を目視確認し合格。修正後の参照は
  実在の見出しと一致
- docs配下のみの変更のため、CLAUDE.mdの例外規定に基づきchainviz-qaは
  省略(reviewer合格のみ)
