# Issue #402 トランザクション署名・PoS検証(attestation)の操作・処理をわかりやすく可視化する

### 2026-07-18 Issue #402 起票の経緯

- 担当: 統括
- ブランチ: issue-401-402-hash-signature-viz-backlog
- 内容: ユーザーから「何が署名で何が検証という操作・処理なのか全く
  わからない」という要望を受け、現状調査を実施した。Issue #401
  (ハッシュの計算・連結・改ざんの可視化)と同じ流れで発生した追加の
  要望。
- 調査結果:
  - EOAのトランザクション署名(secp256k1): `docs/ARCHITECTURE.md` §6.11
    (Issue #212)とglossary `signature`用語で説明済み。
    `TxLifecyclePopover.tsx`がtxライフサイクルの第1段階として表示する。
    ただし署名自体はcollectorが観測できないため常に完了扱いの事後表示で、
    「今署名中」という進行状態は意図的に表現しない設計。collector側は
    `ecrecover`等で署名者を復元せず、`eth_getTransactionByHash`が返す
    RPCの`from`をそのまま信頼している(`eth-rpc-client.ts`)。つまり
    「署名の検証」というプロセス自体はcollector・UIどちらにも存在しない
  - PoSバリデータのattestation(投票・証明): glossary `validator`用語と
    ARCHITECTURE.md §7.6.11(Issue #285)で「validator→beacon」の接続
    関係は説明されているが、attestation自体(投票内容・成否・スロット
    単位の証明)は可視化対象外(「validatorは自身のチェーンコピーを
    持たないため同期状態・ブロック高は表示しない」と明記)
  - Engine API経由のCL→EL検証: glossaryにEngine APIの説明はあるが、
    ブロック妥当性検証プロセス自体の可視化は無い
- ユーザーの意向により、Issue #401とは別Issueとして起票しつつ、同じ
  chainviz-uxに一括して検討させる方針(AskUserQuestionで確認)。
