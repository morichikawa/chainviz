// ロギングプロキシの観測データ（RpcObservation）を OperationEdge（操作エッジ）へ
// マッピングし、operationObserved イベントとして配信する配線。
//
// docs/CONCEPT.md「操作がエッジになる」の決定に従い、ワークベンチ → ノードの
// JSON-RPC 呼び出しを「どのワークベンチがどのノードを何の操作で叩いたか」を
// 表す OperationEdge に変換する。呼び出し元 IP・転送先ホストを world-state の
// エンティティ id へ解決する責務をここに閉じ込め、logging-proxy.ts は観測の
// 発行までに専念させる（Issue #80）。
//
// OperationEdge は揮発性イベントであり world-state store の状態には畳み込まない
// （store.applyEvent は operationObserved を反映しない）。解決できた観測のみ
// operationObserved として全クライアントへ passthrough 配信する。

import type {
  DiffEvent,
  NodeEntity,
  OperationEdge,
  WorkbenchEntity,
} from "@chainviz/shared";
import type { ProxyLogger, RpcObservation, RpcObserver } from "./logging-proxy.js";

/**
 * 観測データを OperationEdge へ解決するためのエンドポイント検索口。
 * world-state store（WorldStateStore）がこのインターフェースを満たす。
 * 観測ごとに現在の store 状態へ問い合わせることで、後から追加された
 * ワークベンチ/ノードにも追従する（固定の解決結果を埋め込まない）。
 */
export interface OperationEndpointResolver {
  /** 指定 IP を持つワークベンチを返す（無ければ undefined）。 */
  findWorkbenchByIp(ip: string): WorkbenchEntity | undefined;
  /** 指定 IP を持つノードを返す（無ければ undefined）。 */
  findNodeByIp(ip: string): NodeEntity | undefined;
}

/** OperationEdge への解決結果。失敗時はどちらの端点が引けなかったかを持つ。 */
export type OperationEdgeResolution =
  | { ok: true; edge: OperationEdge }
  | { ok: false; reason: "workbench-unresolved"; callerIp: string }
  | { ok: false; reason: "node-unresolved"; targetHost: string };

/**
 * ロギングプロキシの転送先 URL（例: "http://172.28.1.1:8545"）からホスト部を
 * 取り出す。ノード解決は IP で行うため、ここで得たホストを findNodeByIp に渡す
 * （転送先がホスト名の場合は IP に一致せずノード解決に失敗する。既定の
 * CHAINVIZ_PROXY_TARGET は Docker bridge 上の IP を指す）。パースできない
 * URL では undefined を返す。
 */
export function parseProxyTargetHost(target: string): string | undefined {
  try {
    return new URL(target).hostname;
  } catch {
    return undefined;
  }
}

/**
 * 観測データ（RpcObservation）を OperationEdge へマッピングする純粋関数。
 * - method    → operation
 * - timestamp → observedAt
 * - callerIp  → fromWorkbenchId（resolver でワークベンチ id を引く）
 * - targetHost → toNodeId（resolver でノード id を引く）
 * どちらかの端点が解決できなければ ok:false を返す（呼び出し側でログに残す）。
 */
export function resolveOperationEdge(
  observation: RpcObservation,
  targetHost: string,
  resolver: OperationEndpointResolver,
): OperationEdgeResolution {
  const workbench = resolver.findWorkbenchByIp(observation.callerIp);
  if (!workbench) {
    return {
      ok: false,
      reason: "workbench-unresolved",
      callerIp: observation.callerIp,
    };
  }
  const node = resolver.findNodeByIp(targetHost);
  if (!node) {
    return { ok: false, reason: "node-unresolved", targetHost };
  }
  return {
    ok: true,
    edge: {
      kind: "operation",
      fromWorkbenchId: workbench.id,
      toNodeId: node.id,
      operation: observation.method,
      observedAt: observation.timestamp,
    },
  };
}

/**
 * ロギングプロキシに渡す観測ハンドラ（RpcObserver）を生成する。観測を
 * OperationEdge へ解決し、解決できたものだけ operationObserved イベントとして
 * broadcast で配信する。解決に失敗した観測は黙って捨てず、どの端点が引けな
 * かったかをログに残す（CLAUDE.md「エラーを握りつぶさない」）。
 */
export function createOperationObserver(deps: {
  /** 転送先ホスト（IP）。parseProxyTargetHost の戻り値を渡す。 */
  targetHost: string;
  /** ワークベンチ/ノードの解決口（通常は WorldStateStore）。 */
  resolver: OperationEndpointResolver;
  /** 解決できたイベントの配信口（通常は CollectorServer.broadcastDiff）。 */
  broadcast: (events: DiffEvent[]) => void;
  /** 解決失敗の記録用ロガー。 */
  log?: ProxyLogger;
}): RpcObserver {
  const log =
    deps.log ??
    ((message, detail) =>
      detail === undefined
        ? console.warn(message)
        : console.warn(message, detail));

  return (observation: RpcObservation): void => {
    const resolution = resolveOperationEdge(
      observation,
      deps.targetHost,
      deps.resolver,
    );
    if (!resolution.ok) {
      if (resolution.reason === "workbench-unresolved") {
        log(
          `[proxy] rpc call from unresolved caller ${resolution.callerIp} ` +
            `(no workbench with this ip); dropping operation edge`,
          { method: observation.method },
        );
      } else {
        log(
          `[proxy] proxy target host ${resolution.targetHost} does not match ` +
            `any node; dropping operation edge`,
          { method: observation.method, callerIp: observation.callerIp },
        );
      }
      return;
    }
    deps.broadcast([{ type: "operationObserved", edge: resolution.edge }]);
  };
}
