// インフラ(node)カードの subtitle 文字列に対する UI 層 E2E 共通の判定
// ヘルパー。`InfraNodeCard.tsx` の subtitle は、`nodeRole` が解釈できる
// ノードでは「{役割ラベル} · {clientType}」（例:「実行クライアント ·
// reth」。Issue #215）、解釈できない場合は従来どおり `{clientType}` 単独
// になる。役割ラベルは日英2言語かつチェーンプロファイルの追加で増減し
// うる文言なので、E2E からラベル文言そのものを決め打ちで比較しない。
// 代わりに「subtitle の末尾が clientType と一致するか」で判定する
// （Issue #270。旧来のフォールバック形式 = clientType 単独の完全一致にも
// この正規表現はそのまま一致する）。

/**
 * subtitle 文字列の末尾が `clientType` と一致するかを判定する正規表現を
 * 作る。`clientType` 直前は文字列の先頭、または「· 」区切りの後の空白の
 * いずれか（`(?:^|\s)`）。
 */
export function subtitleEndsWithClientType(clientType: string): RegExp {
  const escaped = clientType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}$`);
}
