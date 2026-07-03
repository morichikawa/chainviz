import { useEffect, useState } from "react";
import type {
  ChainvizClient,
  ChainvizClientHandlers,
  ConnectionStatus,
} from "../websocket/client.js";
import { type WorldState, applyDiff, applySnapshot, emptyWorldState } from "./store.js";

export type ClientFactory = (handlers: ChainvizClientHandlers) => ChainvizClient;

export interface UseWorldStateResult {
  state: WorldState;
  status: ConnectionStatus;
}

/**
 * collector クライアント（実 WebSocket または mock）を接続し、届いた
 * snapshot / diff をワールドステートへ畳み込む React フック。
 * `createClient` は呼び出し側で安定した参照にすること（useCallback など）。
 */
export function useWorldState(createClient: ClientFactory): UseWorldStateResult {
  const [state, setState] = useState<WorldState>(emptyWorldState);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  useEffect(() => {
    const client = createClient({
      onSnapshot: (snapshot) => setState(applySnapshot(snapshot)),
      onDiff: (events) => setState((current) => applyDiff(current, events)),
      onStatusChange: setStatus,
    });
    client.connect();
    return () => client.disconnect();
  }, [createClient]);

  return { state, status };
}
