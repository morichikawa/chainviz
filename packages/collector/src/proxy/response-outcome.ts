// ロギングプロキシが観測した RPC 呼び出しの成否判定（レスポンス観測、Issue
// #352）を専用の純関数に切り出したもの。
//
// docs/worklog/issue-352.md §3.3 の判定規則をそのまま実装する:
//   1. forward が throw（ネットワーク失敗・タイムアウト） → 全観測 error
//   2. HTTP ステータスが 2xx 以外 → 全観測 error
//   3. 2xx: レスポンスボディのコピーを JSON パースして判定
//      - 単発リクエスト → 応答オブジェクトに error プロパティが存在すれば
//        error、無ければ ok
//      - バッチ → 応答配列の要素を id で突き合わせ、要素ごとに判定
//   判定不能（非JSON・対応欠落・id 重複等）は outcome を省略する（undefined）。
//   判定不能を error に倒さない（観測の失敗と呼び出しの失敗を混同しないため）。
//
// 単発/バッチの判別は「レスポンスボディの形」で行う。JSON-RPC 仕様上、
// バッチ呼び出し（要素数 1 でも）は配列で応答し、単発呼び出しはオブジェクトで
// 応答するため、元のリクエストが単発だったかバッチだったかを別途保持しなくても
// レスポンス形状だけで一意に判定できる。

import type { RpcObservation } from "./logging-proxy.js";

/** 呼び出しの成否（Issue #352）。プロトコル非依存の語彙で shared 型と揃える。 */
export type RpcOutcome = "ok" | "error";

/**
 * `forward()` の結果。成功時は転送先の HTTP ステータスとレスポンスボディ
 * （コピー）を、失敗時（throw）は種別のみを持つ判別 union。
 */
export type ForwardOutcome =
  | { kind: "success"; status: number; body: string }
  | { kind: "failure" };

/**
 * 転送結果から観測ごとの成否を判定する。`observations` と同じ長さ・同じ順序の
 * 配列を返す。判定できた要素は `"ok"` / `"error"`、判定できなかった要素は
 * `undefined`。
 */
export function resolveResponseOutcomes(
  observations: RpcObservation[],
  forwardOutcome: ForwardOutcome,
): (RpcOutcome | undefined)[] {
  if (forwardOutcome.kind === "failure") {
    return observations.map(() => "error" as const);
  }
  if (forwardOutcome.status < 200 || forwardOutcome.status >= 300) {
    return observations.map(() => "error" as const);
  }
  return resolveFromResponseBody(observations, forwardOutcome.body);
}

function resolveFromResponseBody(
  observations: RpcObservation[],
  body: string,
): (RpcOutcome | undefined)[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // 応答ボディが JSON として解釈できない: 判定不能。
    return observations.map(() => undefined);
  }

  if (Array.isArray(parsed)) {
    return resolveBatch(observations, parsed);
  }
  if (isRecord(parsed) && observations.length === 1) {
    return [hasErrorField(parsed) ? "error" : "ok"];
  }
  // 応答の形がリクエスト件数と噛み合わない（単発オブジェクト応答なのに
  // 観測が複数件ある等）: 判定不能として扱う。
  return observations.map(() => undefined);
}

function resolveBatch(
  observations: RpcObservation[],
  responseItems: unknown[],
): (RpcOutcome | undefined)[] {
  return observations.map((observation) => {
    if (observation.id === null) {
      // 通知（id なし）は応答が返らない前提のため突き合わせようがない。
      return undefined;
    }
    const matches = responseItems.filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) && item.id === observation.id,
    );
    if (matches.length !== 1) {
      // 対応する要素が見つからない、または id 重複で一意に決まらない。
      return undefined;
    }
    return hasErrorField(matches[0]) ? "error" : "ok";
  });
}

function hasErrorField(record: Record<string, unknown>): boolean {
  return "error" in record;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
