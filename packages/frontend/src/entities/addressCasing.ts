/**
 * アドレス表記の食い違い(大文字小文字。checksummed EIP-55表記か、
 * チェーン側の生の表記か)を吸収して照合するための共通ヘルパー。
 *
 * `ContractEntity.deployerAddress` / `TransactionEntity.from` はチェーン側の
 * 生の表記(Ethereumアダプタでは全小文字)である一方、`WalletEntity.address`
 * はmnemonicからviemで導出したEIP-55チェックサム表記になりうる
 * (`wallet-derivation.ts`参照)。単純な文字列一致(`Set.has`等)では常に
 * 不一致になり、エッジが描画されない不具合が複数箇所(deployEdge.ts、
 * contractCallPulseEdge.ts)で見つかったため(Issue #201, #232)、この照合
 * ロジックを1箇所に集約する。
 */

/**
 * `present`(キャンバス上に実在するID群)の中から、大文字小文字を無視して
 * `id` に一致するものを探し、見つかった場合は present 側の元の表記を返す
 * (React Flowのノード解決には常にpresent側の表記を使う必要があるため)。
 * 見つからなければ undefined。
 */
export function resolvePresentId(
  id: string,
  present: Iterable<string>,
): string | undefined {
  const lower = id.toLowerCase();
  for (const candidate of present) {
    if (candidate.toLowerCase() === lower) return candidate;
  }
  return undefined;
}

/**
 * `present` から大文字小文字を無視した「小文字 -> 元の表記」の索引を作る。
 * 同じpresent集合に対して複数のidを繰り返し照合する場合
 * (`deployEdgesToFlowEdges`のようにコントラクトの数だけループする場合)は、
 * `resolvePresentId`をループ内で毎回呼ぶ(その都度presentを走査する)より、
 * 索引を1度だけ作って`Map.get`で引く方が効率的。
 *
 * present側に大文字小文字違いの重複表記が複数含まれる場合(通常は起きない)、
 * 後から追加された表記で上書きされる(後勝ち)。
 */
export function buildLowerCaseIndex(
  present: Iterable<string>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const id of present) index.set(id.toLowerCase(), id);
  return index;
}
