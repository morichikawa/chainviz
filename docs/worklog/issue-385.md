# Issue #385 addWorkbench(createAndStart)でcontainer.start()失敗時に作成済みコンテナがorphanとして残留する

### 2026-07-18 Issue #385 起票の経緯

- 担当: 統括
- ブランチ: issue-385-workbench-orphan-container-backlog
- 内容: Issue #369の最終QA検証(docs/worklog/issue-369.md「2026-07-18 Issue #369
  最終QA検証」節)でchainviz-qaが偶発的に観測した既存の堅牢性ギャップを
  Issue化し、`docs/PLAN.md`のバックログ節末尾に追記した。
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
