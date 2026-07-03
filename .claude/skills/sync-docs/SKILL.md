---
name: sync-docs
description: Use this skill after modifying source code, docker-compose files, or dependency manifests (package.json, requirements.txt, etc.) in the chainviz project, to check whether docs/CONCEPT.md (and docs/ARCHITECTURE.md once it exists) still accurately reflects the change and update it if not. Triggers on changes to the Collector's data sources or schema, the WebSocket protocol between Collector and frontend, canvas/visualization tech choices, the node environment setup (compose / Kurtosis), or roadmap phase completion.
---

# docs/ 同期チェック

chainviz のコードに変更を加えた際、`docs/CONCEPT.md`(および将来的に
`docs/ARCHITECTURE.md` などの設計ドキュメント)が実装を正しく反映しているか
確認し、必要であれば更新するためのスキル。

## いつ使うか

以下のいずれかに該当する変更を行った、またはこれから行う場合に使う:

- **ノード環境** — docker-compose ファイル、genesis 設定、Kurtosis 設定の変更
  (⇔ CONCEPT.md「技術候補 > ノード環境」「未決事項」の合意方式)
- **Collector(バックエンド)** — データ源(Docker API / JSON-RPC / Prometheus /
  WebSocket 購読)の追加・削除、ワールドステートのスキーマ変更、
  スナップショット+差分プロトコルの変更、ポーリング間隔の変更
  (⇔ CONCEPT.md「アーキテクチャ案」「可視化の階層」)
- **フロントエンド** — キャンバス描画ライブラリの選定・変更、レイヤー切り替えの
  実装、表示する情報(ホバー内容・詳細パネル)の変更
  (⇔ CONCEPT.md「体験イメージ」「技術候補 > キャンバス描画」)
- **依存関係** — package.json / requirements.txt などの追加・削除で
  ドキュメント記載の技術選定と食い違いが生じる場合
- **ロードマップの進行** — ある Phase(可視化階層 A層〜D層)が完成した、または刻み方を
  変えた場合(⇔ CONCEPT.md「ロードマップ」)
- **未決事項の決着** — CONCEPT.md「未決事項」のチェックボックスに該当する
  決定を実装で行った場合(チェックを付け、決定内容を一行追記する)

テストコードのみの変更、コメント・フォーマットのみの変更、ドキュメントに影響しない
バグ修正には適用しない。

## 手順

1. 変更内容(`git diff` またはこれから加える変更)を確認する。
2. `docs/` 配下の該当セクションと照らし合わせ、齟齬がないか確認する。
   特に以下は見落としやすいので必ず確認する:
   - 技術選定の確定・変更(CONCEPT.md は「候補」として書かれているため、
     実装で確定したら候補表記を実績に書き換える)
   - ワールドステートのスキーマ・WebSocket プロトコルの変更
     (Collector とフロントの契約であり、齟齬の影響が大きい)
   - データ源の追加・削除(可視化の階層 A層〜D層 の対応関係に直結する)
   - 未決事項の決着
3. 齟齬があれば該当ドキュメントを更新する。
4. 齟齬がない場合はドキュメントを変更せず、その旨を一言で報告する。
5. 変更した場合は、更新したセクション名をユーザーに一言で報告する
   (例: 「docs/CONCEPT.md の『技術候補』セクションを更新しました」)。

## 対象外

- テストコードのみの変更
- コメント・フォーマットのみの変更
- README.md(存在する場合は別途扱う)

## 備考

設計が固まりコードが増えてきたら、構想メモである CONCEPT.md とは別に
実装を正確に記述する `docs/ARCHITECTURE.md` を起こし、このスキルの
主対象をそちらに移すこと。
